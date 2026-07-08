// The Drone Drop playfield avatar: the real 3D AbstractAvatar (tracked head +
// torso) hanging from a low-poly quadcopter on a BOMBING RUN — the craft
// always flies forward, the game steers its heading, and a third-person
// chase camera follows behind. The figure faces the direction of travel
// (back to the camera), so the per-avatar handedness is flipped (viewSign;
// same reasoning as the Traffic runner). The base render loop keeps writing
// headPivot/bodyGroup transforms every frame, so game-owned motion lives on
// the PARENT craft group.
//
// The avatar owns the flight presentation: heading, bank-into-the-turn, the
// slight nose-down cruise attitude, the chase camera, and the spinning rotor
// discs (animate(dt)). The game owns the flight MODEL — where the craft is
// and where it's pointed.

import * as THREE from "three";
import type { HeadPose } from "../../tracking/pose.ts";
import { AbstractAvatar } from "../../avatar/AbstractAvatar.ts";
import { ACCENT } from "../../avatar/abstractParts.ts";

/** World y of the ground plane. */
export const GROUND_Y = -2.62;
/** World y the craft flies at (fixed altitude). */
export const FLY_Y = 1.3;
/** World y where a released payload starts: just under the dangling figure. */
export const DROP_Y = -0.35;

const FIGURE_SCALE = 0.34;
const HANG_Y = -0.45; // figure origin below the craft's center

const BANK_MAX = 0.45; // full-tilt bank into the turn (radians)
const NOSE_TIP = 0.1; // constant nose-down cruise attitude
const PITCH_TIP = 0.28; // extra nose dip/lift from the throttle (radians)
const ROTOR_RAD_PER_MS = 0.05;

// Chase camera: behind and above the craft, looking a touch ahead and down.
const CAM_BACK = 20;
const CAM_UP = 10;
const LOOK_AHEAD = 10;
const LOOK_Y = -2.2;

export class DroneAvatar extends AbstractAvatar {
  // Field initializers run after super(), so the base scene graph exists.
  private craftGroup = new THREE.Group(); // game-flown position + attitude
  /** The game parents tank / payload / ground meshes here (world coords). */
  readonly worldGroup = new THREE.Group();

  private declare rotors: THREE.Mesh[];
  // Chase view shows the figure from behind — true handedness (see Avatar).
  protected viewSign = -1 as const;

  constructor(canvas: HTMLCanvasElement) {
    super(canvas);
    this.craftGroup.position.set(0, FLY_Y, 0);
    // Yaw-pitch-roll order so heading is outermost, then the nose tip, then
    // the bank about the craft's own forward axis.
    this.craftGroup.rotation.order = "YXZ";
    // The figure hangs under the craft, faced along the flight direction
    // (craft-forward is -z, the figure's default facing is +z, hence the
    // flip); pose machinery untouched by the reparent.
    const hang = new THREE.Group();
    hang.scale.setScalar(FIGURE_SCALE);
    hang.position.y = HANG_Y;
    hang.rotation.y = Math.PI;
    hang.add(this.headPivot, this.bodyGroup);
    this.craftGroup.add(hang);
    this.buildCraft();
    this.scene.add(this.craftGroup, this.worldGroup);
  }

  // Overridden per-frame by followCamera; this is just the pre-flight view.
  protected frameCamera(): void {
    this.camera.position.set(0, FLY_Y + CAM_UP, CAM_BACK);
    this.camera.lookAt(0, FLY_Y + LOOK_Y, -LOOK_AHEAD);
  }

  // A chunky quad: slate hull, diagonal arms, translucent emerald rotor
  // discs (spun in animate — a solid disc reads as a blur-circle), skids.
  private buildCraft(): void {
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.5,
      metalness: 0.15,
      flatShading: true,
    });
    const rotorMat = new THREE.MeshStandardMaterial({
      color: ACCENT,
      roughness: 0.35,
      transparent: true,
      opacity: 0.55,
    });

    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.7), hullMat);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), hullMat);
    dome.position.y = 0.14;
    this.craftGroup.add(hull, dome);

    const armGeo = new THREE.BoxGeometry(0.09, 0.05, 1.5);
    const rotorGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.03, 10);
    const hubGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.1, 6);
    this.rotors = [];
    for (const angle of [Math.PI / 4, -Math.PI / 4]) {
      const arm = new THREE.Mesh(armGeo, hullMat);
      arm.rotation.y = angle;
      this.craftGroup.add(arm);
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = sx * 0.53;
      const z = sz * 0.53;
      const hub = new THREE.Mesh(hubGeo, hullMat);
      hub.position.set(x, 0.06, z);
      const rotor = new THREE.Mesh(rotorGeo, rotorMat);
      rotor.position.set(x, 0.12, z);
      this.craftGroup.add(hub, rotor);
      this.rotors.push(rotor);
    }
    // Skids the dangling figure hangs between.
    const skidGeo = new THREE.BoxGeometry(0.06, 0.05, 0.8);
    for (const sx of [-1, 1]) {
      const skid = new THREE.Mesh(skidGeo, hullMat);
      skid.position.set(sx * 0.3, -0.16, 0);
      this.craftGroup.add(skid);
    }
  }

  /**
   * Place the craft on its run and swing the chase camera in behind it.
   * heading 0 = -z, positive turns left (screen-left); roll01 is the bank
   * input, -1..1, tipping the craft into the turn.
   */
  setCraft(x: number, z: number, heading: number, roll01: number, pitch01 = 0): void {
    this.craftGroup.position.set(x, FLY_Y, z);
    // Chin down (pitch01 > 0) dips the nose further for a diving-in feel.
    this.craftGroup.rotation.set(NOSE_TIP + pitch01 * PITCH_TIP, heading, roll01 * BANK_MAX);
    const dx = -Math.sin(heading);
    const dz = -Math.cos(heading);
    this.camera.position.set(x - dx * CAM_BACK, FLY_Y + CAM_UP, z - dz * CAM_BACK);
    this.camera.lookAt(x + dx * LOOK_AHEAD, FLY_Y + LOOK_Y, z + dz * LOOK_AHEAD);
  }

  /** Spin the rotors — call every frame. */
  animate(dt: number): void {
    for (let i = 0; i < this.rotors.length; i++) {
      this.rotors[i].rotation.y += (i % 2 ? 1 : -1) * ROTOR_RAD_PER_MS * dt;
    }
  }

  /** Depth is ignored — leaning in must not move the craft. */
  setZoom(_zoom: number): void {}

  /** Keep head rotations (they're the character) but drop the translation
   * channels — position is flown, not shifted in the chair. */
  setPose(pose: HeadPose): void {
    super.setPose({ ...pose, cx: 0, cy: 0 });
  }
}
