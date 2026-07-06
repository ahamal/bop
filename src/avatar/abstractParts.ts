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
export const INSET = 0x0c6b4a; // darker emerald for face features (mouth, eye dashes)

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
  // Its own, glossier material: the nose is the face's main orientation cue,
  // and a shinier surface catches the key/rim lights as the head turns.
  const noseMat = new THREE.MeshStandardMaterial({
    color: ACCENT,
    roughness: 0.32,
    metalness: 0.4,
    flatShading: true,
  });
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.17, 0.5, 3), noseMat);
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

/**
 * Closed-eye dashes: slim horizontal capsules, kept thin and translucent — at
 * full size/opacity they read as heavy "angry brows" rather than gently shut
 * eyes. Positioned for the abstract head; add both to the head group. Start
 * hidden; the caller toggles `visible` from the eye-closed signal.
 */
export function buildEyeDashes(): { left: THREE.Mesh; right: THREE.Mesh } {
  const mat = new THREE.MeshStandardMaterial({
    color: INSET,
    roughness: 0.6,
    transparent: true,
    opacity: 0.5,
  });
  const make = (side: -1 | 1): THREE.Mesh => {
    const dash = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.16, 4, 8), mat);
    dash.rotation.z = Math.PI / 2;
    dash.position.set(side * 0.26, 0.88, 0.87);
    dash.visible = false;
    return dash;
  };
  return { left: make(-1), right: make(1) };
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
