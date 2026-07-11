// The instructor mannequin — a smooth, matte, porcelain-toned artist's figure
// that demonstrates the neck-routine moves on the Models page. Deliberately
// the visual opposite of the user's own avatar (faceted, emerald, armless):
// this one is rounded, warm-neutral, and has full arms + hands so it can do
// the hand-assist stretches.
//
// Built as a joint hierarchy (each joint is a THREE.Group at the anatomical
// pivot; meshes hang off it), so a pose is just a set of Euler targets on
// named joints — no rig file, no animation clips. Ball-joint spheres are
// rendered slightly darker at every pivot, the classic wooden-mannequin cue
// that tells the eye where the figure bends.
//
// Conventions: units ≈ meters, root at the hips (y = 0), figure faces +Z
// (toward the default camera). "L" joints are the character's anatomical
// left, which is +X — on screen the figure appears mirrored, like a mirror,
// which is what you want from an exercise instructor.

import * as THREE from "three";

// Warm porcelain body; ball joints just a shade deeper — near-body tone, so
// the pivots read from the seam and shading rather than a color break. Matte
// per the brief — just enough sheen for the key light to model the curves.
const BODY = 0xe8e0d4;
const JOINT = 0xd9d0c3;

export interface MannequinJoints {
  /** Whole figure. */
  root: THREE.Group;
  /** Spine at the waist ball — bends the whole upper body. */
  spine: THREE.Group;
  /** Base of the neck (top of the chest). */
  neck: THREE.Group;
  /** Base of the skull — most head motion splits across neck + head. */
  head: THREE.Group;
  shoulderL: THREE.Group;
  shoulderR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
  wristL: THREE.Group;
  wristR: THREE.Group;
  hipL: THREE.Group;
  hipR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  ankleL: THREE.Group;
  ankleR: THREE.Group;
}

export interface Mannequin {
  /** Add this to the scene. */
  group: THREE.Group;
  joints: MannequinJoints;
  dispose(): void;
}

export function createMannequin(): Mannequin {
  // Cartoon rendering: toon materials collapse the lighting into three flat
  // bands (the gradient map's texels are the band brightnesses), and every
  // mesh gets an inverted-hull outline — see the pass at the bottom.
  const gradientMap = new THREE.DataTexture(new Uint8Array([90, 180, 255]), 3, 1, THREE.RedFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  const bodyMat = new THREE.MeshToonMaterial({ color: BODY, gradientMap });
  const jointMat = new THREE.MeshToonMaterial({ color: JOINT, gradientMap });

  const ball = (r: number, x: number, y: number, z = 0): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), jointMat);
    m.position.set(x, y, z);
    return m;
  };
  const pivot = (parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };

  const root = new THREE.Group();

  // ----- Pelvis + full seated legs -----
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.115, 32, 24), bodyMat);
  pelvis.scale.set(1.35, 0.7, 0.95);
  pelvis.position.y = 0.1;
  root.add(pelvis);

  // Standing: each segment hangs along its joint's local −Y, and the joint's
  // rotation.x aims it — the stance is just these rest rotations, so a seated
  // variant later is a pose (hip ≈ −1.47, knee ≈ +1.35), not a rebuild.
  const leg = (side: -1 | 1) => {
    const hip = pivot(root, side * 0.09, 0.07, 0.03);
    hip.rotation.x = -0.04; // soft, natural stance — not at attention
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.25, 8, 20), bodyMat);
    thigh.position.y = -0.19;
    hip.add(thigh);

    const knee = pivot(hip, 0, -0.38);
    knee.rotation.x = 0.06;
    knee.add(ball(0.052, 0, 0));
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.046, 0.26, 8, 20), bodyMat);
    shin.position.y = -0.19;
    knee.add(shin);

    const ankle = pivot(knee, 0, -0.4);
    ankle.add(ball(0.03, 0, 0));
    // Scale flattens the local Z, which the rotation then turns vertical —
    // long axis (local Y) becomes the toes-forward direction.
    const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.09, 8, 20), bodyMat);
    foot.scale.set(0.85, 1, 0.55);
    foot.rotation.x = Math.PI / 2; // lie flat, toes forward
    foot.position.set(0, -0.05, 0.05);
    ankle.add(foot);

    return { hip, knee, ankle };
  };
  const legL = leg(1);
  const legR = leg(-1);

  // ----- Spine: waist ball, then the chest lathe -----
  const spine = pivot(root, 0, 0.2);
  spine.add(ball(0.06, 0, 0));

  // Chest profile, hips-to-shoulders (radius, y rel spine): narrow at the
  // waist, widest at the chest, rounding closed at the neck socket.
  const chestProfile = [
    [0.0, 0.045],
    [0.075, 0.05],
    [0.1, 0.1],
    [0.128, 0.18],
    [0.145, 0.26],
    [0.14, 0.31],
    [0.1, 0.355],
    [0.0, 0.38],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const chest = new THREE.Mesh(new THREE.LatheGeometry(chestProfile, 40), bodyMat);
  chest.scale.set(1.25, 1, 0.78); // broaden the shoulders, flatten front-back
  spine.add(chest);

  // ----- Neck + head -----
  const neck = pivot(spine, 0, 0.38);
  neck.add(ball(0.048, 0, 0));
  // The neck slopes slightly forward, carrying the head a touch ahead of the
  // torso like a real human's — the chin-tuck pose retracts exactly this:
  // it animates the head pivot's position.z back toward zero. The slope is
  // baked into mesh/pivot placement (not joint rotation), so joints rest at 0.
  const neckSeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.04, 8, 20), bodyMat);
  neckSeg.position.set(0, 0.035, 0.014);
  neckSeg.rotation.x = 0.4;
  neck.add(neckSeg);

  const head = pivot(neck, 0, 0.065, 0.028);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 32, 24), bodyMat);
  skull.scale.set(0.88, 1.12, 0.94);
  skull.position.set(0, 0.115, 0.01);
  head.add(skull);
  // Faceless, but a clear nose — it's the one facing cue. Same construction
  // as the abstract avatar's (abstractParts.ts): a vertical tapered wedge —
  // narrow at the bridge (eye line), wider at the nostrils, tilted so the tip
  // juts while the bridge sinks into the face. Rounded cross-section (a soft
  // wedge, not a beak), and — also borrowed from the green avatar — its own
  // slightly deeper tint, so the orientation cue pops from the face without
  // being bigger.
  const noseMat = new THREE.MeshToonMaterial({ color: 0xcdc2b1, gradientMap });
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.026, 0.065, 16), noseMat);
  nose.scale.set(0.7, 1, 0.7);
  nose.position.set(0, 0.098, 0.105);
  nose.rotation.x = -0.17;
  head.add(nose);

  // ----- Arms (hang relaxed; poses will re-aim these joints) -----
  const arm = (side: -1 | 1) => {
    const shoulder = pivot(spine, side * 0.21, 0.29);
    shoulder.add(ball(0.05, 0, 0));
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.037, 0.17, 8, 20), bodyMat);
    upper.position.y = -0.135;
    shoulder.add(upper);

    const elbow = pivot(shoulder, 0, -0.27);
    elbow.add(ball(0.037, 0, 0));
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.031, 0.16, 8, 20), bodyMat);
    fore.position.y = -0.115;
    elbow.add(fore);

    const wrist = pivot(elbow, 0, -0.24);
    wrist.add(ball(0.028, 0, 0));
    // Palm: a flattened capsule, thin across X so palms face the thighs —
    // and hand-tapered: vertices thin further toward the finger end (local
    // −Y), so the heel is plump and the fingers flatten out like a real hand.
    const palmGeo = new THREE.CapsuleGeometry(0.036, 0.055, 8, 20);
    const p = palmGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = THREE.MathUtils.clamp((0.0635 - p.getY(i)) / 0.127, 0, 1); // 0 heel → 1 fingertips
      p.setX(i, p.getX(i) * (1 - 0.5 * t));
    }
    palmGeo.computeVertexNormals();
    const palm = new THREE.Mesh(palmGeo, bodyMat);
    palm.scale.set(0.55, 1, 0.95);
    palm.position.y = -0.075;
    wrist.add(palm);
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.026, 6, 12), bodyMat);
    thumb.position.set(side * -0.008, -0.052, 0.032);
    thumb.rotation.x = -0.6;
    wrist.add(thumb);

    // Rest pose: arms angled a little outward, elbows soft, so nothing
    // intersects the torso and the figure doesn't stand at attention.
    shoulder.rotation.z = side * 0.09;
    elbow.rotation.x = -0.18;
    return { shoulder, elbow, wrist };
  };
  const left = arm(1);
  const right = arm(-1);

  // Outline pass: the inverted hull — a dark, backface-only clone of every
  // mesh whose vertices are pushed a constant couple of millimeters out along
  // their normals. (Not scaled: scale inflates away from the mesh ORIGIN, so
  // line weight varied with size and the chest — origin at its base — grew a
  // triple-weight top edge.) The camera sees the hull's inside only where it
  // pokes past the real surface: a uniform contour line that follows every
  // joint.
  const OUTLINE_W = 0.003;
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0x35302a, side: THREE.BackSide });
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o);
  });
  for (const m of meshes) {
    const hullGeo = m.geometry.clone();
    const p = hullGeo.attributes.position;
    const n = hullGeo.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      p.setXYZ(
        i,
        p.getX(i) + n.getX(i) * OUTLINE_W,
        p.getY(i) + n.getY(i) * OUTLINE_W,
        p.getZ(i) + n.getZ(i) * OUTLINE_W,
      );
    }
    const hull = new THREE.Mesh(hullGeo, outlineMat);
    hull.position.copy(m.position);
    hull.rotation.copy(m.rotation);
    hull.scale.copy(m.scale);
    m.parent!.add(hull);
  }

  const dispose = (): void => {
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    bodyMat.dispose();
    jointMat.dispose();
    noseMat.dispose();
    outlineMat.dispose();
    gradientMap.dispose();
  };

  return {
    group: root,
    joints: {
      root,
      spine,
      neck,
      head,
      shoulderL: left.shoulder,
      shoulderR: right.shoulder,
      elbowL: left.elbow,
      elbowR: right.elbow,
      wristL: left.wrist,
      wristR: right.wrist,
      hipL: legL.hip,
      hipR: legR.hip,
      kneeL: legL.knee,
      kneeR: legR.knee,
      ankleL: legL.ankle,
      ankleR: legR.ankle,
    },
    dispose,
  };
}
