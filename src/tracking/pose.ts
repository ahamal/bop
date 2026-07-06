// Head pose extraction from MediaPipe's facial transformation matrix.
//
// MediaPipe returns a 4x4 matrix as a flat, COLUMN-MAJOR array of 16 floats
// (OpenGL convention). element(row, col) therefore lives at data[col * 4 + row].
// We only need the top-left 3x3 rotation block to recover head orientation.

export interface HeadPose {
  /** Turning left/right, degrees. Right turn positive. */
  yaw: number;
  /** Nodding up/down, degrees. Chin-down (tuck) positive. */
  pitch: number;
  /** Tilting ear-to-shoulder, degrees. */
  roll: number;
  /**
   * Depth from the camera (larger = farther), in arbitrary units — use it as a
   * ratio against a neutral reading, not as an absolute measurement. Seeded
   * here from the matrix translation's Z, then OVERRIDDEN by the tracker with
   * a yaw-corrected interocular estimate (see headTracker.ts): the matrix Z
   * comes from a rigid whole-face fit, so jaw motion (mouth open) bled into
   * it, while the eye corners are expression-invariant. Drives the avatar +
   * lean visuals and the head side of the tuck signal.
   */
  distance: number;
  /**
   * Face center in normalized image coords (0..1) — the head's position in the
   * camera frame, shared space with the pose model so head and torso align.
   * Filled by the tracker from landmarks (the matrix can't give it directly).
   */
  cx: number;
  cy: number;
}

const RAD2DEG = 180 / Math.PI;

export function poseFromMatrix(data: Float32Array | number[]): HeadPose {
  // Column-major accessor for the rotation block.
  const el = (r: number, c: number) => data[c * 4 + r];

  // Decompose R = Rz * Ry * Rx (Tait-Bryan) into x=pitch, y=yaw, z=roll.
  const sy = Math.hypot(el(0, 0), el(1, 0));
  let x: number, y: number, z: number;

  if (sy > 1e-6) {
    x = Math.atan2(el(2, 1), el(2, 2));
    y = Math.atan2(-el(2, 0), sy);
    z = Math.atan2(el(1, 0), el(0, 0));
  } else {
    // Gimbal lock: looking near straight up/down.
    x = Math.atan2(-el(1, 2), el(1, 1));
    y = Math.atan2(-el(2, 0), sy);
    z = 0;
  }

  // Translation (4th column) gives head position. Depth is the Z component
  // alone (abs, since the camera looks down -Z): the full vector length would
  // fold lateral/vertical motion into "distance" and pollute the small tuck
  // signal. In-frame position comes from the landmark bbox (cx/cy in the
  // tracker), not from tx/ty, so we drop those here.
  const distance = Math.abs(el(2, 3));

  // Sign conventions chosen so the gestures read intuitively. Flip here if a
  // given camera/driver mirrors an axis differently.
  return {
    pitch: -x * RAD2DEG,
    yaw: y * RAD2DEG,
    roll: z * RAD2DEG,
    distance,
    cx: 0, // filled by the tracker from landmarks
    cy: 0,
  };
}
