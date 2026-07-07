// GPU-resource bag for microgames. Every 3D game creates a pile of shared
// geometries/materials in its constructor and must dispose them all in
// dispose() — this owns that bookkeeping so a game can't leak by forgetting
// one. Meshes are cheap and per-instance; geometries and materials are the
// GPU residents that need explicit disposal.
//
// Usage:
//   private bag = new ResourceBag();
//   const geo = this.bag.geo, mat = this.bag.mat;   // arrow fns, safe to alias
//   const hullGeo = geo(new THREE.BoxGeometry(1.5, 0.5, 2.4));
//   const olive = mat(0x5b6b3a, 0.7);
//   ...
//   dispose(): void { this.bag.dispose(); this.session.detachAvatar(); }

import * as THREE from "three";

export class ResourceBag {
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];

  /** Track a geometry for disposal; returns it for inline use. */
  geo = <G extends THREE.BufferGeometry>(g: G): G => {
    this.geos.push(g);
    return g;
  };

  /** A flat-shaded standard material in the house look, tracked. */
  mat = (color: number, roughness = 0.6): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness: 0.08,
      flatShading: true,
    });
    this.mats.push(m);
    return m;
  };

  /** Track a custom material (basic, double-sided, etc.) for disposal. */
  track = <M extends THREE.Material>(m: M): M => {
    this.mats.push(m);
    return m;
  };

  /** Release everything tracked. Safe to call once, from the game's dispose. */
  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.geos = [];
    this.mats = [];
  }
}
