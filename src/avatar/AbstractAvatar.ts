// A tracking-driven avatar with an ABSTRACT look — the same faceted geometry as
// the home-screen HeroAvatar (shared via abstractParts), but here wired to the
// live head pose. It reuses all of Avatar's pose-driving machinery (smoothing,
// setPose/setBody/setZoom, render loop) and only swaps the geometry. Used on the
// play screen; the dev page keeps the readable Avatar for diagnostics.
//
// Expression: the head is featureless (nose only) until the player does
// something notable — the mouth appears as it opens, and a closed eye shows as
// a "—" dash. Person-left maps to screen-left (mirror view), matching the rest
// of the avatar's handedness.

import * as THREE from "three";
import { Avatar } from "./avatar.ts";
import type { FaceExpression } from "../tracking/face.ts";
import { buildAbstractHead, buildAbstractTorso } from "./abstractParts.ts";

// Inset material for mouth/eye shapes — a darker emerald (not black), so the
// features read as shaded facets of the same crystal.
const INSET = 0x0c6b4a;

// Show a feature once its smoothed signal clears this (hysteresis comes free
// from the render-loop smoothing).
const SHOW = 0.2;

export class AbstractAvatar extends Avatar {
  // `declare` (not `!`): these are assigned in buildHead(), which the BASE
  // constructor calls — a plain field declaration would re-initialize them to
  // undefined after super() returns and wipe the meshes.
  private declare mouth: THREE.Mesh;
  private declare eyeDashL: THREE.Mesh; // screen-left = person's left eye
  private declare eyeDashR: THREE.Mesh;

  // Aim lower than the dev avatar so the figure sits higher in frame and more
  // of the torso is visible.
  protected frameCamera(): void {
    this.camera.position.set(0, -0.2, 8.5);
    this.camera.lookAt(0, -0.6, 0);
  }

  protected buildBody(): void {
    const torso = buildAbstractTorso();
    torso.position.y = -0.55; // hang below the shoulder pivot
    this.torsoGroup.add(torso);
  }

  protected buildHead(): void {
    const head = buildAbstractHead();
    const inset = new THREE.MeshStandardMaterial({ color: INSET, roughness: 0.6 });

    // Mouth: a flattened dark ellipsoid in the lower third of the face, well
    // below the nose (nostrils end ~y 0.57), scaled open per frame.
    this.mouth = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), inset);
    this.mouth.position.set(0, 0.38, 0.8);
    this.mouth.visible = false;
    head.add(this.mouth);

    // Closed-eye dashes: slim horizontal capsules, kept thin and translucent —
    // at full size/opacity they read as heavy "angry brows" rather than gently
    // shut eyes. Own material (not the mouth's) for the see-through look.
    const eyeMat = new THREE.MeshStandardMaterial({
      color: INSET,
      roughness: 0.6,
      transparent: true,
      opacity: 0.5,
    });
    for (const side of [-1, 1] as const) {
      const dash = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.16, 4, 8), eyeMat);
      dash.rotation.z = Math.PI / 2;
      dash.position.set(side * 0.26, 0.88, 0.87);
      dash.visible = false;
      head.add(dash);
      if (side < 0) this.eyeDashL = dash;
      else this.eyeDashR = dash;
    }

    this.headPivot.add(head);
  }

  protected applyFace(f: FaceExpression): void {
    this.mouth.visible = f.mouthOpen > SHOW;
    if (this.mouth.visible) {
      // Widen slightly and open vertically with the signal (capped so a full
      // gape stays inside the lower third of the face).
      this.mouth.scale.set(0.2 + 0.08 * f.mouthOpen, 0.04 + 0.1 * f.mouthOpen, 0.08);
    }
    this.eyeDashL.visible = f.leftEyeClosed > SHOW;
    this.eyeDashR.visible = f.rightEyeClosed > SHOW;
  }
}
