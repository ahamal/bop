// A decorative 3D head-and-torso shown above the title on the home screen — the
// first thing people see. Unlike the tracking Avatar (src/avatar/avatar.ts), this one
// is NOT webcam-driven: a gentle sway/bob/breathe base layer plus an IdleBrain
// (randomized idle actions, the signature neck stretch, lazy pointer awareness)
// so the landing feels alive rather than metronomic. Deliberately abstract —
// faceted, low-poly primitives in the brand color on a transparent background,
// no face details.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import {
  ACCENT,
  buildAbstractHead,
  buildAbstractTorso,
  disposeTree,
} from "./abstractParts.ts";
import { IdleBrain } from "./idleBrain.ts";

export function HeroAvatar({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true, // transparent background — composites over the page
    });
    renderer.setClearAlpha(0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
    camera.position.set(0, 0.3, 7);
    camera.lookAt(0, 0.1, 0);

    // Lighting tuned for faceted shading: soft ambient + a key to catch the
    // facet edges + an emerald rim so the silhouette glows on a dark page.
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(2, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(ACCENT, 0.6);
    rim.position.set(-3, 1, -3);
    scene.add(rim);

    // The whole avatar lives under one group so the idle animation can sway it
    // as a unit; head and torso then add their own small motions on top.
    const root = new THREE.Group();
    scene.add(root);

    // The brain's exercise movements (nods, tilts, the stretch) hinge from a
    // lower pivot down toward the torso, so the whole head arcs like bending
    // from the upper spine instead of swiveling at the chin. headPivot sits
    // inside it, lifted back up so the head's resting position is unchanged;
    // the base idle sway stays on headPivot (the neck).
    const spinePivot = new THREE.Group();
    spinePivot.position.y = -0.5;
    const headPivot = new THREE.Group();
    headPivot.position.y = 0.5;
    spinePivot.add(headPivot);
    const torso = new THREE.Group();
    root.add(spinePivot, torso);

    // Head + torso from the shared abstract geometry, so the home avatar matches
    // the play-screen one exactly. The torso hangs just below the head with a
    // small gap so the two read as separate shapes. The torso group's origin
    // sits at the torso's base so its follow-through leans look hip-driven.
    headPivot.add(buildAbstractHead());
    torso.position.y = -1.9;
    const body = buildAbstractTorso();
    body.position.y = 0.75; // torso center, relative to the base pivot
    torso.add(body);

    function resize(): void {
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener("resize", resize);

    // Respect reduced-motion: hold a still pose, no idle brain.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Personality layer: randomized idle actions (which replaced the old
    // fixed-period nod), the neck stretch, pointer awareness. Fed the cursor's
    // offset from the canvas center in canvas widths.
    const brain = new IdleBrain();
    const onPointerMove = (e: PointerEvent): void => {
      const r = canvas.getBoundingClientRect();
      const w = r.width || 1;
      brain.setPointer(
        (e.clientX - (r.left + r.width / 2)) / w,
        (e.clientY - (r.top + r.height / 2)) / w,
      );
    };
    if (!reduce) window.addEventListener("pointermove", onPointerMove);

    let rafId = 0;
    const start = performance.now();
    const loop = (now: number): void => {
      const t = reduce ? 0 : (now - start) / 1000;
      // Base layer: slow sway of the whole figure, gentle head bob and
      // counter-turn, subtle "breathing" scale on the torso. All sinusoidal,
      // all small — the brain's offsets sit on top.
      root.rotation.y = Math.sin(t * 0.5) * 0.35;
      root.position.y = Math.sin(t * 0.9) * 0.06;
      headPivot.rotation.x = Math.sin(t * 0.6 + 1) * 0.05;
      headPivot.rotation.y = 0;
      headPivot.rotation.z = Math.sin(t * 0.7) * 0.06;
      root.position.x = 0;
      if (!reduce) {
        // The head meshes sit above headPivot, so these rotations swing the
        // head around the invisible neck like a hinge.
        const idle = brain.update(t);
        spinePivot.rotation.x = idle.pitch;
        spinePivot.rotation.z = idle.roll;
        headPivot.rotation.y += idle.yaw;
        root.position.x = idle.rootX;
        // The body joins in: the torso follows the head with a fraction of
        // each movement, leaning from its base — whole-body exercise, with
        // the head still leading.
        torso.rotation.x = idle.pitch * 0.25;
        torso.rotation.y = idle.yaw * 0.2;
        torso.rotation.z = idle.roll * 0.35;
      }
      const breathe = 1 + Math.sin(t * 1.1) * 0.02;
      torso.scale.set(breathe, 1, breathe);

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      disposeTree(root);
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
