// The models authoring page (#models) — the staging ground for the instructor
// mannequin that demonstrates each move in the neck routine. The figure is
// procedural (src/avatar/mannequin.ts), no asset files: a pose is Euler
// targets on its named joints (src/avatar/mannequinPoses.ts), and clicking a
// move eases the figure into it. Orbit-drag the viewport to inspect from any
// angle.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ThemeIconButton } from "./ThemeIconButton.tsx";
import { Button } from "./Button.tsx";
import { BackBar } from "./BackBar.tsx";
import { ACCENT } from "../avatar/abstractParts.ts";
import { createMannequin } from "../avatar/mannequin.ts";
import { createPoser, type Poser } from "../avatar/mannequinPoses.ts";

// The routine's moves, deduped to one entry per distinct pose (the 5 chin-tuck
// reps and the 4 roll passes collapse to a single card each). Stable ids —
// each will key a pose (joint-rotation targets) on the mannequin.
const MOVES = [
  { id: "neutral", label: "Neutral" },
  { id: "tiltLeft", label: "Tilt left" },
  { id: "tiltRight", label: "Tilt right" },
  { id: "lookLeft", label: "Look left" },
  { id: "lookRight", label: "Look right" },
  { id: "tiltLeftAssist", label: "Hand-assist left" },
  { id: "tiltRightAssist", label: "Hand-assist right" },
  { id: "chinToChest", label: "Chin to chest" },
  { id: "lookUp", label: "Look up" },
  { id: "chinTuck", label: "Chin tuck" },
  { id: "rollLtoR", label: "Roll left → right" },
  { id: "rollRtoL", label: "Roll right → left" },
] as const;

export function ModelsScreen({ onExit }: { onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState<string>(MOVES[0].id);
  const poserRef = useRef<Poser | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setClearAlpha(0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0.3, 3.1);

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

    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0.06, 0);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 0.8;
    controls.maxDistance = 5;
    controls.update();

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
    const tick = (now: number): void => {
      // Clamp dt so a backgrounded tab doesn't fast-forward the tween.
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      poser.update(dt, now / 1000);
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      poserRef.current = null;
      controls.dispose();
      mannequin.dispose();
      renderer.dispose();
    };
  }, []);


  return (
    <div className="min-h-screen bg-bg text-text">
      <BackBar onBack={onExit} />
      <div className="absolute right-4 top-4">
        <ThemeIconButton />
      </div>

      <div className="mx-auto max-w-2xl px-6 pb-24 pt-16">
        <h1 className="mb-2 text-4xl font-bold tracking-tight">Models</h1>
        <p className="mb-8 text-muted">
          Pick a move and the mannequin eases into it — drag to orbit.
        </p>

        {/* The mannequin viewport. */}
        <div className="relative mx-auto aspect-[4/3] w-full max-w-md overflow-hidden rounded-2xl">
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full cursor-grab" />
        </div>

        {/* One button per move; the selected one is highlighted. */}
        <div className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {MOVES.map((m) => (
            <Button
              key={m.id}
              variant="outline"
              onClick={() => {
                setSelected(m.id);
                // In the handler (not an effect on `selected`) so re-clicking
                // a one-shot move like a roll replays it.
                poserRef.current?.setPose(m.id);
              }}
              className={`w-full ${
                m.id === selected ? "border-accent! bg-accent/10 text-accent!" : ""
              }`}
            >
              {m.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
