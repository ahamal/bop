// Wraps MediaPipe PoseLandmarker to extract what the avatar + tuck need from the
// upper body: shoulder tilt, sway, vertical position, and width. Runs as a
// second model alongside the face tracker.

import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
// "lite" is the cheapest of the three pose models — plenty for shoulders.
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// MediaPipe pose landmark indices.
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;

export interface BodyPose {
  /** Shoulder line tilt, degrees. 0 = level. */
  shoulderTilt: number;
  /** Horizontal offset of the shoulder center from image center, ~-0.5..0.5. */
  sway: number;
  /** Shoulder-center vertical position (normalized image, 0..1, 0 = top). */
  centerY: number;
  /** Shoulder width (normalized image units). Wider = torso closer to camera. */
  width: number;
  /**
   * Lower of the two shoulder visibilities (0..1). The detection path requires
   * this to clear a threshold before trusting tilt/width — a half-occluded
   * shoulder gives a garbage width that would otherwise spoof a chin tuck.
   */
  confidence: number;
  /** Normalized image landmarks (0..1), for drawing on the webcam overlay. */
  landmarks2d: { x: number; y: number; visibility?: number }[];
}

export class BodyTracker {
  private landmarker: PoseLandmarker | null = null;
  private lastVideoTime = -1;

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);
    this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numPoses: 1,
    });
  }

  detect(video: HTMLVideoElement, timestampMs: number): BodyPose | null {
    if (!this.landmarker) throw new Error("BodyTracker not initialized");
    if (video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;

    const result = this.landmarker.detectForVideo(video, timestampMs);
    const lm = result.landmarks?.[0];
    if (!lm) return null;

    const l = lm[LEFT_SHOULDER];
    const r = lm[RIGHT_SHOULDER];
    if (!l || !r) return null;

    // In selfie image space the anatomical-left shoulder sits at higher x, so
    // dx > 0 when level → tilt ≈ 0. The leading minus picks the same handedness
    // as the head's matrix-derived roll, so once MIRROR_SIGN is applied
    // downstream the torso tilts the same way the head rolls (and the same way
    // the mirrored video reads). Drop the minus if you ever switch MIRROR off.
    const dx = l.x - r.x;
    const dy = l.y - r.y;
    const shoulderTilt = -Math.atan2(dy, dx) * (180 / Math.PI);
    const sway = (l.x + r.x) / 2 - 0.5;
    // Absolute shoulder-center height. Independent of the head (shoulders don't
    // move when the head rotates), and in the same image space as the face
    // center, so head and torso track together vertically. Raising the
    // shoulders (a shrug) lowers this value.
    const centerY = (l.y + r.y) / 2;
    const shoulderWidth = Math.hypot(dx, dy) || 1e-3;
    const confidence = Math.min(l.visibility ?? 1, r.visibility ?? 1);

    return {
      shoulderTilt,
      sway,
      centerY,
      width: shoulderWidth,
      confidence,
      landmarks2d: lm.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility })),
    };
  }
}
