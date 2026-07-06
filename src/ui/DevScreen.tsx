// Dev diagnostics page: the live tracking readout, unchanged from before — now
// a React component that renders the same markup and wires the imperative
// TrackingSession to it in one mount effect. The camera + loop + calibration
// all live in the session; this is purely the diagnostics renderer (landmark /
// shoulder overlay, metrics + states panel, onset chip log, fps, recenter).

import { useEffect, useRef } from "react";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { Button } from "./Button.tsx";
import { ThemeIconButton } from "./ThemeIconButton.tsx";
import { TrackingSession, type FrameResult } from "../tracking/session.ts";
import { AbstractAvatar } from "../avatar/AbstractAvatar.ts";
import { type GestureName } from "../tracking/gestures.ts";
import { IndicatorPanel } from "./panel.ts";

// Labels for the transient onset feed (the chips). The States panel has its own
// labels in panel.ts; this is just the "it just fired" log.
const GESTURE_LABEL: Record<GestureName, string> = {
  lookLeft: "Look left ⬅️",
  lookRight: "Look right ➡️",
  lookUp: "Look up ⬆️",
  lookDown: "Look down ⬇️",
  tiltLeft: "Tilt left ↙️",
  tiltRight: "Tilt right ↘️",
  tuck: "Chin tuck 🔙",
};

export function DevScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const avatarRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const recenterRef = useRef<HTMLButtonElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const dominantRef = useRef<HTMLSpanElement>(null);
  const gesturesRef = useRef<HTMLDivElement>(null);
  const indicatorsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const video = videoRef.current!;
    const overlay = overlayRef.current!;
    const avatarCanvas = avatarRef.current!;
    const statusEl = statusRef.current!;
    const startBtn = startRef.current!;
    const recenterBtn = recenterRef.current!;
    const fpsEl = fpsRef.current!;
    const dominantEl = dominantRef.current!;
    const gesturesEl = gesturesRef.current!;
    const indicatorsEl = indicatorsRef.current!;
    const ctx = overlay.getContext("2d")!;

    const panel = new IndicatorPanel(indicatorsEl);

    const session = new TrackingSession({
      onStatus: (text) => {
        statusEl.textContent = text;
      },
      onCalibrated: (isRecenter) => {
        recenterBtn.disabled = false;
        if (isRecenter) {
          // Revert the "Recentered ✓" flash back to the steady label.
          setTimeout(() => {
            if (!session.isCalibrating) statusEl.textContent = "Tracking";
          }, 900);
        }
      },
      onFrame: (f) => render(f),
    });
    // Same mesh as the play screen — mouth-open and eye-closed states come with
    // it — plus the dev page's sunglasses.
    session.attachAvatar(avatarCanvas, AbstractAvatar).setSunglasses(true);

    function render(f: FrameResult): void {
      // Match the overlay to the camera resolution once it's known (first frame).
      if (overlay.width !== video.videoWidth && video.videoWidth) {
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
      }
      drawLandmarks(f.faceLandmarks);
      if (f.body) drawBody(f.body.landmarks2d);
      panel.setMetrics(f.metrics, f.depthFiltered);
      panel.setStates(f.states);
      for (const ev of f.events) logGesture(GESTURE_LABEL[ev.name]);
      // Higher-level sequences (nod, etc.) — log them distinctly from onsets.
      for (const ev of f.sequenceEvents) {
        logGesture(ev.name === "nod" ? "Nod 🙇" : ev.name);
      }
      dominantEl.textContent = `dominant: ${f.dominant}`;
      fpsEl.textContent = `${f.fps} fps`;
    }

    function drawLandmarks(landmarks: { x: number; y: number }[]): void {
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      ctx.fillStyle = "rgba(80, 220, 160, 0.7)";
      // The overlay is mirrored via CSS to match the mirrored video.
      for (const p of landmarks) {
        ctx.beginPath();
        ctx.arc(p.x * overlay.width, p.y * overlay.height, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawBody(lm: { x: number; y: number; visibility?: number }[]): void {
      if (lm.length < 13) return;
      const W = overlay.width;
      const H = overlay.height;
      const [l, r] = [lm[11], lm[12]]; // shoulders
      if ((l.visibility ?? 1) < 0.5 || (r.visibility ?? 1) < 0.5) return;

      ctx.strokeStyle = "rgba(255, 180, 80, 0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(l.x * W, l.y * H);
      ctx.lineTo(r.x * W, r.y * H);
      ctx.stroke();

      ctx.fillStyle = "rgba(255, 140, 40, 0.95)";
      for (const p of [l, r]) {
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function logGesture(label: string): void {
      const chip = document.createElement("div");
      chip.className =
        "rounded-full border border-accent/50 bg-panel px-3.5 py-1.5 text-sm transition-opacity delay-[1000ms] duration-[1500ms]";
      chip.textContent = label;
      gesturesEl.prepend(chip);
      while (gesturesEl.children.length > 12) gesturesEl.lastChild!.remove();
      // Fade after a beat (matches the old .chip → .chip.fade transition).
      setTimeout(() => chip.classList.add("opacity-[0.35]"), 50);
    }

    const start = async (): Promise<void> => {
      startBtn.disabled = true;
      try {
        await session.start(video);
      } catch (err) {
        console.error("bop start failed:", err);
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : JSON.stringify(err);
        statusEl.textContent = `Error: ${msg || "see console"}`;
        startBtn.disabled = false;
      }
    };

    const recenter = (): void => {
      recenterBtn.disabled = true;
      session.recenter();
    };

    startBtn.addEventListener("click", start);
    recenterBtn.addEventListener("click", recenter);

    return () => {
      startBtn.removeEventListener("click", start);
      recenterBtn.removeEventListener("click", recenter);
      session.stop();
    };
  }, []);

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="absolute right-4 top-4">
        <ThemeIconButton />
      </div>

      <main className="mx-auto w-full max-w-[960px] px-6 py-12">
        <a
          href="#"
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-text"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back
        </a>
        <h1 className="mb-1 text-2xl font-bold tracking-tight">Head tracking diagnostics</h1>
        <p className="mb-6 text-muted">
          Look L/R · up/down · tilt L/R · tuck your chin.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black/5 ring-1 ring-black/10 dark:bg-white/5 dark:ring-white/10">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
            />
            <canvas
              ref={overlayRef}
              className="absolute inset-0 h-full w-full -scale-x-100"
            />
            <div
              ref={statusRef}
              className="absolute bottom-3 left-3 rounded-md bg-black/50 px-2.5 py-1 text-sm font-medium text-white"
            >
              Click start to enable camera
            </div>
          </div>
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black/5 ring-1 ring-black/10 dark:bg-white/5 dark:ring-white/10">
            <canvas ref={avatarRef} className="block h-full w-full" />
          </div>
        </div>

        <div className="my-4 flex items-center gap-3">
          <Button ref={startRef} size="md">
            Start camera
          </Button>
          <Button ref={recenterRef} size="md" disabled>
            Recenter
          </Button>
          <span ref={dominantRef} className="ml-auto text-sm tabular-nums text-muted" />
          <span ref={fpsRef} className="text-sm tabular-nums text-muted" />
        </div>

        <div ref={indicatorsRef} />

        <div ref={gesturesRef} className="mt-5 flex flex-wrap gap-2" />
      </main>
    </div>
  );
}
