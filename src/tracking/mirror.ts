// Single source of truth for left-right mirroring — the "selfie" view that
// matches the mirrored webcam. Everything handedness-related (head yaw/roll,
// torso tilt, horizontal translations, and the displayed angle metrics) reads
// from MIRROR_SIGN, so the avatar and the metrics can never disagree. Flip
// MIRROR to switch the whole app to the camera-as-seen view in one place.
export const MIRROR = true;
export const MIRROR_SIGN = MIRROR ? -1 : 1;
