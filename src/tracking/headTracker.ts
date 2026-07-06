// Thin wrapper around MediaPipe FaceLandmarker that yields head pose per frame.

import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { poseFromMatrix, type HeadPose } from "./pose.ts";

// Loaded from CDN for now. We can vendor these into /public for offline use
// once the game shell exists. The wasm version MUST match the installed
// @mediapipe/tasks-vision package version or the loader throws.
const WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export interface Frame {
  pose: HeadPose;
  /** Raw 478 landmarks (normalized 0..1), for drawing / future use. */
  landmarks: FaceLandmarkerResult["faceLandmarks"][number];
}

export class HeadTracker {
  private landmarker: FaceLandmarker | null = null;
  private lastVideoTime = -1;

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
    });
  }

  /** Returns a Frame when a new face was detected this video frame, else null. */
  detect(video: HTMLVideoElement, timestampMs: number): Frame | null {
    if (!this.landmarker) throw new Error("HeadTracker not initialized");
    if (video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;

    const result = this.landmarker.detectForVideo(video, timestampMs);
    const matrix = result.facialTransformationMatrixes?.[0];
    const landmarks = result.faceLandmarks?.[0];
    if (!matrix || !landmarks) return null;

    const pose = poseFromMatrix(matrix.data);
    // Face center = centroid of skull-rigid points (eye corners, nose bridge,
    // forehead top) — NOT the all-landmark bbox: the bbox includes the chin,
    // so opening the mouth dragged its center down and the avatar's head
    // translated with every jaw move. These four don't budge with expression.
    // Same normalized image space as the pose model, so head and torso
    // positions stay directly comparable (and it's neutral-relative anyway).
    let cx = 0, cy = 0;
    for (const i of RIGID_CENTER) {
      cx += landmarks[i].x;
      cy += landmarks[i].y;
    }
    pose.cx = cx / RIGID_CENTER.length;
    pose.cy = cy / RIGID_CENTER.length;

    // Depth from the outer eye corners, replacing the matrix's Z. The matrix
    // is a rigid fit of the WHOLE face, so opening the jaw stretches the
    // landmark cloud and bleeds into its Z — mouth-open read as "closer". The
    // upper face is actually rigid: interocular distance shrinks only with
    // real distance and with yaw foreshortening (≈cos yaw — a head-x segment
    // is untouched by pitch, and roll just rotates it in-plane). Divide the
    // yaw back out and it's a clean perspective scale. Consumed strictly as a
    // ratio vs neutral, so the units are arbitrary.
    const r = landmarks[EYE_OUTER_R];
    const l = landmarks[EYE_OUTER_L];
    const aspect = video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3;
    const iod = Math.hypot((l.x - r.x) * aspect, l.y - r.y);
    if (iod > 1e-6) {
      // Past ~60° of yaw the cos correction amplifies landmark noise; clamp —
      // nothing gameplay-relevant happens at that angle anyway.
      const yaw = Math.min(Math.abs((pose.yaw * Math.PI) / 180), Math.PI / 3);
      pose.distance = Math.cos(yaw) / iod;
    }

    return { pose, landmarks };
  }
}

// MediaPipe face-mesh indices for the outer eye corners (the widest rigid,
// expression-invariant pair on the face).
const EYE_OUTER_R = 33;
const EYE_OUTER_L = 263;
const NOSE_BRIDGE = 168; // sellion, between the eyes
const FOREHEAD_TOP = 10; // top of the face oval — skull, not jaw
// Expression-invariant anchor set for the face-center estimate.
const RIGID_CENTER = [EYE_OUTER_R, EYE_OUTER_L, NOSE_BRIDGE, FOREHEAD_TOP] as const;
