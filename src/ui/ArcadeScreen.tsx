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
import { MICROGAMES, gameDurationMs, type Level } from "../minigames/registry.ts";
import { CountdownRing } from "./CountdownRing.tsx";

// --- Dev panel: playable-game checkboxes + starting/current level, persisted
// across reloads. Checked ids feed the director's bag filter; the level jumps
// the run (mid-run it applies from the next game).
const DEV_KEY = "arcade-dev";

interface DevConfig {
  games: string[]; // enabled game ids
  level: Level;
}

function loadDevConfig(): DevConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(DEV_KEY) ?? "");
    const ids = new Set(MICROGAMES.map((d) => d.id));
    const games = Array.isArray(raw.games) ? raw.games.filter((g: string) => ids.has(g)) : [];
    const level = [1, 2, 3, 4, 5].includes(raw.level) ? (raw.level as Level) : 1;
    return { games: games.length ? games : MICROGAMES.map((d) => d.id), level };
  } catch {
    return { games: MICROGAMES.map((d) => d.id), level: 1 };
  }
}

function DevPanel({ dev, setDev }: { dev: DevConfig; setDev: (d: DevConfig) => void }) {
  const [open, setOpen] = useState(false);
  const toggle = (id: string) => {
    const games = dev.games.includes(id)
      ? dev.games.filter((g) => g !== id)
      : [...dev.games, id];
    setDev({ ...dev, games });
  };
  return (
    <div className="fixed bottom-3 left-3 z-50 text-xs">
      {open && (
        <div className="mb-2 w-52 rounded-xl bg-panel p-3 shadow-lg ring-1 ring-black/10 dark:ring-white/10">
          <p className="mb-1.5 font-semibold uppercase tracking-wider text-muted">Games</p>
          {MICROGAMES.map((d) => (
            <label key={d.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-text">
              <input
                type="checkbox"
                checked={dev.games.includes(d.id)}
                onChange={() => toggle(d.id)}
                className="accent-current"
              />
              {d.title}
            </label>
          ))}
          <p className="mb-1.5 mt-3 font-semibold uppercase tracking-wider text-muted">Level</p>
          <div className="flex gap-1">
            {([1, 2, 3, 4, 5] as const).map((l) => (
              <button
                key={l}
                onClick={() => setDev({ ...dev, level: l })}
                className={`h-7 w-7 rounded-md font-semibold tabular-nums ring-1 ${
                  dev.level === l
                    ? "bg-accent text-white ring-accent"
                    : "text-text ring-black/15 hover:bg-black/5 dark:ring-white/15 dark:hover:bg-white/5"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        className="rounded-full bg-panel px-3 py-1.5 font-medium text-muted shadow ring-1 ring-black/10 hover:text-text dark:ring-white/10"
      >
        {open ? "backstage ×" : "backstage"}
      </button>
    </div>
  );
}

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
  // Dev panel state — which games the bag may draw and the starting/current
  // level — persisted so a playtest setup survives reloads.
  const [dev, setDev] = useState<DevConfig>(loadDevConfig);
  const devRef = useRef(dev);
  devRef.current = dev;
  useEffect(() => {
    localStorage.setItem(DEV_KEY, JSON.stringify(dev));
    directorRef.current?.setEnabledGames(dev.games);
    directorRef.current?.setLevel(dev.level);
  }, [dev]);

  useEffect(() => {
    if (!session) return;
    const director = new ArcadeDirector(session, () => playfieldRef.current);
    director.setEnabledGames(devRef.current.games);
    director.setLevel(devRef.current.level);
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
                <div className="absolute left-3 top-3">
                  <CountdownRing
                    timeLeft={arc.timeLeft}
                    totalMs={(arc.def ? gameDurationMs(arc.def, arc.level) : 0) || GAME_MS}
                  />
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
      <DevPanel dev={dev} setDev={setDev} />
    </SessionShell>
  );
}
