// A tracking-driven avatar with an ABSTRACT look — the same faceted geometry as
// the home-screen HeroAvatar (shared via abstractParts), but here wired to the
// live head pose. It reuses all of Avatar's pose-driving machinery (smoothing,
// setPose/setBody/setZoom, render loop) and only swaps the geometry. Used on the
// play screen; the dev page keeps the readable Avatar for diagnostics.

import { Avatar } from "./avatar.ts";
import { buildAbstractHead, buildAbstractTorso } from "./abstractParts.ts";

export class AbstractAvatar extends Avatar {
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
    this.headPivot.add(buildAbstractHead());
  }
}
