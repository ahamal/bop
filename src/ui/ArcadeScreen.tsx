// The arcade — one WarioWare-style run, no game picker. ONE tracking session
// (camera + models, via the shared useTrackingSession hook) starts on arrival
// and stays live for the whole visit; the plain-TS ArcadeDirector is the
// session's frame sink and owns the run (nod-wait → stats → prompt → playing →
// result → …). This component is only chrome: it renders the director's coarse
// snapshots (phase changes and whole-second ticks — never per-frame data) as
// the cutscene cards, countdown ring, and end screens. Games draw themselves:
// each attaches its own Avatar subclass to the playfield canvas via the shared
// session. The waiting screen is the shared SessionLobby; during a run the
// lobby (and its mesh avatar) unmounts, releasing the session for the games.

import { useEffect, useRef, useState } from "react";
import { Button } from "./Button.tsx";
import { SessionLobby, SessionShell, useTrackingSession } from "./SessionScreen.tsx";
import { arcadeMusicPlayer } from "../audio/player.ts";
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

// Countdown ring geometry (the routine timer ring, arcade-sized).
const RING_R = 26;
const RING_C = 2 * Math.PI * RING_R;

export function ArcadeScreen({ onExit }: { onExit: () => void }) {
  const [arc, setArc] = useState<ArcadeSnapshot | null>(null);
  const playfieldRef = useRef<HTMLCanvasElement>(null);
  const directorRef = useRef<ArcadeDirector | null>(null);

  const screen = useTrackingSession({
    music: arcadeMusicPlayer,
    onFrame: (f, dt) => directorRef.current?.update(f, dt),
  });
  const { session } = screen;

  // The director lives exactly as long as the session. It is the frame sink;
  // React only hears its coarse snapshots.
  useEffect(() => {
    if (!session) return;
    const director = new ArcadeDirector(session, () => playfieldRef.current);
    directorRef.current = director;
    const unsub = director.subscribe(setArc);
    return () => {
      unsub();
      director.dispose();
      directorRef.current = null;
    };
  }, [session]);

  const phase = arc?.phase ?? "nod-wait";
  const nodWait = phase === "nod-wait";
  const level = arc?.level ?? 1;
  const lives = arc?.lives ?? START_LIVES;
  const def = arc?.def ?? null;
  const running = !nodWait && phase !== "gameover" && phase !== "win";
  const ended = phase === "gameover" || phase === "win";

  return (
    <SessionShell
      onExit={onExit}
      screen={screen}
      music={arcadeMusicPlayer}
      celebrate={phase === "win"}
    >
      {nodWait ? (
        <SessionLobby
          title="Minigame Arcade"
          subtitle={`${MAX_LEVEL} rounds · ${GAMES_PER_ROUND} games each · ${START_LIVES} lives`}
          screen={screen}
          onStart={() => directorRef.current?.startRun()}
          onExit={onExit}
        />
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
          {running && <Button onClick={() => session?.recenter()}>Recenter</Button>}
        </>
      )}
    </SessionShell>
  );
}
