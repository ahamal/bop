// The Traffic playfield avatar: the real 3D AbstractAvatar staged as a
// FULL-BODY runner — the tracked head + torso get simple flat-shaded limbs
// (capsule arms/legs, ball hands, box feet, same emerald family) and a run
// cycle the game advances every frame. The figure runs BACK TO THE CAMERA,
// into the screen (subway-surfer framing), with oncoming taxis head-on.
// The base render loop keeps writing headPivot/bodyGroup/torsoGroup
// transforms every frame, so game-owned motion lives on PARENT groups (lane
// slide, jump arc) and limb swing lives on pivots those writes never touch:
// arms hang off torsoGroup children (inheriting the tracked tilt/sway), legs
// off the figure group.
//
// Game-specific overrides: the camera is raised and tilted down so the ground
// plane reads as a road receding to the horizon; the per-avatar handedness is
// flipped (back view = true handedness); and the player's depth / translation
// channels are disabled — shifting in the chair or leaning in must not move
// the figure off its lane, so "got hit" stays a pure function of lane + jump
// height.

import * as THREE from "three";
import type { HeadPose } from "../../tracking/pose.ts";
import { AbstractAvatar } from "../../avatar/AbstractAvatar.ts";
import { ACCENT, ACCENT_DEEP } from "../../avatar/abstractParts.ts";

export const AVATAR_SCALE = 0.38;
/** World y of the road surface. */
export const ROAD_Y = -2.62;
/** x offset of the side lanes; center lane is x = 0. */
export const LANE_X = 1.5;

// Figure-local geometry (before AVATAR_SCALE). The torso group sits at
// y = -1.75 (the base's shoulder pivot) with the torso mesh spanning roughly
// -3.1..-1.5; hips hang just under its hem, legs reach down from there.
const HIP_Y = -3.0;
const HIP_X = 0.42;
const SHOULDER_X = 1.05; // torsoGroup-local; the tapered prism's top is wide
// Effective foot depth below the figure origin. Slightly shorter than the
// straight-leg reach so the bent-knee run cycle doesn't stuff the feet into
// the asphalt.
const FOOT_Y = -4.55;

/** Hurdle bar height: LOW — shin height on the runner, cleared by jumping
 * (feet at road + jumpY, knees tucked mid-air). Lives here because it's a
 * fact about the figure, not about traffic. */
export const BARRIER_Y = ROAD_Y + 0.4;

// Run cycle: stride rate, swing amplitudes (radians), bounce (figure units).
const RUN_HZ = 2.5;
const ARM_SWING = 0.85;
const LEG_SWING = 0.72;
const KNEE_BASE = 0.35;
const KNEE_SWING = 0.85;
const KNEE_AIR = 1.15; // legs tuck hard while airborne — the hurdler read
const BOB_Y = 0.14;
const FWD_LEAN = 0.09; // whole-figure forward lean, the sprint posture

export class TaxiAvatar extends AbstractAvatar {
  // Field initializers run after super(), so the base scene graph exists.
  private laneGroup = new THREE.Group(); // game-driven x slide
  private figGroup = new THREE.Group(); // scale, y-flip, jump placement
  /** The game parents road + traffic meshes here (world coordinates). */
  readonly roadGroup = new THREE.Group();

  private declare armPivots: [THREE.Group, THREE.Group]; // L, R shoulder
  private declare hipPivots: [THREE.Group, THREE.Group];
  private declare kneePivots: [THREE.Group, THREE.Group];
  // Back-to-camera: the π y-flip below negates how the mirrored channels
  // render, so flip the per-avatar handedness to compensate (see Avatar).
  protected viewSign = -1 as const;

  private phase = 0;
  private jumpY = 0; // world units above the road (game-driven jump arc)

  constructor(canvas: HTMLCanvasElement) {
    super(canvas);
    this.laneGroup.position.y = ROAD_Y;
    this.figGroup.scale.setScalar(AVATAR_SCALE);
    // Back to the camera: the runner sprints INTO the screen (subway-surfer
    // framing), taxis come at them head-on. The forward lean tips toward -z,
    // the running direction, thanks to this y-flip.
    this.figGroup.rotation.y = Math.PI;
    this.figGroup.rotation.x = -FWD_LEAN;
    // add() reparents: the figure moves out of the scene root and under the
    // figure/lane groups, pose machinery untouched.
    this.figGroup.add(this.headPivot, this.bodyGroup);
    this.laneGroup.add(this.figGroup);
    this.scene.add(this.laneGroup, this.roadGroup);
    this.buildLimbs();
    this.applyPlacement();
  }

  // Raised and tilted down so the ground plane reads as a road vanishing
  // behind the figure; the runner stays lower-center.
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

  /** Advance the run cycle — the game calls this every frame with elapsed ms. */
  run(dt: number): void {
    this.phase = (this.phase + (dt / 1000) * RUN_HZ * Math.PI * 2) % (Math.PI * 2);
    const p = this.phase;
    // Airborne, the stride fades out and the knees tuck — the hurdler read.
    const air = Math.min(1, this.jumpY / 0.5);
    const stride = 1 - air;
    for (const side of [0, 1] as const) {
      const ph = p + side * Math.PI; // opposite limbs half a cycle apart
      // rotation.x > 0 sends the limb tip backward (-z); hips swing forward
      // on sin > 0, arms pump opposite their same-side leg.
      this.hipPivots[side].rotation.x = -LEG_SWING * Math.sin(ph) * stride;
      this.kneePivots[side].rotation.x =
        KNEE_BASE + (KNEE_SWING * (1 + Math.cos(ph)) * stride) / 2 + KNEE_AIR * air;
      this.armPivots[side].rotation.x = ARM_SWING * Math.sin(ph) * stride;
    }
    this.applyPlacement();
  }

  /** Game-driven horizontal position (world units). */
  setSlide(x: number): void {
    this.laneGroup.position.x = x;
  }

  /** Game-driven jump height above the road (world units, 0 = grounded). */
  setJump(y: number): void {
    this.jumpY = y;
    this.applyPlacement();
  }

  // One owner of the figure group's y-position: feet on the road, stride bob
  // while grounded, plus the jump arc.
  private applyPlacement(): void {
    // No stride bob while airborne — the jump arc is the vertical motion.
    const grounded = this.jumpY < 0.02 ? 1 : 0;
    const bob = BOB_Y * Math.abs(Math.sin(this.phase)) * grounded;
    this.figGroup.position.y = -AVATAR_SCALE * FOOT_Y + bob * AVATAR_SCALE + this.jumpY;
  }

  /** Depth is ignored — leaning in must not grow/move the figure. */
  setZoom(_zoom: number): void {}

  /** Keep head rotations (they're the character) but drop the translation
   * channels, so shifting in the chair can't move the figure off its lane. */
  setPose(pose: HeadPose): void {
    super.setPose({ ...pose, cx: 0, cy: 0 });
  }
}
