// Shared low-poly prop builders for the minigames. A prop that more than one
// game drops/kicks/dodges lives here as a FACTORY: create one per game, build
// as many instances as you like (they share the factory's geometries and
// materials — meshes are per-instance, GPU resources aren't), and dispose the
// factory with the game.

import * as THREE from "three";

export interface PropFactory {
  /** A fresh instance parented wherever the game likes. */
  build(): THREE.Object3D;
  /** Release the shared GPU resources behind every built instance. */
  dispose(): void;
}

// The 12 vertices of an icosahedron (golden-ratio rectangles), normalized.
// On a real soccer ball (truncated icosahedron) the black pentagons sit
// exactly at these directions — so patches placed here read as the classic
// checker from any tumble angle, with perfect symmetry.
const PHI = (1 + Math.sqrt(5)) / 2;
const PENTA_DIRS: readonly THREE.Vector3[] = (
  [
    [-1, PHI, 0],
    [1, PHI, 0],
    [-1, -PHI, 0],
    [1, -PHI, 0],
    [0, -1, PHI],
    [0, 1, PHI],
    [0, -1, -PHI],
    [0, 1, -PHI],
    [PHI, 0, -1],
    [PHI, 0, 1],
    [-PHI, 0, -1],
    [-PHI, 0, 1],
  ] as const
).map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());

/**
 * A soccer ball: white sphere with 12 flattened black domes at the
 * icosahedral pentagon spots. Chomp drops it as not-food; Header! will head
 * it at the goal.
 */
export function soccerBallFactory(radius = 0.24): PropFactory {
  const ballGeo = new THREE.SphereGeometry(radius, 12, 9);
  // Pentagon angular radius on a truncated icosahedron is ~20°, i.e. a cap
  // chord of about sin(20°) ≈ 0.34 R.
  const patchGeo = new THREE.SphereGeometry(radius * 0.34, 6, 4);
  const white = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    roughness: 0.35,
    metalness: 0.05,
    flatShading: true,
  });
  const black = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.4,
    metalness: 0.05,
    flatShading: true,
  });
  const up = new THREE.Vector3(0, 1, 0);
  return {
    build() {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(ballGeo, white));
      for (const dir of PENTA_DIRS) {
        const patch = new THREE.Mesh(patchGeo, black);
        patch.scale.y = 0.35; // dome pressed into the surface
        patch.position.copy(dir).multiplyScalar(radius * 0.93);
        patch.quaternion.setFromUnitVectors(up, dir);
        g.add(patch);
      }
      return g;
    },
    dispose() {
      ballGeo.dispose();
      patchGeo.dispose();
      white.dispose();
      black.dispose();
    },
  };
}
