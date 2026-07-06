// The arcade — one WarioWare-style run, no game picker. ONE tracking session
// (camera + models) starts on arrival and stays live for the whole visit;
// the plain-TS ArcadeDirector is the session's frame sink and owns the run
// (nod-wait → stats → prompt → playing → result → …). This component is only
// chrome: it renders the director's coarse snapshots (phase changes and
// whole-second ticks — never per-frame data) as the cutscene cards, countdown
// ring, and end screens. Games draw themselves: each attaches its own Avatar
// subclass to the playfield canvas via the shared session.

import { useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { ThemeIconButton } from "./ThemeIconButton.tsx";
import { Button } from "./Button.tsx";
import { MusicPlayer } from "./MusicPlayer.tsx";
import { ConfettiBurst } from "./ConfettiBurst.tsx";
import { arcadeMusicPlayer } from "../audio/player.ts";
import { cameraErrorMessage } from "./cameraError.ts";
import { TrackingSession } from "../tracking/session.ts";
import { AbstractAvatar } from "../avatar/AbstractAvatar.ts";
import {
  ArcadeDirector,
  GAME_MS,
  GAMES_PER_ROUND,
  MAX_LEVEL,
  PROMPT_MS,
  RESULT_MS,
  START_LIVES,
  STATS_MS,
  type ArcadeSnapshot,
} from "../minigames/director.ts";

// Cap per-frame elapsed time so a background-tab gap can't teleport gameplay.
const MAX_DT = 100;

// Countdown ring geometry (the routine timer ring, arcade-sized).
const RING_R = 26;
const RING_C = 2 * Math.PI * RING_R;

export function ArcadeScreen({ onExit }: { onExit: () => void }) {
  const [shown, setShown] = useState(false);
  const [status, setStatus] = useState("");
  const [ready, setReady] = useState(false); // first calibration landed
  // Recenter fades in a beat after ready — let the mesh settle in first.
  const [showRecenter, setShowRecenter] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [arc, setArc] = useState<ArcadeSnapshot | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const avatarRef = useRef<HTMLCanvasElement>(null);
  const playfieldRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<TrackingSession | null>(null);
  const directorRef = useRef<ArcadeDirector | null>(null);
  const lastTs = useRef(0);

  const phase = arc?.phase ?? "nod-wait";
  const nodWait = phase === "nod-wait";

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Session + director live exactly as long as the arcade. The director is the
  // frame sink; React only hears its coarse snapshots.
  useEffect(() => {
    const session = new TrackingSession({
      onStatus: setStatus,
      onCalibrated: () => setReady(true),
      onFrame: (f) => {
        const now = performance.now();
        const dt = Math.min(MAX_DT, lastTs.current ? now - lastTs.current : 0);
        lastTs.current = now;
        directorRef.current?.update(f, dt);
      },
    });
    sessionRef.current = session;
    const director = new ArcadeDirector(session, () => playfieldRef.current);
    directorRef.current = director;
    const unsub = director.subscribe(setArc);
    session.start(videoRef.current!).catch((err) => {
      console.error("arcade start failed:", err);
      setError(cameraErrorMessage(err));
    });
    return () => {
      unsub();
      director.dispose();
      directorRef.current = null;
      session.stop();
      sessionRef.current = null;
      arcadeMusicPlayer.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the camera is calibrated the arcade comes alive: the mesh avatar
  // settles (same model as the play screen) and the arcade music starts.
  // `ready` flips exactly once per visit, so this can't retrigger a paused
  // player. (Autoplay is safe — getting here took a click.)
  useEffect(() => {
    if (ready) arcadeMusicPlayer.play();
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setShowRecenter(true), 1000);
    return () => clearTimeout(t);
  }, [ready]);

  // The waiting screen owns the mesh avatar; during a run the games attach
  // their own to the playfield canvas, so release before the first create().
  // Attached from mount — pre-calibration the mesh is the loading indicator
  // (glow pulse).
  useEffect(() => {
    if (!nodWait || error) return;
    const session = sessionRef.current;
    if (!session || !avatarRef.current) return;
    session.attachAvatar(avatarRef.current, AbstractAvatar);
    return () => session.detachAvatar();
  }, [nodWait, error]);

  const level = arc?.level ?? 1;
  const lives = arc?.lives ?? START_LIVES;
  const def = arc?.def ?? null;
  const running = !nodWait && phase !== "gameover" && phase !== "win";
  const ended = phase === "gameover" || phase === "win";

  return (
    <div
      className={`relative flex min-h-screen flex-col items-center justify-center gap-8 bg-bg px-6 pb-24 text-text transition-opacity duration-500 ${
        shown ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* Detection source — never shown, alive for the whole arcade visit. */}
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />

      <div className="absolute right-4 top-4">
        <ThemeIconButton />
      </div>

      {/* Back — out of the arcade (mid-run too; the run has no pause). */}
      <button
        onClick={onExit}
        aria-label="Back to home"
        className="absolute left-4 top-4 rounded-full p-2 text-muted transition hover:bg-black/5 hover:text-text dark:hover:bg-white/10"
      >
        <ArrowLeftIcon className="h-5 w-5" />
      </button>

      {nodWait ? (
        <>
          {/* The mesh avatar — visible from the start. While the models load
              and neutral is captured, the model pulses (opacity breathing —
              the loading indicator); once calibration lands it settles to
              full opacity, live. */}
          {!error && (
            <div className="relative aspect-[4/3] w-full max-w-sm">
              <canvas
                ref={avatarRef}
                className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-700 ${
                  ready ? "" : "animate-pulse"
                }`}
              />
            </div>
          )}

          {error ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <ExclamationTriangleIcon className="h-10 w-10 text-red-500" />
              <span className="text-sm font-medium text-text">Camera unavailable</span>
              <span className="text-xs text-muted">{error}</span>
            </div>
          ) : (
            <>
              {/* The invite appears with calibration; the status line holds
                  its space while loading so nothing jumps. */}
              <div className="flex flex-col items-center gap-2 text-center">
                {ready ? (
                  <div className="animate-[fade-in_0.5s_ease]">
                    <p className="text-2xl font-semibold text-text">Nod to start</p>
                    <p className="mt-1 text-sm text-muted">
                      {MAX_LEVEL} rounds · {GAMES_PER_ROUND} games each · {START_LIVES} lives
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted" aria-live="polite">
                    {status || "Starting camera…"}
                  </p>
                )}
              </div>
              {/* Recenter (and a click fallback for the nod) fade in a beat
                  after tracking is ready. */}
              <div className="flex h-9 items-center justify-center gap-3">
                {showRecenter && (
                  <>
                    <Button
                      onClick={() => sessionRef.current?.recenter()}
                      className="animate-[fade-in_0.5s_ease]"
                    >
                      Recenter
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => directorRef.current?.startRun()}
                      className="animate-[fade-in_0.5s_ease]"
                    >
                      Start
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {/* The playfield. The canvas is keyed per game so every microgame
              gets a fresh node — attachAvatar builds a new renderer, and
              reusing one canvas across renderers risks stale GL state. */}
          <div className="relative aspect-[8/7] w-full max-w-xl overflow-hidden rounded-2xl bg-black/5 ring-1 ring-black/10 dark:bg-white/5 dark:ring-white/10">
            <canvas
              key={arc?.plays ?? 0}
              ref={playfieldRef}
              className={`absolute inset-0 h-full w-full transition-opacity duration-300 ${
                phase === "playing" ? "opacity-100" : "opacity-0"
              }`}
            />

            {/* Countdown ring + progress chip, alive only while playing. */}
            {phase === "playing" && arc && (
              <>
                {/* Left corners: Dance's rhythm panel owns the right edge. */}
                <div className="absolute left-3 top-3 h-14 w-14">
                  <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
                    <circle
                      cx="32"
                      cy="32"
                      r={RING_R}
                      fill="none"
                      strokeWidth="5"
                      className="stroke-black/10 dark:stroke-white/10"
                    />
                    <circle
                      cx="32"
                      cy="32"
                      r={RING_R}
                      fill="none"
                      strokeWidth="5"
                      strokeLinecap="round"
                      className={arc.timeLeft <= 3 ? "stroke-red-500" : "stroke-accent"}
                      strokeDasharray={RING_C}
                      strokeDashoffset={RING_C * (1 - (arc.timeLeft * 1000) / GAME_MS)}
                      style={{ transition: "stroke-dashoffset 1s linear" }}
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums text-text">
                    {arc.timeLeft}
                  </span>
                </div>
                {arc.hud && (
                  <span className="absolute bottom-3 left-3 rounded-md bg-black/50 px-2.5 py-1 text-sm font-medium tabular-nums text-white">
                    {arc.hud}
                  </span>
                )}
              </>
            )}

            {/* Cutscene: stats ticker card. */}
            {phase === "stats" && arc && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  style={{ animation: `arcade-card ${STATS_MS}ms ease both` }}
                  className="flex flex-col items-center gap-3 rounded-2xl bg-panel px-8 py-6 shadow-lg ring-1 ring-black/5 dark:ring-white/10"
                >
                  <div className="flex items-center gap-3 text-lg font-bold tracking-widest text-text">
                    <span>
                      LEVEL{" "}
                      <span
                        key={level}
                        className="inline-block tabular-nums"
                        style={
                          arc.statChange === "level"
                            ? { animation: "arcade-rollup 0.45s ease both" }
                            : undefined
                        }
                      >
                        {level}
                      </span>
                      <span className="text-muted">/{MAX_LEVEL}</span>
                    </span>
                    <span className="text-muted">·</span>
                    <span className="flex gap-1" aria-label={`${lives} lives`}>
                      {Array.from({ length: START_LIVES }, (_, i) => (
                        <span
                          key={i}
                          className={
                            i < lives ? "text-red-500" : "text-black/15 dark:text-white/15"
                          }
                          style={
                            arc.statChange === "life" && i === lives
                              ? { animation: "arcade-heart-pop 0.5s ease both", display: "inline-block" }
                              : undefined
                          }
                        >
                          ♥
                        </span>
                      ))}
                    </span>
                  </div>
                  {/* Game pips: where this game sits in the round of 8. */}
                  <div className="flex items-center gap-1.5" aria-label={`Game ${arc.gameNum} of ${GAMES_PER_ROUND}`}>
                    {Array.from({ length: GAMES_PER_ROUND }, (_, i) => (
                      <span
                        key={i}
                        className={`h-1.5 w-1.5 rounded-full ${
                          i < arc.gameNum - 1
                            ? "bg-accent"
                            : i === arc.gameNum - 1
                              ? "animate-pulse ring-1 ring-inset ring-accent"
                              : "bg-black/10 dark:bg-white/10"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs tabular-nums text-muted">score {arc.score}</p>
                </div>
              </div>
            )}

            {/* Cutscene: two-tier prompt card. */}
            {phase === "prompt" && def && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  style={{ animation: `arcade-card ${PROMPT_MS}ms ease both` }}
                  className="flex w-4/5 max-w-sm flex-col items-center gap-2 rounded-2xl bg-panel px-8 py-6 text-center shadow-lg ring-1 ring-black/5 dark:ring-white/10"
                >
                  <p className="text-[0.65rem] font-medium uppercase tracking-widest text-muted">
                    2026 · {def.headline}
                  </p>
                  <p className="mt-2 text-lg text-muted">{def.prompt.lead}</p>
                  <p className="text-6xl font-black tracking-tight text-text">
                    {def.prompt.action}
                  </p>
                  <p className="mt-2 text-sm text-muted">{def.hint}</p>
                </div>
              </div>
            )}

            {/* Result stinger: one big word, in and gone with the phase. */}
            {phase === "result" && arc?.outcome && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p
                  style={{ animation: `arcade-pop ${RESULT_MS * 0.4}ms ease both` }}
                  className={`text-6xl font-black tracking-tight ${
                    arc.outcome === "win" ? "text-accent" : "text-red-500"
                  }`}
                >
                  {arc.outcome === "win" ? "NICE!" : "MISS!"}
                </p>
              </div>
            )}

            {/* End screens (placeholder chrome until build-order step 5). */}
            {ended && arc && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                <p
                  style={{ animation: "arcade-pop 0.5s ease both" }}
                  className="text-5xl font-black tracking-tight text-text"
                >
                  {phase === "win" ? "YOU WIN!" : "GAME OVER"}
                </p>
                <p className="text-sm tabular-nums text-muted">
                  score {arc.score} / {MAX_LEVEL * GAMES_PER_ROUND}
                </p>
                <p className="text-sm text-muted">Nod to play again</p>
                <Button
                  variant="primary"
                  onClick={() => directorRef.current?.startRun()}
                  className="mt-1"
                >
                  Play again
                </Button>
              </div>
            )}
          </div>

          {/* Recenter — the lean baseline can drift over a 9-minute run. */}
          {running && (
            <Button onClick={() => sessionRef.current?.recenter()}>Recenter</Button>
          )}
        </>
      )}

      {phase === "win" && <ConfettiBurst />}

      {/* Music pill: hidden until the camera is ready and the music has kicked
          in; stays through the whole run (the queue is arcade-wide). */}
      <div
        className={`absolute bottom-4 right-4 transition-opacity duration-700 ${
          ready ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <MusicPlayer player={arcadeMusicPlayer} />
      </div>
    </div>
  );
}
