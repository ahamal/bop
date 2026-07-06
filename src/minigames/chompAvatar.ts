// The Chomp playfield avatar: the real 3D AbstractAvatar (so the mouth opens
// with yours, the head turns as you turn — everything the session already
// drives), wrapped in a slide group the game moves horizontally. The base
// render loop keeps writing headPivot/bodyGroup transforms every frame, so
// game-owned adjustments live on PARENT groups those writes can't touch.
//
// Game-specific overrides: the head rests tilted UP a little (watching for
// falling snacks), and the player's depth/translation channels are disabled —
// leaning in or shifting around must not move the mouth, so "landed on the
// mouth" stays a pure function of the slide position.

import * as THREE from "three";
import type { HeadPose } from "../tracking/pose.ts";
import { AbstractAvatar } from "../avatar/AbstractAvatar.ts";

// Scaled down and dropped low so the figure sits in the lower band of the
// playfield with headroom for snacks to fall through.
export const AVATAR_SCALE = 0.55;
export const AVATAR_Y = -1.55;
// Resting upward head tilt (radians; negative rotation.x = look up).
const LOOK_UP = -0.22;

// The mouth's resting place, for collision and for spawning food in its
// plane. Local offset within the slide group: head pivot rest height -0.85,
// mouth at y 0.38 / z 0.8 inside the head — then rotated by LOOK_UP (the
// head base pivots at the slide group's origin) and scaled into world units.
const MOUTH_LOCAL_Y = -0.85 + 0.38;
const MOUTH_LOCAL_Z = 0.8;
export const MOUTH_Y =
  AVATAR_Y +
  AVATAR_SCALE * (Math.cos(LOOK_UP) * MOUTH_LOCAL_Y - Math.sin(LOOK_UP) * MOUTH_LOCAL_Z);
/** World z of the mouth plane — food falls here, right in front of the lips. */
export const ITEM_Z =
  AVATAR_SCALE * (Math.sin(LOOK_UP) * MOUTH_LOCAL_Y + Math.cos(LOOK_UP) * MOUTH_LOCAL_Z) +
  0.05;

export class ChompAvatar extends AbstractAvatar {
  // Field initializers run after super(), so the base scene graph exists.
  private slideGroup = new THREE.Group();
  private headBase = new THREE.Group(); // carries the resting look-up tilt
  /** The game parents falling snack meshes here (world coordinates). */
  readonly itemsGroup = new THREE.Group();

  constructor(canvas: HTMLCanvasElement) {
    super(canvas);
    this.slideGroup.scale.setScalar(AVATAR_SCALE);
    this.slideGroup.position.y = AVATAR_Y;
    this.headBase.rotation.x = LOOK_UP;
    // add() reparents: the figure moves out of the scene root and under the
    // slide group (head via the look-up base), pose machinery untouched.
    this.headBase.add(this.headPivot);
    this.slideGroup.add(this.headBase, this.bodyGroup);
    this.scene.add(this.slideGroup, this.itemsGroup);
  }

  /** Game-driven horizontal position (world units). */
  setSlide(x: number): void {
    this.slideGroup.position.x = x;
  }

  /** Depth is ignored in Chomp — leaning in must not grow/move the head. */
  setZoom(_zoom: number): void {}

  /** Keep head rotations (they're the character) but drop the translation
   * channels, so shifting in the chair can't move the mouth off the slide. */
  setPose(pose: HeadPose): void {
    super.setPose({ ...pose, cx: 0, cy: 0 });
  }
}
