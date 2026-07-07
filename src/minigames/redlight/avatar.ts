// The Red Light playfield avatar: the same full-body back-to-camera runner
// chassis as Traffic (capsule limbs on pivots the base render loop never
// touches), with one twist — the run cycle takes an INTENSITY. At 0 the
// figure stands at rest (limbs ease home, no bob, upright posture); at 1 it
// sprints flat out. The game maps shake energy to that intensity, so how hard
// you shake IS how hard the figure runs.
//
// The player never translates: the fieldGroup (ground, finish line, doll,
// crowd) scrolls past the fixed figure to sell the progress. An elimination
// fall (setFall) tips the whole figure forward — face down in front of the
// doll.

import * as THREE from "three";
import type { HeadPose } from "../../tracking/pose.ts";
import { AbstractAvatar } from "../../avatar/AbstractAvatar.ts";
import { ACCENT, ACCENT_DEEP } from "../../avatar/abstractParts.ts";

export const AVATAR_SCALE = 0.38;
/** World y of the playing field surface. */
export const FIELD_Y = -2.62;

// Figure-local geometry (before AVATAR_SCALE) — same skeleton as Traffic.
const HIP_Y = -3.0;
const HIP_X = 0.42;
const SHOULDER_X = 1.05;
const FOOT_Y = -4.55;

// Run cycle: stride rate, swing amplitudes (radians), bounce (figure units).
const RUN_HZ = 2.5;
const ARM_SWING = 0.85;
const LEG_SWING = 0.72;
const KNEE_BASE = 0.35;
const KNEE_SWING = 0.85;
const BOB_Y = 0.14;
const FWD_LEAN = 0.09; // sprint posture at full intensity, upright at rest
const REST_EASE_MS = 55; // limbs plant this fast when intensity dies

export class RedLightAvatar extends AbstractAvatar {
  // Field initializers run after super(), so the base scene graph exists.
  private figGroup = new THREE.Group(); // scale, y-flip, fall animation
  /** The game parents ground + doll + crowd here; it scrolls this group's z. */
  readonly fieldGroup = new THREE.Group();

  private declare armPivots: [THREE.Group, THREE.Group];
  private declare hipPivots: [THREE.Group, THREE.Group];
  private declare kneePivots: [THREE.Group, THREE.Group];
  // Back-to-camera: the π y-flip below negates how the mirrored channels
  // render, so flip the per-avatar handedness to compensate (see Avatar).
  protected viewSign = -1 as const;

  private phase = 0;
  private stride = 0; // eased copy of the game's intensity
  private fallT = 0; // 0 upright … 1 face down

  constructor(canvas: HTMLCanvasElement) {
    super(canvas);
    this.figGroup.scale.setScalar(AVATAR_SCALE);
    // Back to the camera: the runner faces INTO the screen, toward the doll.
    this.figGroup.rotation.y = Math.PI;
    this.figGroup.position.y = FIELD_Y - AVATAR_SCALE * FOOT_Y;
    // add() reparents: the figure moves out of the scene root and under the
    // figure group, pose machinery untouched.
    this.figGroup.add(this.headPivot, this.bodyGroup);
    this.scene.add(this.figGroup, this.fieldGroup);
    this.buildLimbs();
  }

  // Raised and tilted down so the field reads as a track receding to the
  // doll on the horizon; the runner stays lower-center.
  protected frameCamera(): void {
    this.camera.position.set(0, 1.5, 11);
    this.camera.lookAt(0, -1.1, -3);
  }

  // Limbs in the family look: deep-emerald capsule segments, bright-emerald
  // ball hands and box feet (bright = the extremity, like the head).
  private buildLimbs(): void {
    const limbMat = new THREE.MeshStandardMaterial({
      color: ACCENT_DEEP,
      roughness: 0.55,
      metalness: 0.1,
      flatShading: true,
    });
    const tipMat = new THREE.MeshStandardMaterial({
      color: ACCENT,
      roughness: 0.45,
      metalness: 0.1,
      flatShading: true,
    });

    const upperArmGeo = new THREE.CapsuleGeometry(0.16, 0.6, 3, 8);
    const forearmGeo = new THREE.CapsuleGeometry(0.13, 0.48, 3, 8);
    const handGeo = new THREE.IcosahedronGeometry(0.2, 0);
    const thighGeo = new THREE.CapsuleGeometry(0.19, 0.55, 3, 8);
    const shinGeo = new THREE.CapsuleGeometry(0.14, 0.55, 3, 8);
    const footGeo = new THREE.BoxGeometry(0.3, 0.16, 0.52);

    const arms: THREE.Group[] = [];
    const hips: THREE.Group[] = [];
    const knees: THREE.Group[] = [];
    for (const side of [-1, 1] as const) {
      // Arm: shoulder pivot on the torso (inherits tracked tilt/sway), upper
      // arm hanging, forearm fixed at a pumping right-angle, hand at the end.
      const shoulder = new THREE.Group();
      shoulder.position.set(side * SHOULDER_X, -0.05, 0);
      const upper = new THREE.Mesh(upperArmGeo, limbMat);
      upper.position.y = -0.45;
      const elbow = new THREE.Group();
      elbow.position.y = -0.88;
      const forearm = new THREE.Mesh(forearmGeo, limbMat);
      forearm.rotation.x = Math.PI / 2; // points forward, +z
      forearm.position.z = 0.34;
      const hand = new THREE.Mesh(handGeo, tipMat);
      hand.position.z = 0.72;
      elbow.add(forearm, hand);
      shoulder.add(upper, elbow);
      this.torsoGroup.add(shoulder);
      arms.push(shoulder);

      // Leg: hip pivot under the torso hem, knee pivot mid-way, box foot.
      // Legs live on the figure group, NOT the torso — the tracked shoulder
      // lift/tilt shouldn't wag the legs; they belong to the run.
      const hip = new THREE.Group();
      hip.position.set(side * HIP_X, HIP_Y, 0);
      const thigh = new THREE.Mesh(thighGeo, limbMat);
      thigh.position.y = -0.42;
      const knee = new THREE.Group();
      knee.position.y = -0.8;
      const shin = new THREE.Mesh(shinGeo, limbMat);
      shin.position.y = -0.4;
      const foot = new THREE.Mesh(footGeo, tipMat);
      foot.position.set(0, -0.82, 0.1);
      knee.add(shin, foot);
      hip.add(thigh, knee);
      this.figGroup.add(hip);
      hips.push(hip);
      knees.push(knee);
    }
    this.armPivots = [arms[0], arms[1]];
    this.hipPivots = [hips[0], hips[1]];
    this.kneePivots = [knees[0], knees[1]];
  }

  /** Advance the run cycle — the game calls this every frame with elapsed ms
   * and the current run intensity (0 = standing still, 1 = flat-out). */
  run(dt: number, intensity: number): void {
    // Ease the visible stride toward the intensity so a dying shake winds the
    // legs down instead of freezing them mid-swing.
    const k = 1 - Math.exp(-dt / REST_EASE_MS);
    this.stride += (Math.max(0, Math.min(1, intensity)) - this.stride) * k;
    // The cycle only advances while there's stride; a stopped runner's limbs
    // ease back to hanging rest below.
    this.phase =
      (this.phase + (dt / 1000) * RUN_HZ * (0.55 + 0.45 * this.stride) * Math.PI * 2 * this.stride) %
      (Math.PI * 2);
    const p = this.phase;
    const s = this.stride;
    for (const side of [0, 1] as const) {
      const ph = p + side * Math.PI; // opposite limbs half a cycle apart
      this.hipPivots[side].rotation.x = -LEG_SWING * Math.sin(ph) * s;
      this.kneePivots[side].rotation.x = KNEE_BASE * s + (KNEE_SWING * (1 + Math.cos(ph)) * s) / 2;
      this.armPivots[side].rotation.x = ARM_SWING * Math.sin(ph) * s;
    }
    this.applyPlacement();
  }

  /** Elimination fall, 0 upright … 1 face down (the game eases this). */
  setFall(t: number): void {
    this.fallT = Math.max(0, Math.min(1, t));
    this.applyPlacement();
  }

  // One owner of the figure group's posture: stride bob and sprint lean while
  // running, the forward topple overriding everything when falling.
  private applyPlacement(): void {
    const bob = BOB_Y * Math.abs(Math.sin(this.phase)) * this.stride;
    // The figure origin sits mid-body, so a pure rotation swings the feet up;
    // sinking it as it tips keeps the fall reading as hitting the ground.
    this.figGroup.position.y =
      FIELD_Y - AVATAR_SCALE * FOOT_Y + bob * AVATAR_SCALE - this.fallT * 1.15;
    this.figGroup.rotation.x = -(FWD_LEAN * this.stride + this.fallT * (Math.PI / 2 - 0.12));
  }

  /** Depth is ignored — leaning in must not grow/move the figure. */
  setZoom(_zoom: number): void {}

  /** Keep head rotations (the shake is the character) but drop the
   * translation channels, so shifting in the chair can't move the figure. */
  setPose(pose: HeadPose): void {
    super.setPose({ ...pose, cx: 0, cy: 0 });
  }
}
