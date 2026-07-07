// The Mimic playfield avatar: the AbstractAvatar seen from BEHIND, facing
// the card table like a player seated at it — head turns, tilts, and mouth
// are the feedback that a move registered. Back view means TRUE handedness,
// not mirrored: when you look left, the figure's actual left turns, which
// from behind is also screen-left — so the card arrows stay honest. Scaled
// down and dropped low so the table owns the upper band. The base render
// loop keeps writing headPivot/bodyGroup transforms every frame, so the
// game-owned placement lives on a PARENT group those writes can't touch.
//
// Game-specific overrides: depth/translation channels are disabled — only
// the move vocabulary (rotations + mouth) is the game, so shifting in the
// chair must not wander the figure around the frame.

import * as THREE from "three";
import { AbstractAvatar } from "../../avatar/AbstractAvatar.ts";

const AVATAR_SCALE = 0.55;
const AVATAR_Y = -1.7;

export class MimicAvatar extends AbstractAvatar {
  // Field initializers run after super(), so the base scene graph exists.
  private figGroup = new THREE.Group();
  /** The game parents the 3D cards + pointing hand here (world coordinates). */
  readonly stageGroup = new THREE.Group();

  // Back-to-camera: the π y-flip below negates how the mirrored channels
  // render, so flip the per-avatar handedness to compensate (see Avatar).
  protected viewSign = -1 as const;

  constructor(canvas: HTMLCanvasElement) {
    super(canvas);
    this.figGroup.scale.setScalar(AVATAR_SCALE);
    this.figGroup.position.y = AVATAR_Y;
    // Facing the table, back to the camera.
    this.figGroup.rotation.y = Math.PI;
    // add() reparents: the figure moves under the placement group, pose
    // machinery untouched.
    this.figGroup.add(this.headPivot, this.bodyGroup);
    this.scene.add(this.figGroup, this.stageGroup);
  }

  // Raised and tilted down so the tabletop past the figure reads as a
  // surface seen from above the seated player's shoulder.
  protected frameCamera(): void {
    this.camera.position.set(0, 1.8, 6.0);
    this.camera.lookAt(0, -1.3, -1.8);
  }

  /** Depth stays off — a lean-in zoom would push the seated figure's head
   * into the table. Head TRANSLATION stays live (unlike the slide/lane
   * games): nothing here judges position, and the torso already follows the
   * shoulders, so a frozen head over a moving body read as broken. */
  setZoom(_zoom: number): void {}
}
