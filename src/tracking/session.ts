// The tracking session: owns the camera, the per-frame detection loop, and
// calibration. It knows nothing about the UI — it emits a FrameResult every
// frame and status/calibration events via callbacks, so both the dev
// diagnostics page and the game render off the same stream without each
// running its own loop or opening the camera twice.
//
// Consumers:
//   - onFrame(result)        every face frame: metrics, gesture states + onset
//                            events, raw landmarks (for overlays), fps, etc.
//   - onStatus(text)         human-readable loading/calibration status.
//   - onCalibrated(recenter) the neutral pose just (re)captured — the cue to
//                            cross-fade a webcam preview into the avatar.
//
// The avatar and an optional webcam preview are attached canvases the session
// drives directly; the source <video> stays wherever the caller puts it
// (visible on the dev page, hidden in the game) since detection reads it
// regardless of whether it's on screen.

import { HeadTracker, type Frame } from "./headTracker.ts";
import { BodyTracker, type BodyPose } from "./bodyTracker.ts";
import {
  GestureDetector,
  type GestureEvent,
  type GestureState,
} from "./gestures.ts";
import { Avatar } from "../avatar/avatar.ts";
import { computeMetrics, type Metrics } from "./metrics.ts";
import { Calibrator } from "./calibration.ts";
import { SequenceDetector, type DominantState, type SequenceEvent } from "./sequence.ts";
import { computeExpression, type FaceExpression } from "./face.ts";
import type { HeadPose } from "./pose.ts";

const CALIB_MS = 1500; // initial hold-still window
const RECENTER_MS = 700; // shorter window for settle-mode recenters
// Instant (button) recenters assume the user is ALREADY in their best
// position: give them a beat to come back to center, then take a quick
// average of wherever the head is — no stillness gating at all. Buttons get
// hit mid-action; making them wait for stillness is wrong.
const RECENTER_COMEBACK_MS = 500;
const RECENTER_INSTANT_MS = 400;
const INSTANT_MIN_SAMPLES = 4; // enough frames to average out one jitter
// Stillness is a preference, not a gate: if the head never settles (a moving
// user on the tracker page would otherwise reset the window forever), finalize
// at this deadline on the best mean gathered — an imperfect neutral beats a
// frozen avatar, and Recenter exists to fix it properly.
const CALIB_MAX_MS = 5000;
// Ignore the first frames after the camera opens: auto-exposure is still
// settling and the tracker's first reads are jumpy, so sampling them skewed
// the initial neutral (the "starts out of whack" recentering). Recenter skips
// this — the stream is warm and the user is already settled.
const CALIB_SETTLE_MS = 800;
// Angular rate (|Δyaw|+|Δpitch|+|Δroll| per second, deg/s) above which the
// head counts as moving during calibration. Movement restarts the window:
// neutral must come from a genuinely still pose, not the average of settling
// in — that averaged-motion neutral was why tracking started skewed until a
// manual recenter (done while actually still) fixed it. A rate rather than a
// per-frame delta so the gate reads the same at any camera fps; 30°/s sits
// above landmark jitter but rejects the slow tail of a settling move (the old
// 2.5°/frame ≈ 75°/s at 30fps let those through, skewing relax recenters).
const CALIB_STILL_DPS = 30;
const CALIB_MIN_SAMPLES = 10; // don't finalize until this many head reads land
// When a body is in frame, the window must also bank this many body samples
// before finalizing — otherwise a (re)calibration can move the HEAD neutral
// while keeping a stale BODY neutral, and the avatar's torso detaches from
// its head. The CALIB_MAX_MS deadline still caps the wait if the body
// tracker won't deliver confident reads.
const CALIB_MIN_BODY_SAMPLES = 5;
const BODY_MIN_CONFIDENCE = 0.5; // shoulders below this don't back a depth read
// Presence: how the session tells the UI whether framing is workable, so the
// lobby can pop a webcam preview with guidance instead of sitting silent.
// A face frame this stale means the player left the frame (grace over momentary
// tracker dropouts — a single missed frame shouldn't flash the warning).
const FACE_LOST_MS = 2000;
// Face bounding-box width as a fraction of the frame above which the player is
// too close for reliable tracking. Hysteresis (on above, off below) so a face
// hovering at the line doesn't flicker the warning.
const TOO_CLOSE_ON = 0.5;
const TOO_CLOSE_OFF = 0.44;

/** Everything one detected frame produces, for whoever's rendering it. */
export interface FrameResult {
  metrics: Metrics;
  /** Live state of every gesture, in GESTURE_NAMES order. */
  states: readonly GestureState[];
  /** States that engaged THIS frame — the rhythm game's timing hook. Empty while calibrating. */
  events: GestureEvent[];
  /** The single dominant movement right now (or "neutral"). */
  dominant: DominantState;
  /** Higher-level sequences recognized this frame (e.g. "nod"). Empty while calibrating. */
  sequenceEvents: SequenceEvent[];
  /** Filtered head-vs-torso depth — what the tuck threshold compares against. */
  depthFiltered: number;
  /** Head pose relative to neutral. */
  rel: HeadPose;
  /** Closeness ratio vs neutral (>1 = leaning in). */
  zoom: number;
  /** Raw face landmarks (normalized 0..1), for drawing an overlay. */
  faceLandmarks: Frame["landmarks"];
  /** Mouth-open / per-eye-closed ratios for this frame (null if unreadable). */
  expression: FaceExpression | null;
  /** Last-known body (smooth), for drawing the shoulder overlay. */
  body: BodyPose | null;
  /** True while the hold-still neutral capture is in progress. */
  calibrating: boolean;
  fps: number;
}

/** Whether the player is framed well enough to track. */
export interface Presence {
  /** A face has been seen within the grace window. */
  detected: boolean;
  /** Face fills too much of the frame for reliable tracking. */
  tooClose: boolean;
}

export interface SessionHandlers {
  onFrame?(result: FrameResult): void;
  onStatus?(text: string): void;
  /** Fired when neutral is (re)captured. isRecenter = false for the first capture. */
  onCalibrated?(isRecenter: boolean): void;
  /** Fired when framing quality changes (face lost/found, too close/backed off). */
  onPresence?(p: Presence): void;
}

// Normalized bounding box of the face landmarks — its width is the
// closeness signal, the box itself the preview overlay.
const faceBounds = (
  landmarks: Frame["landmarks"],
): { x: number; y: number; w: number; h: number } => {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

const relativeTo = (pose: HeadPose, ref: HeadPose): HeadPose => ({
  yaw: pose.yaw - ref.yaw,
  pitch: pose.pitch - ref.pitch,
  roll: pose.roll - ref.roll,
  // Distance is consumed as a ratio (see zoom in the loop), not an offset.
  distance: pose.distance,
  // Face-center offset from neutral → head translation in the avatar.
  cx: pose.cx - ref.cx,
  cy: pose.cy - ref.cy,
});

export class TrackingSession {
  private tracker = new HeadTracker();
  private bodyTracker = new BodyTracker();
  private detector = new GestureDetector();
  private sequence = new SequenceDetector();
  private avatar: Avatar | null = null;

  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  // An optional sink that mirrors the source video — shown during the intro so
  // the player can frame up, then detached. Detaching never touches detection,
  // which reads the source <video>, not this canvas.
  private preview: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null =
    null;

  // The shared zero point. Everything visible is measured relative to this, so
  // recentering snaps the head upright.
  private neutral: HeadPose = {
    yaw: 0,
    pitch: 0,
    roll: 0,
    distance: 0,
    cx: 0,
    cy: 0,
  };
  // Resting shoulders captured at calibration — the torso side of metrics neutral.
  private bodyNeutral: BodyPose | null = null;
  // Drives the avatar (smooth, last-known pose) and the overlay between face frames.
  private latestBody: BodyPose | null = null;

  // Calibration averages the resting pose over a short window instead of
  // trusting a single frame. The same machinery serves both the initial
  // neutral capture and Recenter (a shorter re-capture).
  private calib = new Calibrator();
  private calibrating = false;
  private calibSampleStart = 0; // frames before this are warm-up, not samples
  private calibEndTime = 0;
  private calibDeadline = 0; // finalize by here even if the head never settles
  private calibIsRecenter = false;
  private calibInstant = false; // button recenter: no stillness gating
  private calibPrevPose: HeadPose | null = null; // last pose, for the stillness check
  private calibPrevTime = 0; // when it was read (the rate's denominator)
  // False until the FIRST calibration lands. Until then the avatar is held in
  // its rest posture — there's no trustworthy neutral to be relative to, so
  // driving it would just replay the settling-in wobble. Recenters (neutral
  // already exists) keep the avatar live.
  private hasNeutral = false;

  // Presence state — when the face was last seen, its bounding box (normalized,
  // for the preview's tracking overlay), and the last state told to the UI.
  private lastFaceTime = 0;
  private faceBox: { x: number; y: number; w: number; h: number } | null = null;
  private presence: Presence = { detected: true, tooClose: false };

  private running = false;
  private fps = 0;
  private fpsLast = 0;
  private fpsCount = 0;

  constructor(private handlers: SessionHandlers = {}) {}

  /** True while the hold-still neutral capture is in progress. */
  get isCalibrating(): boolean {
    return this.calibrating;
  }

  /** The live camera stream, once started (e.g. to mirror into another sink). */
  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  /**
   * Build the 3D avatar on the given canvas and let the session drive it.
   * Takes the Avatar subclass supplying the look (AbstractAvatar, or a game
   * avatar like ChompAvatar). Generic so callers get the concrete subclass
   * back (e.g. to flip AbstractAvatar's sunglasses flag).
   */
  attachAvatar<T extends Avatar>(
    canvas: HTMLCanvasElement,
    AvatarCtor: new (canvas: HTMLCanvasElement) => T,
  ): T {
    const avatar = new AvatarCtor(canvas);
    this.avatar = avatar;
    // An avatar attached mid-session (the arcade swapping playfields) must
    // inherit the body neutral captured at calibration — setBody measures
    // sway/lift against it, and a fresh avatar's zero neutral would draw the
    // torso at the player's absolute camera position, off-center.
    if (this.bodyNeutral) avatar.calibrateBody(this.bodyNeutral);
    return avatar;
  }

  /** Tear down the current avatar without stopping the session — for screens
   * that swap playfields (e.g. the arcade) while the camera keeps running. */
  detachAvatar(): void {
    this.avatar?.dispose();
    this.avatar = null;
  }

  /** Mirror the webcam into this canvas each frame (a preview sink). */
  attachPreview(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    this.preview = { canvas, ctx };
  }

  /** Stop drawing the preview. Detection is unaffected. */
  detachPreview(): void {
    this.preview = null;
  }

  /**
   * Load the models, open the camera into `video`, and start the loop. The
   * caller owns where `video` lives (visible or hidden) — detection reads it
   * either way. Rejects on failure; the caller restores its own UI.
   */
  async start(video: HTMLVideoElement): Promise<void> {
    this.video = video;
    this.status("Loading model…");
    await this.tracker.init();
    this.status("Loading body model…");
    await this.bodyTracker.init();
    this.status("Requesting camera…");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
    this.stream = stream;
    video.srcObject = stream;
    await video.play();

    this.running = true;
    // Start the lost-face clock at camera-open, so "not detected" only shows
    // after the grace window of genuinely seeing nothing.
    this.lastFaceTime = performance.now();
    this.startCalibration(false);
    requestAnimationFrame(this.loop);
  }

  /**
   * Re-average neutral. "instant" (the default — the Recenter buttons)
   * assumes the user is already in their best position: a short come-back
   * delay, then a quick average, no stillness gating. "settle" (the
   * routine's relax cards) waits for a genuinely still head, like the
   * initial calibration. No-op while already calibrating.
   */
  recenter(mode: "instant" | "settle" = "instant"): void {
    if (this.calibrating) return;
    this.startCalibration(true, mode === "instant");
  }

  /** Stop the loop, release the camera, and tear down the avatar. */
  stop(): void {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.avatar?.dispose();
    this.avatar = null;
  }

  private status(text: string): void {
    this.handlers.onStatus?.(text);
  }

  // Begin a calibration window; the loop samples and finalizes when it
  // elapses. instant = no stillness gating (button recenters).
  private startCalibration(isRecenter: boolean, instant = false): void {
    this.calib.reset();
    this.calibrating = true;
    this.calibIsRecenter = isRecenter;
    this.calibInstant = instant;
    this.calibPrevPose = null;
    this.calibPrevTime = 0;
    this.calibSampleStart =
      performance.now() +
      (instant ? RECENTER_COMEBACK_MS : isRecenter ? 0 : CALIB_SETTLE_MS);
    this.calibEndTime =
      this.calibSampleStart +
      (instant ? RECENTER_INSTANT_MS : isRecenter ? RECENTER_MS : CALIB_MS);
    this.calibDeadline = this.calibSampleStart + CALIB_MAX_MS;
    this.status(
      instant
        ? "Recentering…"
        : isRecenter
          ? "Hold still — recentering…"
          : "Hold still — calibrating neutral pose…",
    );
  }

  private finishCalibration(): void {
    this.calibrating = false;
    this.hasNeutral = true;
    // Start gameplay clean: clear armed states and the depth filter so a
    // pre-calibration transient can't fire a phantom gesture on the first frame.
    this.detector.reset();
    this.sequence.reset();
    const isRecenter = this.calibIsRecenter;
    this.status(isRecenter ? "Recentered ✓" : "Tracking");
    this.handlers.onCalibrated?.(isRecenter);
  }

  private loop = (): void => {
    if (!this.running || !this.video) return;
    const now = performance.now();
    this.updateFps(now);
    const video = this.video;

    // latestBody drives the avatar (smooth, last-known pose). freshBody is THIS
    // frame's trustworthy reading, and only it feeds detection — so a dropped or
    // low-confidence shoulder frame can't spoof the depth signal.
    let freshBody: BodyPose | null = null;
    const body = this.bodyTracker.detect(video, now);
    if (body) {
      if (this.hasNeutral) this.avatar?.setBody(body);
      this.latestBody = body;
      if (body.confidence >= BODY_MIN_CONFIDENCE) freshBody = body;
    }

    const frame = this.tracker.detect(video, now);
    if (frame) {
      this.lastFaceTime = now;
      this.faceBox = faceBounds(frame.landmarks);
    }
    this.updatePresence(now);
    if (frame) {
      if (this.calibrating) {
        const prev = this.calibPrevPose;
        const prevT = this.calibPrevTime;
        this.calibPrevPose = frame.pose;
        this.calibPrevTime = now;
        const moved = prev
          ? Math.abs(frame.pose.yaw - prev.yaw) +
            Math.abs(frame.pose.pitch - prev.pitch) +
            Math.abs(frame.pose.roll - prev.roll)
          : 0;
        const rate = prev && now > prevT ? (moved / (now - prevT)) * 1000 : 0;
        if (now >= this.calibDeadline) {
          // The head never settled — take the best mean gathered (or, with no
          // still samples at all, the live pose) and go live. Recenter fixes a
          // rough neutral; an endless hold-still reset loop fixes nothing.
          if (this.calib.headCount > 0) this.neutral = this.calib.headMean()!;
          else this.neutral = frame.pose;
          this.finishCalibration();
        } else if (now < this.calibSampleStart) {
          // Warm-up: don't sample, but pin neutral to the live pose so a
          // visible avatar rests centered instead of swinging on a stale zero.
          this.neutral = frame.pose;
        } else if (rate > CALIB_STILL_DPS && !this.calibInstant) {
          // Still moving — throw the window away and wait for a still head
          // (the CALIB_MAX_MS deadline above stops this from looping
          // forever if the head never settles). Instant recenters skip this
          // entirely: the user said "here", so here is what we average.
          this.calib.reset();
          this.calibEndTime =
            now + (this.calibIsRecenter ? RECENTER_MS : CALIB_MS);
          this.neutral = frame.pose;
        } else {
          // Accumulate the resting pose and keep neutral on the running mean,
          // so the avatar stays centered through the window and lands on the
          // full average. Body neutral tracks the same way when shoulders read.
          this.calib.addHead(frame.pose);
          this.neutral = this.calib.headMean()!;
          if (freshBody) {
            this.calib.addBody(freshBody);
            const bm = this.calib.bodyMean();
            if (bm) {
              this.bodyNeutral = bm;
              this.avatar?.calibrateBody(bm);
            }
          }
          // Body-in-frame calibrations also wait for enough body samples, so
          // head and body neutrals always move TOGETHER (no body ever seen =
          // nothing to wait for; the deadline covers a body that won't read).
          // Instant recenters don't wait for anything — the window's own
          // ~400ms banks body reads when the tracker is delivering.
          const bodyReady =
            this.calibInstant ||
            !this.latestBody ||
            this.calib.bodyCount >= CALIB_MIN_BODY_SAMPLES;
          const minHead = this.calibInstant ? INSTANT_MIN_SAMPLES : CALIB_MIN_SAMPLES;
          if (now >= this.calibEndTime && this.calib.headCount >= minHead && bodyReady) {
            this.finishCalibration();
          }
        }
      }

      const rel = relativeTo(frame.pose, this.neutral);
      // Zoom (matrix-Z ratio) drives the avatar + lean meter — fine for visuals.
      const zoom =
        frame.pose.distance > 0 ? this.neutral.distance / frame.pose.distance : 1;
      // Rest posture until the first neutral lands; live from then on.
      if (this.hasNeutral) {
        this.avatar?.setPose(rel);
        this.avatar?.setZoom(zoom);
      }
      const expression = computeExpression(frame.landmarks);
      if (expression && this.hasNeutral) this.avatar?.setFace(expression);

      const m = computeMetrics(rel, zoom, freshBody, this.bodyNeutral);
      const events = this.calibrating ? [] : this.detector.update(m, now);
      const states = this.detector.snapshot();
      const sequenceEvents = this.calibrating ? [] : this.sequence.update(states, now);

      this.handlers.onFrame?.({
        metrics: m,
        states,
        events,
        dominant: this.sequence.current,
        sequenceEvents,
        depthFiltered: this.detector.depthFiltered,
        rel,
        zoom,
        faceLandmarks: frame.landmarks,
        expression,
        body: this.latestBody,
        calibrating: this.calibrating,
        fps: this.fps,
      });
    }

    this.drawPreview();
    requestAnimationFrame(this.loop);
  };

  // Reassess framing and tell the UI only when the verdict changes.
  private updatePresence(now: number): void {
    const detected = now - this.lastFaceTime < FACE_LOST_MS;
    let tooClose = this.presence.tooClose;
    if (detected && this.faceBox) {
      // Hysteresis: engage above ON, release below OFF.
      if (this.faceBox.w > TOO_CLOSE_ON) tooClose = true;
      else if (this.faceBox.w < TOO_CLOSE_OFF) tooClose = false;
    }
    if (!detected) tooClose = false;
    if (detected !== this.presence.detected || tooClose !== this.presence.tooClose) {
      this.presence = { detected, tooClose };
      this.handlers.onPresence?.(this.presence);
    }
  }

  // Mirror the source video into the preview canvas (selfie view). The canvas
  // is sized to its on-screen box (so it can sit pixel-for-pixel over the
  // avatar frame) and the video is cover-cropped into it, never stretched.
  private drawPreview(): void {
    const p = this.preview;
    const v = this.video;
    if (!p || !v || !v.videoWidth) return;
    const { ctx, canvas } = p;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(canvas.clientWidth * dpr);
    const ch = Math.round(canvas.clientHeight * dpr);
    if (!cw || !ch) return;
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    // Cover mapping: scale to fill, center the crop.
    const scale = Math.max(cw / v.videoWidth, ch / v.videoHeight);
    const dw = v.videoWidth * scale;
    const dh = v.videoHeight * scale;
    const ox = (cw - dw) / 2;
    const oy = (ch - dh) / 2;
    ctx.save();
    ctx.translate(cw, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, ox, oy, dw, dh);
    // Tracking box: the "you're being tracked" signal. Drawn inside the mirror
    // transform so it stays glued to the face in the selfie view.
    if (this.faceBox && performance.now() - this.lastFaceTime < FACE_LOST_MS) {
      const b = this.faceBox;
      const pad = 0.04; // breathing room so the box frames, not clips, the face
      ctx.strokeStyle = this.presence.tooClose ? "#f59e0b" : "#34d399";
      ctx.lineWidth = 3 * dpr;
      ctx.strokeRect(
        ox + (b.x - pad) * dw,
        oy + (b.y - pad) * dh,
        (b.w + pad * 2) * dw,
        (b.h + pad * 2) * dh,
      );
      // Shoulder line — shows the torso is tracked too, and whether it's level.
      const lm = this.latestBody?.landmarks2d;
      const ls = lm?.[11]; // LEFT_SHOULDER / RIGHT_SHOULDER (MediaPipe pose)
      const rs = lm?.[12];
      if (ls && rs) {
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ox + ls.x * dw, oy + ls.y * dh);
        ctx.lineTo(ox + rs.x * dw, oy + rs.y * dh);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private updateFps(now: number): void {
    this.fpsCount++;
    if (now - this.fpsLast >= 500) {
      this.fps = Math.round((this.fpsCount * 1000) / (now - this.fpsLast));
      this.fpsLast = now;
      this.fpsCount = 0;
    }
  }
}
