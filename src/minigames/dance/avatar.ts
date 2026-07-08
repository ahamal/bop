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
// The head tracks the full pose — rotation AND x/y/z translation — so it
// moves with the player's body instead of hanging static over a fixed spot.

import * as THREE from "three";
import { AbstractAvatar } from "../../avatar/AbstractAvatar.ts";

// Scaled to match the troupe (the base figure is ~2.8× a dancer's size, so it
// needs a much smaller scale than their ~0.48) and placed so the torso bottom
// meets the dance floor while the head lands level with the front row's heads
// — the star, front-and-center and only a touch larger than the backup crew.
const AVATAR_SCALE = 0.22;
const AVATAR_Y = -1.47;

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

    // (Head translation + depth are left on — no setPose/setZoom overrides —
    // so the head moves with the body instead of sitting static.)

    // Club mood: a dark backdrop and dimmed house lights so the game's
    // sweeping colored disco lights (added to stageGroup) actually read on
    // the faceted dancers instead of being washed out by the bright base rig.
    this.scene.background = new THREE.Color(0x0a0a1f);
    for (const obj of this.scene.children) {
      if (obj instanceof THREE.AmbientLight) obj.intensity = 0.32;
      else if (obj instanceof THREE.DirectionalLight) obj.intensity *= 0.45;
    }
  }
}
