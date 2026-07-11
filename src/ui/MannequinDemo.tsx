// A small, self-contained instructor viewport: the porcelain mannequin
// (avatar/mannequin.ts) demonstrating one move on a transparent canvas.
// Framed torso-up — wide enough for the raised hand-assist arm. Static poses
// ease in and hold; one-shot tracks (the rolls) replay on an interval so the
// motion can't be missed. The pose id is the only thing that goes through
// React; all motion runs in the poser's own rAF loop.

import { useEffect, useRef, type CSSProperties } from "react";
import * as THREE from "three";
import { ACCENT } from "../avatar/abstractParts.ts";
import { createMannequin } from "../avatar/mannequin.ts";
import { createPoser, type Poser } from "../avatar/mannequinPoses.ts";

// Roll sweep ≈ 2.65s; hold the far end for a beat, then replay.
const REPLAY_MS = 4200;

// Per-move camera azimuth (radians around the figure; 0 = front, + = camera
// swings toward the figure's left / screen-right). Each move is framed from
// its most legible viewpoint — the cut is information, not decoration:
// sagittal moves (tuck, chin drop, look up) read near-profile, tilts get a
// gentle three-quarter toward the bend, rolls lead the sweep, looks swing
// opposite the turn so the turned head stays visible. The camera EASES to
// each new angle alongside the pose transition, plus a slow ±3° ambient
// drift so no hold ever feels frozen.
const CAM_AZIMUTH: Record<string, number> = {
  neutral: 0,
  tiltLeft: -0.35,
  tiltRight: 0.35,
  tiltLeftAssist: -0.5,
  tiltRightAssist: 0.5,
  lookLeft: 0.3,
  lookRight: -0.3,
  chinToChest: 0.8,
  lookUp: 1.0,
  chinTuck: 1.25,
  rollLtoR: -0.4,
  rollRtoL: 0.4,
};
// ...plus a per-move Dutch tilt: the frame cants a few degrees, leaning into
// the move (roll about the camera's view axis, via the up vector). Kept
// subtle — it should read as style, not a crooked render.
const CAM_ROLL: Record<string, number> = {
  neutral: 0,
  tiltLeft: -0.08,
  tiltRight: 0.08,
  tiltLeftAssist: -0.1,
  tiltRightAssist: 0.1,
  lookLeft: 0.05,
  lookRight: -0.05,
  chinToChest: 0.06,
  lookUp: -0.08,
  chinTuck: -0.06,
  rollLtoR: -0.1,
  rollRtoL: 0.1,
};
// ...and a per-move camera lift (added to CAM_Y): the hand-assist cards ride
// a little higher so the view angles down onto the hand resting on the crown.
const CAM_LIFT: Record<string, number> = {
  tiltLeftAssist: 0.55,
  tiltRightAssist: 0.55,
};
const CAM_DIST = 1.55;
const CAM_Y = 0.57;
const LOOK_Y = 0.52;

export function MannequinDemo({
  pose,
  className,
  style,
}: {
  pose: string;
  className?: string;
  style?: CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poserRef = useRef<Poser | null>(null);
  const azimuthGoal = useRef(0);
  const rollGoal = useRef(0);
  const liftGoal = useRef(0);
  // How many times each pose has been shown — repeated moves (the five chin
  // tucks, the second roll pair) mirror their viewpoint on every other visit
  // so the reps don't feel copy-pasted.
  const visitsRef = useRef(new Map<string, number>());

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setClearAlpha(0);

    // Torso-up: chest centered, hips at the bottom edge, headroom for the
    // overhead assist elbow at the sides.
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
    camera.position.set(0, CAM_Y, CAM_DIST);
    camera.lookAt(0, LOOK_Y, 0);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(1.5, 2.5, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(ACCENT, 0.6);
    rim.position.set(-3, 1, -3);
    scene.add(rim);

    const mannequin = createMannequin();
    scene.add(mannequin.group);
    const poser = createPoser(mannequin);
    poserRef.current = poser;

    const resize = (): void => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let last = performance.now();
    let azimuth = 0;
    let roll = 0;
    let lift = 0;
    const tick = (now: number): void => {
      // Clamp dt so a backgrounded tab doesn't fast-forward the tween.
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      poser.update(dt, now / 1000);
      // Ease the camera toward the move's viewpoint + the ambient drift; the
      // Dutch roll rides along via the up vector (with its own slower drift,
      // phase-shifted so the two never sway in lockstep).
      const t = now / 1000;
      const ease = 1 - Math.exp(-3 * dt);
      azimuth += (azimuthGoal.current + Math.sin(t * 0.12) * 0.05 - azimuth) * ease;
      roll += (rollGoal.current + Math.sin(t * 0.09 + 1) * 0.02 - roll) * ease;
      lift += (liftGoal.current - lift) * ease;
      camera.up.set(Math.sin(roll), Math.cos(roll), 0);
      camera.position.set(Math.sin(azimuth) * CAM_DIST, CAM_Y + lift, Math.cos(azimuth) * CAM_DIST);
      camera.lookAt(0, LOOK_Y, 0);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      poserRef.current = null;
      mannequin.dispose();
      renderer.dispose();
    };
  }, []);

  // Fade the figure in once, when the demo first appears.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.opacity = "0";
    void canvas.offsetWidth; // commit before the transition kicks in
    canvas.style.transition = "opacity 0.5s ease";
    canvas.style.opacity = "1";
  }, []);

  // Ease into the new pose + its viewpoint; one-shot rolls replay until the
  // card changes.
  useEffect(() => {
    poserRef.current?.setPose(pose);
    const visits = visitsRef.current.get(pose) ?? 0;
    visitsRef.current.set(pose, visits + 1);
    const side = visits % 2 === 1 ? -1 : 1;
    azimuthGoal.current = (CAM_AZIMUTH[pose] ?? 0) * side;
    rollGoal.current = (CAM_ROLL[pose] ?? 0) * side;
    liftGoal.current = CAM_LIFT[pose] ?? 0;
    if (!pose.startsWith("roll")) return;
    const id = window.setInterval(() => poserRef.current?.setPose(pose), REPLAY_MS);
    return () => window.clearInterval(id);
  }, [pose]);

  return <canvas ref={canvasRef} className={className} style={style} />;
}
