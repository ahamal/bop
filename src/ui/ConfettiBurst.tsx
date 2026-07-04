// A one-shot confetti blast: fires on mount, draws itself on a canvas covering
// its nearest positioned ancestor, and goes quiet once the burst has played
// out. Mount it when the routine completes; remounting fires it again.

import { useEffect, useRef } from "react";

const COLORS = ["#34d399", "#fbbf24", "#f472b6", "#60a5fa", "#a78bfa", "#f87171"];
const COUNT = 80;
const GRAVITY = 900; // px/s² (pre-dpr)
const DRAG = 0.35; // fraction of velocity retained after one second
const LIFE_MS = 3200;
const FADE_MS = 800; // fade-out window at the end of LIFE_MS

export function ConfettiBurst() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const W = (canvas.width = canvas.clientWidth * dpr);
    const H = (canvas.height = canvas.clientHeight * dpr);

    // Launch upward from just below center, fanned outward.
    const parts = Array.from({ length: COUNT }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
      const speed = (350 + Math.random() * 550) * dpr;
      return {
        x: W / 2 + (Math.random() - 0.5) * 0.2 * W,
        y: H * 0.62,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 14,
        w: (5 + Math.random() * 4) * dpr,
        h: (8 + Math.random() * 7) * dpr,
        color: COLORS[(Math.random() * COLORS.length) | 0],
      };
    });

    let raf = 0;
    const t0 = performance.now();
    let last = t0;
    const tick = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const age = now - t0;
      ctx.clearRect(0, 0, W, H);
      if (age > LIFE_MS) return; // done — leave the canvas clear, no more frames
      const alpha = Math.min(1, (LIFE_MS - age) / FADE_MS);
      const drag = Math.pow(DRAG, dt);
      ctx.globalAlpha = alpha;
      for (const p of parts) {
        p.vy += GRAVITY * dpr * dt;
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.y > H + 20 * dpr) continue;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        // Width squeeze as it spins — a cheap tumbling-ribbon flutter.
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w * (0.35 + 0.65 * Math.abs(Math.cos(p.rot * 2))), p.h);
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 z-10 h-full w-full" />;
}
