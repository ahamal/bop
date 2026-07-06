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
const RECENTER_MS = 700; // shorter window when Recentering
// Ignore the first frames after the camera opens: auto-exposure is still
// settling and the tracker's first reads are jumpy, so sampling them skewed
// the initial neutral (the "starts out of whack" recentering). Recenter skips
// this — the stream is warm and the user is already settled.
const CALIB_SETTLE_MS = 800;
// Per-frame angle delta (|Δyaw|+|Δpitch|+|Δroll|, deg) above which the head
// counts as moving during calibration. Movement restarts the window: neutral
// must come from a genuinely still pose, not the average of settling in —
// that averaged-motion neutral was why tracking started skewed until a manual
// recenter (done while actually still) fixed it.
const CALIB_STILL_DEG = 2.5;
const CALIB_MIN_SAMPLES = 10; // don't finalize until this many head reads land
const BODY_MIN_CONFIDENCE = 0.5; // shoulders below this don't back a depth read

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

export interface SessionHandlers {
  onFrame?(result: FrameResult): void;
  onStatus?(text: string): void;
  /** Fired when neutral is (re)captured. isRecenter = false for the first capture. */
  onCalibrated?(isRecenter: boolean): void;
}

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
  private calibIsRecenter = false;
  private calibPrevPose: HeadPose | null = null; // last pose, for the stillness check
  // False until the FIRST calibration lands. Until then the avatar is held in
  // its rest posture — there's no trustworthy neutral to be relative to, so
  // driving it would just replay the settling-in wobble. Recenters (neutral
  // already exists) keep the avatar live.
  private hasNeutral = false;

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
   * Pass an Avatar subclass constructor to swap the look (e.g. AbstractAvatar on
   * the play screen); defaults to the readable Avatar used by the dev page.
   */
  attachAvatar(
    canvas: HTMLCanvasElement,
    AvatarCtor: new (canvas: HTMLCanvasElement) => Avatar = Avatar,
  ): Avatar {
    this.avatar = new AvatarCtor(canvas);
    // An avatar attached mid-session (the arcade swapping playfields) must
    // inherit the body neutral captured at calibration — setBody measures
    // sway/lift against it, and a fresh avatar's zero neutral would draw the
    // torso at the player's absolute camera position, off-center.
    if (this.bodyNeutral) this.avatar.calibrateBody(this.bodyNeutral);
    return this.avatar;
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
    this.startCalibration(false);
    requestAnimationFrame(this.loop);
  }

  /** Re-average neutral over a shorter window. No-op while already calibrating. */
  recenter(): void {
    if (this.calibrating) return;
    this.startCalibration(true);
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

  // Begin a hold-still window; the loop samples and finalizes when it elapses.
  private startCalibration(isRecenter: boolean): void {
    this.calib.reset();
    this.calibrating = true;
    this.calibIsRecenter = isRecenter;
    this.calibPrevPose = null;
    this.calibSampleStart =
      performance.now() + (isRecenter ? 0 : CALIB_SETTLE_MS);
    this.calibEndTime =
      this.calibSampleStart + (isRecenter ? RECENTER_MS : CALIB_MS);
    this.status(
      isRecenter
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
      if (this.calibrating) {
        const prev = this.calibPrevPose;
        this.calibPrevPose = frame.pose;
        const moved = prev
          ? Math.abs(frame.pose.yaw - prev.yaw) +
            Math.abs(frame.pose.pitch - prev.pitch) +
            Math.abs(frame.pose.roll - prev.roll)
          : 0;
        if (now < this.calibSampleStart) {
          // Warm-up: don't sample, but pin neutral to the live pose so a
          // visible avatar rests centered instead of swinging on a stale zero.
          this.neutral = frame.pose;
        } else if (moved > CALIB_STILL_DEG) {
          // Still moving — throw the window away and wait for a still head.
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
          if (now >= this.calibEndTime && this.calib.headCount >= CALIB_MIN_SAMPLES) {
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

  // Mirror the source video into the preview canvas (selfie view).
  private drawPreview(): void {
    const p = this.preview;
    const v = this.video;
    if (!p || !v || !v.videoWidth) return;
    if (p.canvas.width !== v.videoWidth) p.canvas.width = v.videoWidth;
    if (p.canvas.height !== v.videoHeight) p.canvas.height = v.videoHeight;
    const { ctx, canvas } = p;
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
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
