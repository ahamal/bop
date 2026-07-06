// The shared camera-session screen kit — the arcade's staging pattern, used by
// both full-screen experiences (the routine's PlayScreen and the ArcadeScreen)
// so the camera setup, readiness, and music behavior can't drift apart:
//
//   useTrackingSession  owns the session lifecycle: creates it, starts it into
//                       the hidden <video>, clamps per-frame dt, flips `ready`
//                       on the first calibration, starts the screen's music on
//                       ready, and stops both on unmount.
//   SessionShell        the screen chrome every session screen shares: fade-in,
//                       hidden video (the detection source), back + theme
//                       buttons, and the music pill (visible once ready).
//   SessionLobby        the pre-game staging: a title saying what you're about
//                       to start, the mesh avatar (pulsing while models load —
//                       the loading indicator), "Nod to start" + a detail line
//                       once calibrated, Recenter/Start buttons a beat later,
//                       and the camera-failure card with a way back home.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowLeftIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { ThemeIconButton } from "./ThemeIconButton.tsx";
import { Button } from "./Button.tsx";
import { MusicPlayer } from "./MusicPlayer.tsx";
import { ConfettiBurst } from "./ConfettiBurst.tsx";
import { cameraErrorMessage } from "./cameraError.ts";
import { musicPlayer } from "../audio/player.ts";
import { TrackingSession, type FrameResult } from "../tracking/session.ts";
import { AbstractAvatar } from "../avatar/AbstractAvatar.ts";

// Cap per-frame elapsed time so a background-tab gap can't teleport gameplay.
const MAX_DT = 100;

type Music = typeof musicPlayer;

export interface TrackingScreen {
  /** The live session (null until the mount effect creates it). State, not a
   *  ref, so children can attach avatars in their own effects once it lands. */
  session: TrackingSession | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  status: string;
  /** First calibration landed — tracking is live. Flips once per visit. */
  ready: boolean;
  error: string | null;
}

/**
 * One camera session for the lifetime of the screen. The screen's frame sink
 * gets every frame plus a clamped dt; the screen's music starts when tracking
 * is ready (autoplay is safe — getting here took a click) and stops with the
 * session on unmount.
 */
export function useTrackingSession(opts: {
  music: Music;
  onFrame: (f: FrameResult, dt: number) => void;
  onCalibrated?: (isRecenter: boolean) => void;
}): TrackingScreen {
  const [session, setSession] = useState<TrackingSession | null>(null);
  const [status, setStatus] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastTs = useRef(0);
  // Latest handlers, so the session (created once) never calls a stale closure.
  const handlers = useRef(opts);
  handlers.current = opts;

  useEffect(() => {
    const s = new TrackingSession({
      onStatus: setStatus,
      onCalibrated: (isRecenter) => {
        setReady(true);
        handlers.current.onCalibrated?.(isRecenter);
      },
      onFrame: (f) => {
        const now = performance.now();
        const dt = Math.min(MAX_DT, lastTs.current ? now - lastTs.current : 0);
        lastTs.current = now;
        handlers.current.onFrame(f, dt);
      },
    });
    setSession(s);
    s.start(videoRef.current!).catch((err) => {
      console.error("session start failed:", err);
      setError(cameraErrorMessage(err));
    });
    return () => {
      s.stop();
      handlers.current.music.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready) handlers.current.music.play();
  }, [ready]);

  return { session, videoRef, status, ready, error };
}

/** The chrome every session screen shares; screen content goes in children. */
export function SessionShell({
  onExit,
  screen,
  music,
  celebrate = false,
  children,
}: {
  onExit: () => void;
  screen: TrackingScreen;
  music: Music;
  /** Fire the full-screen confetti burst (routine complete / arcade win). */
  celebrate?: boolean;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className={`relative flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-6 pb-24 text-text transition-opacity duration-500 ${
        shown ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* Detection source — never shown, alive for the whole visit. */}
      <video ref={screen.videoRef} autoPlay playsInline muted className="hidden" />

      <div className="absolute right-4 top-4">
        <ThemeIconButton />
      </div>

      {/* Back to home — the session hook's unmount effect stops the camera. */}
      <button
        onClick={onExit}
        aria-label="Back to home"
        className="absolute left-4 top-4 rounded-full p-2 text-muted transition hover:bg-black/5 hover:text-text dark:hover:bg-white/10"
      >
        <ArrowLeftIcon className="h-5 w-5" />
      </button>

      {children}

      {celebrate && <ConfettiBurst />}

      {/* Music pill: hidden until tracking is ready and the music kicked in. */}
      <div
        className={`absolute bottom-4 right-4 transition-opacity duration-700 ${
          screen.ready ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <MusicPlayer player={music} />
      </div>
    </div>
  );
}

/**
 * The staging screen shown before a run/routine starts. Owns its avatar canvas:
 * the mesh attaches on mount (pre-calibration it pulses — the loading
 * indicator) and detaches on unmount, freeing the session for whatever canvas
 * the game phase brings.
 */
export function SessionLobby({
  title,
  subtitle,
  screen,
  onStart,
  onExit,
}: {
  /** What they're about to start — the heading above the avatar. */
  title: string;
  /** Detail line under "Nod to start" (length, rounds, lives…). */
  subtitle: string;
  screen: TrackingScreen;
  onStart: () => void;
  onExit: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Recenter/Start fade in a beat after ready — let the mesh settle in first.
  const [showButtons, setShowButtons] = useState(false);
  const { session, status, ready, error } = screen;

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setShowButtons(true), 1000);
    return () => clearTimeout(t);
  }, [ready]);

  useEffect(() => {
    if (error || !session || !canvasRef.current) return;
    session.attachAvatar(canvasRef.current, AbstractAvatar);
    return () => session.detachAvatar();
  }, [session, error]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <ExclamationTriangleIcon className="h-10 w-10 text-red-500" />
        <span className="text-sm font-medium text-text">Camera unavailable</span>
        <span className="text-xs text-muted">{error}</span>
        <Button onClick={onExit} className="mt-1">
          Go back home
        </Button>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>

      {/* The mesh avatar — visible from the start. While the models load and
          neutral is captured it pulses (opacity breathing); once calibration
          lands it settles to full opacity, live. The negative margin eats the
          canvas's built-in headroom (the figure sits low in its frame), so the
          title reads attached to the model, not floating above it. */}
      <div className="relative -mt-10 aspect-[4/3] w-full max-w-sm">
        <canvas
          ref={canvasRef}
          className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-700 ${
            ready ? "" : "animate-pulse"
          }`}
        />
      </div>

      {/* The invite appears with calibration. Fixed height: the loading status
          line and the taller ready block (invite + subtitle) occupy the same
          space, so calibration landing doesn't shift the content. */}
      <div className="flex h-14 flex-col items-center justify-center text-center">
        {ready ? (
          <div className="animate-[fade-in_0.5s_ease]">
            <p className="text-2xl font-semibold text-text">Nod to start</p>
            <p className="mt-1 text-sm text-muted">{subtitle}</p>
          </div>
        ) : (
          <p className="text-sm text-muted" aria-live="polite">
            {status || "Starting camera…"}
          </p>
        )}
      </div>

      {/* Recenter (and a click fallback for the nod) fade in a beat after
          tracking is ready. */}
      <div className="flex h-9 items-center justify-center gap-3">
        {showButtons && (
          <>
            <Button
              onClick={() => session?.recenter()}
              className="animate-[fade-in_0.5s_ease]"
            >
              Recenter
            </Button>
            <Button
              variant="primary"
              onClick={onStart}
              className="animate-[fade-in_0.5s_ease]"
            >
              Start
            </Button>
          </>
        )}
      </div>
    </>
  );
}
