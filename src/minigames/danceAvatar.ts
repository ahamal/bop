// The Dance playfield avatar: the real 3D AbstractAvatar as the front-and-
// center member of an idol-group formation (the pattern proven by
// ChompAvatar — the playfield IS the avatar's scene). The base render loop
// keeps writing headPivot/bodyGroup transforms every frame, so the game-owned
// placement lives on a PARENT group those writes can't touch.
//
// Everything else on stage — the backup dancers, the rhythm lane, the falling
// move tokens — is built and animated by the game inside stageGroup; this
// class only owns the player figure's placement.
//
// Game-specific overrides: the player's depth/translation channels are
// disabled — only head ROTATION is the dance, so shifting in the chair or
// leaning in must not move the figure out of formation.

import * as THREE from "three";
import type { HeadPose } from "../tracking/pose.ts";
import { AbstractAvatar } from "../avatar/AbstractAvatar.ts";

// Scaled down and dropped low: front row of the formation, with headroom
// above for the backup dancers' row and the token lane.
const AVATAR_SCALE = 0.5;
const AVATAR_Y = -1.9;

export class DanceAvatar extends AbstractAvatar {
  // Field initializers run after super(), so the base scene graph exists.
  private playerGroup = new THREE.Group();
  /** The game parents dancers, the lane, and tokens here (world coordinates). */
  readonly stageGroup = new THREE.Group();

  constructor(canvas: HTMLCanvasElement) {
    super(canvas);
    this.playerGroup.scale.setScalar(AVATAR_SCALE);
    this.playerGroup.position.y = AVATAR_Y;
    // add() reparents: the figure moves out of the scene root and under the
    // player group, pose machinery untouched.
    this.playerGroup.add(this.headPivot, this.bodyGroup);
    this.scene.add(this.playerGroup, this.stageGroup);
  }

  /** Depth is ignored — leaning in must not grow/move the figure. */
  setZoom(_zoom: number): void {}

  /** Keep head rotations (they ARE the dance) but drop the translation
   * channels, so shifting in the chair can't slide the figure around. */
  setPose(pose: HeadPose): void {
    super.setPose({ ...pose, cx: 0, cy: 0 });
  }
}
