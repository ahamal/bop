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
  /** Head closeness vs neutral, from the face matrix Z. >1 closer, <1 farther. */
  headCloseness: number;
  /**
   * Torso closeness vs neutral, from shoulder width. >1 closer. The tuck
   * detector uses it as a STILLNESS GUARD (torso must hold near 1), not as a
   * subtraction — shoulder width doesn't scale proportionally with the face-Z
   * head term, so subtracting it injected that mismatch into the tuck signal.
   */
  torsoCloseness: number;
  /**
   * Whether a trustworthy torso reading backed this frame. The torso is what
   * separates a real tuck (head retracts while the torso holds still) from a
   * whole-body lean, so tuck detection is gated on it.
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

  return {
    headPitch: relHead.pitch,
    headYaw: MIRROR_SIGN * relHead.yaw,
    headRoll: MIRROR_SIGN * relHead.roll,
    torsoTilt,
    headCloseness,
    torsoCloseness,
    bodyTracked,
  };
}
