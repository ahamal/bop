// Poses for the instructor mannequin + the poser that eases between them.
//
// A pose is a set of absolute joint-rotation targets (radians) on the
// mannequin's named joints; any joint or axis a pose doesn't mention eases
// back to the rest stance baked into createMannequin (soft knees, hanging
// arms). A move is a TRACK — one or more pose steps played once, each step
// easing from wherever the joints currently are. Static holds are one-step
// tracks; the neck rolls are three steps (start end → deep chin-down bottom
// → far end) whose in/out easing splits make the U one continuous sweep with
// peak speed at the bottom. The poser also owns the idle motion (breathing,
// faint head sway), layered additively on top so the two never fight.
//
// Handedness: the mannequin demonstrates like a fitness instructor — MIRRORED.
// "tiltLeft" is the USER's left, so the figure facing the camera tilts toward
// screen-left, which is its own right. (Flip the sign convention here if we
// ever decide against mirroring.)

import * as THREE from "three";
import type { Mannequin, MannequinJoints } from "./mannequin.ts";

export type JointName = keyof MannequinJoints;

/**
 * Absolute rotation targets; unspecified joints/axes return to rest.
 * `headZ` is the head pivot's position.z — the forward-carriage axis. Rest is
 * slightly forward (real posture); the chin tuck retracts along it.
 */
export type Pose = Partial<Record<JointName, { x?: number; y?: number; z?: number }>> & {
  headZ?: number;
};

/** One step of a move: ease into `pose` over `duration` seconds. */
type Step = { pose: Pose; duration: number; ease: Ease };
type Ease = "inOut" | "in" | "out";

const step = (pose: Pose, duration = 0.65, ease: Ease = "inOut"): Step => ({
  pose,
  duration,
  ease,
});

// Sign map (figure faces +Z, toward the camera; user's left = screen-left = -X):
//   rotation.z > 0 → head-top toward screen-left  (tilt to user's left)
//   rotation.y < 0 → nose toward screen-left      (look to user's left)
//   rotation.x > 0 → chin down toward the chest   (flexion)
// Head/neck motion is split across both joints so the bend distributes like a
// spine instead of hinging at one point.
//
// The hand-assist arm: the stretch reaches OVER the crown and pulls from the
// far side, so "assist left" uses the arm on screen-left (the figure's right)
// with the palm draping onto the far (screen-right) top of the tilted skull.
// The shoulder/elbow/wrist angles were solved from the segment lengths
// (upper arm 0.27, forearm 0.24, palm 0.075 from the wrist) against the
// tilted skull's surface — expect to fine-tune them by eye.
const POSES: Record<string, Pose> = {
  neutral: {},

  tiltLeft: { neck: { z: 0.4 }, head: { z: 0.3 } },
  tiltRight: { neck: { z: -0.4 }, head: { z: -0.3 } },

  lookLeft: { neck: { y: -0.55 }, head: { y: -0.65 } },
  lookRight: { neck: { y: 0.55 }, head: { y: 0.65 } },

  // Slightly deeper tilt than the unassisted one (the pull adds range), gaze
  // a touch upward per the routine. Elbow x is pinned to 0 so the raised arm
  // stays in the frontal plane instead of inheriting the resting bend.
  tiltLeftAssist: {
    neck: { z: 0.45, x: -0.1 },
    head: { z: 0.35, x: -0.24 },
    shoulderR: { z: -2.55 },
    elbowR: { x: 0, z: -1.45 },
    // Wrist: y half-turn = forearm pronation (thumb swings to the back, palm
    // onto the head); the z drape reads flipped through that twist, so +z
    // here bends the hand down onto the crown.
    wristR: { y: Math.PI, z: 0.95 },
  },
  tiltRightAssist: {
    neck: { z: -0.45, x: -0.1 },
    head: { z: -0.35, x: -0.24 },
    shoulderL: { z: 2.55 },
    elbowL: { x: 0, z: 1.45 },
    wristL: { y: Math.PI, z: -0.95 },
  },

  chinToChest: { neck: { x: 0.45 }, head: { x: 0.42 } },
  lookUp: { neck: { x: -0.35 }, head: { x: -0.45 } },

  // Retraction: the whole neck glides back — the joint rotates the baked-in
  // forward slope (0.4 rad) most of the way to vertical, carrying the head
  // rearward, with a little extra slide on the headZ track. The head counter-
  // rotates to keep the face forward, plus a hair of chin dip (net +0.1) —
  // the "double chin".
  chinTuck: { headZ: -0.012, neck: { x: -0.45 }, head: { x: 0.55 } },
};

// The roll's U, as a keyframe path: tilted toward one side with a little
// flexion, chin sweeping deep at the bottom, up into the mirror tilt.
const rollEnd = (side: -1 | 1): Pose => ({
  neck: { x: 0.16, z: side * 0.32 },
  head: { x: 0.14, z: side * 0.25 },
});
const ROLL_BOTTOM: Pose = { neck: { x: 0.45, z: 0 }, head: { x: 0.44, z: 0 } };

// A roll plays once: ease to the start end, sweep the U, hold the far end.
// The "in" then "out" easing over equal durations keeps velocity continuous
// through the bottom (both ends of the pair run at cubic slope 3 there).
const roll = (from: -1 | 1): Step[] => [
  step(rollEnd(from)),
  step(ROLL_BOTTOM, 1.0, "in"),
  step(rollEnd(-from as -1 | 1), 1.0, "out"),
];

// side +1 = user's left (screen-left). rollLtoR starts at the user's left.
const TRACKS: Record<string, Step[]> = {
  ...Object.fromEntries(Object.entries(POSES).map(([id, pose]) => [id, [step(pose)]])),
  rollLtoR: roll(1),
  rollRtoL: roll(-1),
};

const EASES: Record<Ease, (t: number) => number> = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  in: (t) => t * t * t,
  out: (t) => 1 - Math.pow(1 - t, 3),
};

export interface Poser {
  /** Play a move's track once; unknown ids ease back to neutral. */
  setPose(id: string): void;
  /** Advance the tween + idle motion. Seconds. */
  update(dt: number, time: number): void;
}

export function createPoser(mannequin: Mannequin): Poser {
  const joints = mannequin.joints;
  const names = Object.keys(joints) as JointName[];

  // rest: the stance at creation. base: the tweened pose state, kept apart
  // from the live Object3D rotations because idle is added on top per frame.
  const rest = new Map(names.map((n) => [n, joints[n].rotation.clone()]));
  const base = new Map(names.map((n) => [n, joints[n].rotation.clone()]));
  // The one position track: the head pivot's forward carriage (chin tuck).
  const restHeadZ = joints.head.position.z;
  let fromHeadZ = restHeadZ;
  let toHeadZ = restHeadZ;
  let baseHeadZ = restHeadZ;
  let from = base;
  let to = base;
  let queue: Step[] = [];
  let ease = EASES.inOut;
  let duration = 1;
  let t = 1;

  const startStep = (s: Step): void => {
    from = new Map(names.map((n) => [n, base.get(n)!.clone()]));
    to = new Map(
      names.map((n) => {
        const r = rest.get(n)!;
        const p = s.pose[n];
        return [n, new THREE.Euler(p?.x ?? r.x, p?.y ?? r.y, p?.z ?? r.z)];
      }),
    );
    fromHeadZ = baseHeadZ;
    toHeadZ = s.pose.headZ ?? restHeadZ;
    ease = EASES[s.ease];
    duration = s.duration;
    t = 0;
  };

  const setPose = (id: string): void => {
    queue = (TRACKS[id] ?? TRACKS.neutral).slice();
    startStep(queue.shift()!);
  };

  const update = (dt: number, time: number): void => {
    if (t < 1) {
      t = Math.min(1, t + dt / duration);
      const k = ease(t);
      for (const n of names) {
        const s = from.get(n)!;
        const e = to.get(n)!;
        base.get(n)!.set(s.x + (e.x - s.x) * k, s.y + (e.y - s.y) * k, s.z + (e.z - s.z) * k);
      }
      baseHeadZ = fromHeadZ + (toHeadZ - fromHeadZ) * k;
      if (t >= 1 && queue.length > 0) startStep(queue.shift()!);
    }
    for (const n of names) joints[n].rotation.copy(base.get(n)!);
    joints.head.position.z = baseHeadZ;

    // Idle life, additive over the pose: slow breathing in the spine, a
    // slower micro-sway in the head. Tiny on purpose.
    joints.spine.rotation.x += 0.015 + Math.sin(time * 1.1) * 0.012;
    joints.head.rotation.y += Math.sin(time * 0.45) * 0.03;
  };

  return { setPose, update };
}
