import { HeadTracker } from "./tracker.ts";
import { BodyTracker } from "./bodyTracker.ts";
import { GestureDetector, type GestureName } from "./gestures.ts";
import { Avatar } from "./avatar.ts";
import { computeMetrics } from "./metrics.ts";
import { Calibrator } from "./calibration.ts";
import { IndicatorPanel } from "./panel.ts";
import type { HeadPose } from "./pose.ts";
import type { BodyPose } from "./bodyTracker.ts";

const video = document.querySelector<HTMLVideoElement>("#video")!;
const overlay = document.querySelector<HTMLCanvasElement>("#overlay")!;
const avatarCanvas = document.querySelector<HTMLCanvasElement>("#avatar")!;
const ctx = overlay.getContext("2d")!;
const statusEl = document.querySelector<HTMLDivElement>("#status")!;
const startBtn = document.querySelector<HTMLButtonElement>("#start")!;
const recenterBtn = document.querySelector<HTMLButtonElement>("#recenter")!;
const fpsEl = document.querySelector<HTMLSpanElement>("#fps")!;
const gesturesEl = document.querySelector<HTMLDivElement>("#gestures")!;
const indicatorsEl = document.querySelector<HTMLDivElement>("#indicators")!;

const tracker = new HeadTracker();
const bodyTracker = new BodyTracker();
const detector = new GestureDetector();
const avatar = new Avatar(avatarCanvas);
const panel = new IndicatorPanel(indicatorsEl);
let latestBody: BodyPose | null = null;

// Labels for the transient onset feed (the chips). The States panel has its own
// labels in panel.ts; this is just the "it just fired" log.
const GESTURE_LABEL: Record<GestureName, string> = {
  lookLeft: "Look left ⬅️",
  lookRight: "Look right ➡️",
  lookUp: "Look up ⬆️",
  lookDown: "Look down ⬇️",
  tiltLeft: "Tilt left ↙️",
  tiltRight: "Tilt right ↘️",
  tuck: "Chin tuck 🔙",
};

// The shared zero point. Everything visible — gauges, avatar, gestures —
// is measured relative to this, so recentering snaps the head upright.
let neutral: HeadPose = { yaw: 0, pitch: 0, roll: 0, distance: 0, cx: 0, cy: 0 };
// Resting shoulders captured at calibration — the torso side of metrics neutral.
let bodyNeutral: BodyPose | null = null;

// Calibration averages the resting pose over a short window instead of trusting
// a single frame (see calibration.ts). The same machinery serves both the
// initial neutral capture and Recenter (a shorter re-capture).
const calib = new Calibrator();
let calibrating = false;
let calibEndTime = 0;
let calibIsRecenter = false;
const CALIB_MS = 1500; // initial hold-still window
const RECENTER_MS = 700; // shorter window when Recentering
const CALIB_MIN_SAMPLES = 10; // don't finalize until this many head reads land
const BODY_MIN_CONFIDENCE = 0.5; // shoulders below this don't back a depth read

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

async function start(): Promise<void> {
  startBtn.disabled = true;
  statusEl.textContent = "Loading model…";

  try {
    await tracker.init();
    statusEl.textContent = "Loading body model…";
    await bodyTracker.init();
    statusEl.textContent = "Requesting camera…";
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;

    startCalibration(false);

    const loop = () => {
      const now = performance.now();
      updateFps(now);

      // latestBody drives the avatar (smooth, last-known pose). freshBody is
      // THIS frame's trustworthy reading, and only it feeds detection — so a
      // dropped or low-confidence shoulder frame can't spoof the depth signal.
      let freshBody: BodyPose | null = null;
      const body = bodyTracker.detect(video, now);
      if (body) {
        avatar.setBody(body);
        latestBody = body;
        if (body.confidence >= BODY_MIN_CONFIDENCE) freshBody = body;
      }

      const frame = tracker.detect(video, now);
      if (frame) {
        if (calibrating) {
          // Accumulate the resting pose and keep neutral on the running mean,
          // so the avatar stays centered through the window and lands on the
          // full average. Body neutral tracks the same way when shoulders read.
          calib.addHead(frame.pose);
          neutral = calib.headMean()!;
          if (freshBody) {
            calib.addBody(freshBody);
            const bm = calib.bodyMean();
            if (bm) {
              bodyNeutral = bm;
              avatar.calibrateBody(bm);
            }
          }
          if (now >= calibEndTime && calib.headCount >= CALIB_MIN_SAMPLES) {
            finishCalibration();
          }
        }

        const rel = relativeTo(frame.pose, neutral);
        // Zoom (matrix-Z ratio) drives the avatar + lean meter — fine for visuals.
        const zoom =
          frame.pose.distance > 0 ? neutral.distance / frame.pose.distance : 1;
        drawLandmarks(frame.landmarks);
        if (latestBody) drawBody(latestBody.landmarks2d);
        avatar.setPose(rel);
        avatar.setZoom(zoom);

        const m = computeMetrics(rel, zoom, freshBody, bodyNeutral);
        if (!calibrating) {
          for (const ev of detector.update(m, now)) {
            logGesture(GESTURE_LABEL[ev.name]);
          }
        }
        panel.setMetrics(m, detector.depthFiltered);
        panel.setStates(detector.snapshot());
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } catch (err) {
    console.error("bop start failed:", err);
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : JSON.stringify(err);
    statusEl.textContent = `Error: ${msg || "see console"}`;
    startBtn.disabled = false;
  }
}

function drawLandmarks(
  landmarks: { x: number; y: number }[],
): void {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.fillStyle = "rgba(80, 220, 160, 0.7)";
  // The overlay is mirrored via CSS to match the mirrored video.
  for (const p of landmarks) {
    ctx.beginPath();
    ctx.arc(p.x * overlay.width, p.y * overlay.height, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBody(lm: { x: number; y: number; visibility?: number }[]): void {
  if (lm.length < 13) return;
  const W = overlay.width;
  const H = overlay.height;
  const [l, r] = [lm[11], lm[12]]; // shoulders
  if ((l.visibility ?? 1) < 0.5 || (r.visibility ?? 1) < 0.5) return;

  ctx.strokeStyle = "rgba(255, 180, 80, 0.9)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(l.x * W, l.y * H);
  ctx.lineTo(r.x * W, r.y * H);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 140, 40, 0.95)";
  for (const p of [l, r]) {
    ctx.beginPath();
    ctx.arc(p.x * W, p.y * H, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function logGesture(label: string): void {
  const chip = document.createElement("div");
  chip.className = "chip";
  chip.textContent = label;
  gesturesEl.prepend(chip);
  while (gesturesEl.children.length > 12) gesturesEl.lastChild!.remove();
  setTimeout(() => chip.classList.add("fade"), 50);
}

let fpsLast = 0;
let fpsCount = 0;
function updateFps(now: number): void {
  fpsCount++;
  if (now - fpsLast >= 500) {
    const fps = Math.round((fpsCount * 1000) / (now - fpsLast));
    fpsEl.textContent = `${fps} fps`;
    fpsLast = now;
    fpsCount = 0;
  }
}

// Begin a hold-still window; the loop samples and finalizes when it elapses.
function startCalibration(isRecenter: boolean): void {
  calib.reset();
  calibrating = true;
  calibIsRecenter = isRecenter;
  calibEndTime = performance.now() + (isRecenter ? RECENTER_MS : CALIB_MS);
  recenterBtn.disabled = true;
  statusEl.textContent = isRecenter
    ? "Hold still — recentering…"
    : "Hold still — calibrating neutral pose…";
}

function finishCalibration(): void {
  calibrating = false;
  // Start gameplay clean: clear armed states and the depth filter so a
  // pre-calibration transient can't fire a phantom gesture on the first frame.
  detector.reset();
  recenterBtn.disabled = false;
  if (calibIsRecenter) {
    statusEl.textContent = "Recentered ✓";
    setTimeout(() => {
      if (!calibrating) statusEl.textContent = "Tracking";
    }, 900);
  } else {
    statusEl.textContent = "Tracking";
  }
}

function recenter(): void {
  // Re-capture neutral the same averaged way as the initial calibration, just
  // over a shorter window. The loop does the sampling and finalizing.
  if (calibrating) return;
  startCalibration(true);
}

startBtn.addEventListener("click", start);
recenterBtn.addEventListener("click", recenter);
