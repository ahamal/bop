// Facial expression ratios from the raw face landmarks — no extra model pass,
// just geometry over points the FaceLandmarker already gives us every frame.
//
// Both signals are RATIOS of a vertical gap to a horizontal span on the same
// feature, so they're invariant to face size / distance from the camera. The
// vertical/horizontal mix does bake in the camera's aspect ratio, but that's a
// constant absorbed by the thresholds below.
//
// "left"/"right" are the PERSON'S left/right (MediaPipe's convention). In the
// mirrored selfie view a person's left eye appears on the screen's left, so a
// mirror-style avatar maps person-left → its screen-left directly.

interface Point {
  x: number;
  y: number;
}

export interface FaceExpression {
  /** 0 = closed/relaxed lips … 1 = wide open. */
  mouthOpen: number;
  /** 0 = eye open … 1 = eye fully closed. */
  leftEyeClosed: number;
  rightEyeClosed: number;
}

// FaceMesh landmark indices.
const LIP_TOP = 13; // inner upper lip
const LIP_BOTTOM = 14; // inner lower lip
const MOUTH_L = 61; // mouth corners
const MOUTH_R = 291;
// Person-right eye: lid midpoints + corners.
const R_LID_TOP = 159;
const R_LID_BOT = 145;
const R_CORNER_IN = 133;
const R_CORNER_OUT = 33;
// Person-left eye.
const L_LID_TOP = 386;
const L_LID_BOT = 374;
const L_CORNER_IN = 362;
const L_CORNER_OUT = 263;

// Mapping ranges (in ratio units): where the signal starts registering and
// where it saturates. Eye aspect ratio runs ~0.4 open → ~0.1 closed here;
// mouth gap/width runs ~0 closed → ~0.8 fully open.
const MOUTH_ON = 0.15;
const MOUTH_FULL = 0.6;
const EYE_OPEN_EAR = 0.24;
const EYE_CLOSED_EAR = 0.12;

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function eyeClosedness(lm: readonly Point[], top: number, bot: number, cIn: number, cOut: number): number {
  const w = dist(lm[cIn], lm[cOut]);
  if (w <= 0) return 0;
  const ear = dist(lm[top], lm[bot]) / w;
  return clamp01((EYE_OPEN_EAR - ear) / (EYE_OPEN_EAR - EYE_CLOSED_EAR));
}

export function computeExpression(lm: readonly Point[]): FaceExpression | null {
  if (lm.length <= L_CORNER_OUT) return null;
  const mouthW = dist(lm[MOUTH_L], lm[MOUTH_R]);
  const mar = mouthW > 0 ? dist(lm[LIP_TOP], lm[LIP_BOTTOM]) / mouthW : 0;
  return {
    mouthOpen: clamp01((mar - MOUTH_ON) / (MOUTH_FULL - MOUTH_ON)),
    leftEyeClosed: eyeClosedness(lm, L_LID_TOP, L_LID_BOT, L_CORNER_IN, L_CORNER_OUT),
    rightEyeClosed: eyeClosedness(lm, R_LID_TOP, R_LID_BOT, R_CORNER_IN, R_CORNER_OUT),
  };
}
