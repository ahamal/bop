// Shared geometry for the abstract avatar look, so the home-screen HeroAvatar
// (idle) and the play-screen AbstractAvatar (tracking-driven) build the exact
// same head + torso and never drift apart. Faceted, low-poly, brand emerald.
//
// Conventions: the head group's meshes sit relative to a head pivot (head at
// y = 0.95); the torso mesh is centered at its own origin, so each caller places
// it at whatever height its layout needs.

import * as THREE from "three";

export const ACCENT = 0x34d399; // brand emerald-400
export const ACCENT_DEEP = 0x0f7a55; // deeper emerald for the torso

/** Head + nose as a group, ready to add to a head pivot. */
export function buildAbstractHead(): THREE.Group {
  const mat = new THREE.MeshStandardMaterial({
    color: ACCENT,
    roughness: 0.45,
    metalness: 0.1,
    flatShading: true, // faceted, crystalline
  });
  const group = new THREE.Group();

  // A chunky, faceted icosahedron head, very slightly elongated.
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 1), mat);
  head.scale.set(0.94, 1.08, 0.96);
  head.position.y = 0.95;
  group.add(head);

  // A low-poly nose: a slim triangular prism (3-sided cylinder) whose forward
  // vertex forms the ridge — narrower at the bridge, a touch wider at the
  // nostrils, tilted so the tip juts out more than the bridge. Sized to the
  // middle third of the face (bridge ~ eye line, nostrils well clear of the
  // mouth) rather than running forehead-to-chin. Makes the facing obvious.
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.17, 0.5, 3), mat);
  nose.scale.set(0.8, 1, 0.6);
  nose.position.set(0, 0.8, 0.84);
  nose.rotation.x = -0.22;
  group.add(nose);

  return group;
}

/** The torso: a tapered 6-sided prism, a flat face squared to the camera. */
export function buildAbstractTorso(): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: ACCENT_DEEP,
    roughness: 0.55,
    metalness: 0.1,
    flatShading: true,
  });
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 0.8, 1.6, 6), mat);
  torso.rotation.y = Math.PI / 6; // flat face forward
  return torso;
}

/** Dispose all geometries + materials under an object (for React unmount). */
export function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m.dispose());
    }
  });
}
