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
    // Face center = bounding-box center of all landmarks. More rotation-stable
    // than any single point, and in the same normalized image space as the
    // pose model, so head and torso positions are directly comparable.
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const p of landmarks) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    pose.cx = (minX + maxX) / 2;
    pose.cy = (minY + maxY) / 2;

    return { pose, landmarks };
  }
}
