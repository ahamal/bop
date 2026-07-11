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
//   HandsFreeGate       a mobile-only acknowledgement shown BEFORE any of the
//                       above mounts, so a handheld user props the phone up
//                       before the camera even starts.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ArrowLeftIcon,
  DevicePhoneMobileIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { ThemeIconButton } from "./ThemeIconButton.tsx";
import { Button } from "./Button.tsx";
import { MusicPlayer } from "./MusicPlayer.tsx";
import { ConfettiBurst } from "./ConfettiBurst.tsx";
import { cameraErrorMessage } from "./cameraError.ts";
import { musicPlayer } from "../audio/player.ts";
import { TrackingSession, type FrameResult, type Presence } from "../tracking/session.ts";
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
  /** Framing quality — drives the lobby's webcam-preview guidance. */
  presence: Presence;
  error: string | null;
}

/**
 * One camera session for the lifetime of the screen. The screen's frame sink
 * gets every frame plus a clamped dt; the screen's music starts when tracking
 * is ready (autoplay is safe — getting here took a click) and stops with the
 * session on unmount.
 */
export function useTrackingSession(opts: {
  /** Omit for silent screens (practice) — nothing plays, nothing to stop. */
  music?: Music;
  onFrame: (f: FrameResult, dt: number) => void;
  onCalibrated?: (isRecenter: boolean) => void;
}): TrackingScreen {
  const [session, setSession] = useState<TrackingSession | null>(null);
  const [status, setStatus] = useState("");
  const [ready, setReady] = useState(false);
  const [presence, setPresence] = useState<Presence>({ detected: true, tooClose: false });
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastTs = useRef(0);
  // Latest handlers, so the session (created once) never calls a stale closure.
  const handlers = useRef(opts);
  handlers.current = opts;

  useEffect(() => {
    const s = new TrackingSession({
      onStatus: setStatus,
      onPresence: setPresence,
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
      handlers.current.music?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready) handlers.current.music?.play();
  }, [ready]);

  return { session, videoRef, status, ready, presence, error };
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
  /** Omit for silent screens — the music pill stays hidden. */
  music?: Music;
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
      {music && (
        <div
          className={`absolute bottom-4 right-4 transition-opacity duration-700 ${
            screen.ready ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <MusicPlayer player={music} />
        </div>
      )}
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
  const previewRef = useRef<HTMLCanvasElement>(null);
  // Recenter/Start fade in a beat after ready — let the mesh settle in first.
  const [showButtons, setShowButtons] = useState(false);
  const { session, status, ready, presence, error } = screen;

  // Framing guidance: when the camera can't work with what it sees, swap the
  // avatar for a live webcam preview (with a tracking box) and say what to fix.
  const framingIssue = !presence.detected
    ? "Body not detected — move back or stay within the frame"
    : presence.tooClose
      ? "Too close to the camera — move back a bit"
      : null;
  // Once shown, the preview stays up until calibration lands — fixing framing
  // shouldn't bounce you back to the avatar mid-setup. After ready it only
  // appears while an issue is live.
  const [showPreview, setShowPreview] = useState(false);
  useEffect(() => {
    if (framingIssue) setShowPreview(true);
    else if (ready) setShowPreview(false);
  }, [framingIssue, ready]);

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

  useEffect(() => {
    if (!showPreview || !session || !previewRef.current) return;
    session.attachPreview(previewRef.current);
    return () => session.detachPreview();
  }, [session, showPreview]);

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
          } ${showPreview ? "opacity-0" : ""}`}
        />
        {/* The webcam preview takes the avatar's place while framing is off —
            seeing yourself (with the tracking box when a face is found) is the
            fastest way to fix it. Same box as the avatar canvas, so the swap
            back is seamless. */}
        {/* A window centered where the figure stands, not the full container —
            the container is oversized for canvas headroom (hence -mt-10), so
            filling it reads huge next to the avatar. Sits below the title. */}
        {showPreview && (
          <canvas
            ref={previewRef}
            className="absolute left-1/2 top-[60%] aspect-[4/3] w-[88%] -translate-x-1/2 -translate-y-1/2 rounded-2xl"
          />
        )}
      </div>

      {/* The invite appears with calibration. Fixed height: the loading status
          line and the taller ready block (invite + subtitle) occupy the same
          space, so calibration landing doesn't shift the content. */}
      <div className="flex h-14 flex-col items-center justify-center text-center">
        {framingIssue ? (
          <p
            className="animate-[fade-in_0.5s_ease] text-sm font-medium text-amber-500"
            aria-live="polite"
          >
            {framingIssue}
          </p>
        ) : ready ? (
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

/** Mobile gate: on a touch-primary device the camera can't track a moving
 *  phone, so require a hands-free acknowledgement BEFORE the session mounts (and
 *  the camera starts). On desktop, or once confirmed, it just renders children —
 *  which is what actually mounts the tracking session. */
export function HandsFreeGate({ onExit, children }: { onExit: () => void; children: ReactNode }) {
  const isHandheld =
    typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const [confirmed, setConfirmed] = useState(false);
  if (!isHandheld || confirmed) return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-7 bg-bg px-8 text-center text-text">
      <DevicePhoneMobileIcon className="h-14 w-14 text-accent" />
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Prop your phone up</h1>
        <p className="mx-auto max-w-xs text-muted">
          This tracks your head through the camera, so your phone has to stay
          still. Stand it up hands-free where it can see you, then get into
          position.
        </p>
      </div>
      <div className="flex flex-col items-center gap-3">
        <Button variant="primary" size="md" onClick={() => setConfirmed(true)}>
          I'm set — continue
        </Button>
        <Button variant="quiet" onClick={onExit}>
          Go back
        </Button>
      </div>
    </div>
  );
}
