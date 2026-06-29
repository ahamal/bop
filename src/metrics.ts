// Gameplay metrics derived from the head + torso trackers, all relative to the
// calibrated neutral pose. These are the raw numeric signals — the rhythm game
// scores against them and the gesture detector consumes them; the discrete
// chin-tuck decision (filtering, hysteresis) lives in gestures.ts, not here, so
// there's one owner of that temporal logic. Angle handedness uses the same
// MIRROR_SIGN as the avatar, so the readout matches the mirrored webcam.

import type { HeadPose } from "./pose.ts";
import type { BodyPose } from "./bodyTracker.ts";
import { MIRROR_SIGN } from "./mirror.ts";

export interface Metrics {
  // Head angle (degrees, relative to neutral).
  headPitch: number; // chin-down positive; NOT mirrored (vertical axis)
  headYaw: number; // mirrored
  headRoll: number; // mirrored
  // Torso angle (degrees, relative to neutral; mirrored to match the head).
  torsoTilt: number;
  /**
   * Head closeness minus torso closeness, as ratios (≈0 at neutral). Negative =
   * head sits farther back than the torso — i.e. retracted, as in a chin tuck.
   * Small-magnitude, so the detector filters it before thresholding. Only
   * meaningful when bodyTracked.
   */
  headToTorsoDepth: number;
  /**
   * Whether a trustworthy torso reading backed this frame's depth. The torso is
   * the reference that separates a real tuck (head retracts relative to a still
   * torso) from a whole-body lean, so tuck detection is gated on it.
   */
  bodyTracked: boolean;
}

export function computeMetrics(
  relHead: HeadPose, // head pose already relative to neutral
  headCloseness: number, // neutralDist / dist (>1 = closer than neutral)
  body: BodyPose | null, // fresh + confident torso for THIS frame, or null
  bodyNeutral: BodyPose | null,
): Metrics {
  const bodyTracked = !!(body && bodyNeutral);
  let torsoTilt = 0;
  let torsoCloseness = 1;
  if (body && bodyNeutral) {
    torsoTilt = MIRROR_SIGN * (body.shoulderTilt - bodyNeutral.shoulderTilt);
    torsoCloseness =
      bodyNeutral.width > 0 && body.width > 0
        ? body.width / bodyNeutral.width
        : 1;
  }

  // Tuck = the head retracting (its matrix-Z closeness dropping) while the torso
  // holds, so the difference goes negative. The head Z is what actually tracks a
  // retraction; the shoulder-width torso term cancels a whole-body lean.
  const headToTorsoDepth = headCloseness - torsoCloseness;

  return {
    headPitch: relHead.pitch,
    headYaw: MIRROR_SIGN * relHead.yaw,
    headRoll: MIRROR_SIGN * relHead.roll,
    torsoTilt,
    headToTorsoDepth,
    bodyTracked,
  };
}
