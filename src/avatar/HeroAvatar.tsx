// A decorative 3D head-and-torso shown above the title on the home screen — the
// first thing people see. Unlike the tracking Avatar (src/avatar/avatar.ts), this one
// is NOT webcam-driven: it just idles with a gentle sway/bob/breathe so the
// landing feels alive. Deliberately abstract — faceted, low-poly primitives in
// the brand color on a transparent background, no face details.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import {
  ACCENT,
  buildAbstractHead,
  buildAbstractTorso,
  disposeTree,
} from "./abstractParts.ts";

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
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
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

    const headPivot = new THREE.Group();
    const torso = new THREE.Group();
    root.add(headPivot, torso);

    // Head + torso from the shared abstract geometry, so the home avatar matches
    // the play-screen one exactly. The torso hangs just below the head with a
    // small gap so the two read as separate shapes.
    headPivot.add(buildAbstractHead());
    const body = buildAbstractTorso();
    body.position.y = -1.15;
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

    // Respect reduced-motion: hold a still pose instead of idling.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let rafId = 0;
    const start = performance.now();
    const loop = (now: number): void => {
      const t = reduce ? 0 : (now - start) / 1000;
      // Slow sway of the whole figure + a gentle head bob and counter-turn, plus
      // a subtle "breathing" scale on the torso. All sinusoidal, all small.
      root.rotation.y = Math.sin(t * 0.5) * 0.35;
      root.position.y = Math.sin(t * 0.9) * 0.06;
      headPivot.rotation.z = Math.sin(t * 0.7) * 0.06;
      // A soft nod once every 2s, pivoting around the invisible neck (the head
      // mesh sits above headPivot, so rotation.x swings it like a hinge). A gentle
      // half-sine dip-and-return over ~0.5s, flat the rest of the cycle, layered
      // on top of the idle head sway.
      const beat = t % 2;
      const nod = beat < 0.5 ? Math.sin((beat / 0.5) * Math.PI) * 0.16 : 0;
      headPivot.rotation.x = Math.sin(t * 0.6 + 1) * 0.05 + nod;
      const breathe = 1 + Math.sin(t * 1.1) * 0.02;
      torso.scale.set(breathe, 1, breathe);

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      disposeTree(root);
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
