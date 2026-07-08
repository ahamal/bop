// Practice (#practice) — its own page: calibrate the camera once, then a
// picker of every activity × level appears (instead of the arcade's
// nod-to-start), and each click plays that one game immediately on the same
// session. No director: a small inline loop — pick → playing → result →
// back to the picker — with no lives, no bag, no cutscene cards.
//
// The SessionLobby handles the calibration staging (avatar warm-up, framing
// guidance, camera errors); the moment tracking is ready this screen swaps
// it for the picker. The frame sink follows the engine/React split:
// per-frame data stays in refs; React hears phase changes and whole-second
// ticks only.

import { useEffect, useRef, useState } from "react";
import { Button } from "./Button.tsx";
import { SessionLobby, SessionShell, useTrackingSession } from "./SessionScreen.tsx";
import { playDone, playFail } from "../audio/sfx.ts";
import { GAME_MS } from "../minigames/director.ts";
import {
  BOSSES,
  MICROGAMES,
  gameDurationMs,
  type Level,
  type Microgame,
  type MicrogameDef,
} from "../minigames/registry.ts";
import { CountdownRing } from "./CountdownRing.tsx";

type Phase = "pick" | "playing" | "result";

interface Ui {
  phase: Phase;
  outcome: "win" | "lose" | null;
  /** Keys the playfield canvas — every play gets a fresh GL node. */
  plays: number;
  timeLeft: number;
  hud: string;
}

export function PracticeScreen({ onExit }: { onExit: () => void }) {
  const [picked, setPicked] = useState<{ def: MicrogameDef; level: Level } | null>(null);
  const [ui, setUi] = useState<Ui>({ phase: "pick", outcome: null, plays: 0, timeLeft: 0, hud: "" });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Microgame | null>(null);
  const timerRef = useRef(0);
  const phaseRef = useRef<Phase>("pick");
  const pickedRef = useRef(picked);
  pickedRef.current = picked;

  const begin = (def: MicrogameDef, level: Level): void => {
    if (phaseRef.current === "playing") return;
    setPicked({ def, level });
    phaseRef.current = "playing";
    setUi((u) => ({
      phase: "playing",
      outcome: null,
      plays: u.plays + 1,
      timeLeft: Math.ceil((gameDurationMs(def, level) || GAME_MS) / 1000),
      hud: "",
    }));
  };

  // No music in practice — it's a drill space, just the games' own sfx.
  const screen = useTrackingSession({
    onFrame: (f, dt) => {
      const g = gameRef.current;
      const def = pickedRef.current?.def;
      if (phaseRef.current !== "playing" || !g || !def) return;
      g.update(f, dt);
      timerRef.current -= dt;
      const timedOut = timerRef.current <= 0;
      if (g.outcome !== "pending" || timedOut) {
        const outcome = g.outcome !== "pending" ? g.outcome : def.timeoutWins ? "win" : "lose";
        g.dispose();
        gameRef.current = null;
        if (outcome === "win") playDone();
        else playFail();
        phaseRef.current = "result";
        setUi((u) => ({ ...u, phase: "result", outcome }));
      } else {
        // Whole-second ticks and HUD changes only — never per-frame state.
        const sec = Math.ceil(timerRef.current / 1000);
        const hud = g.hud ?? "";
        setUi((u) => (u.timeLeft !== sec || u.hud !== hud ? { ...u, timeLeft: sec, hud } : u));
      }
    },
  });
  const { session } = screen;

  // Create the game once React has mounted the fresh canvas for this play.
  // Cleanup covers leaving mid-game (back to picker, unmount); a game that
  // resolved already disposed itself in the frame sink and left the ref null.
  useEffect(() => {
    if (ui.phase !== "playing" || !picked || !session || !canvasRef.current) return;
    gameRef.current = picked.def.create(canvasRef.current, session, picked.level);
    timerRef.current = gameDurationMs(picked.def, picked.level) || GAME_MS;
    return () => {
      gameRef.current?.dispose();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.phase, ui.plays, session]);

  const backToPicker = (): void => {
    phaseRef.current = "pick";
    setUi((u) => ({ ...u, phase: "pick", outcome: null }));
  };

  // The result is a stinger, not a screen: let it land, then back to the picker.
  useEffect(() => {
    if (ui.phase !== "result") return;
    const t = setTimeout(backToPicker, 1800);
    return () => clearTimeout(t);
  }, [ui.phase]);

  return (
    <SessionShell onExit={onExit} screen={screen}>
      {!screen.ready ? (
        // Calibration staging — swapped for the picker the moment tracking
        // lands, so the lobby's own nod/start affordances never appear.
        <SessionLobby
          title="Practice"
          subtitle="any activity, any level"
          screen={screen}
          onStart={() => {}}
          onExit={onExit}
        />
      ) : ui.phase === "pick" ? (
        <div className="w-full max-w-md">
          <h1 className="mb-1 text-center text-2xl font-bold tracking-tight">Practice</h1>
          <p className="mb-5 text-center text-sm text-muted">pick an activity and a level</p>
          <ul className="flex flex-col gap-1.5">
            {[...MICROGAMES, ...BOSSES].map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 transition hover:bg-black/5 dark:hover:bg-white/5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{d.title}</p>
                  <p className="truncate text-xs text-muted">
                    {d.prompt.lead} {d.prompt.action}
                  </p>
                </div>
                <span className="flex shrink-0 gap-1">
                  {([1, 2, 3, 4, 5] as const).map((l) => (
                    <button
                      key={l}
                      onClick={() => begin(d, l)}
                      aria-label={`${d.title}, level ${l}`}
                      className="h-7 w-7 rounded-md text-xs font-semibold tabular-nums text-muted ring-1 ring-black/10 transition hover:bg-accent hover:text-white hover:ring-accent dark:ring-white/15"
                    >
                      {l}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <div className="relative aspect-[8/7] w-full max-w-xl overflow-hidden rounded-2xl bg-black/5 ring-1 ring-black/10 dark:bg-white/5 dark:ring-white/10">
            <canvas
              key={ui.plays}
              ref={canvasRef}
              className={`absolute inset-0 h-full w-full transition-opacity duration-300 ${
                ui.phase === "playing" ? "opacity-100" : "opacity-0"
              }`}
            />

            {ui.phase === "playing" && picked && (
              <>
                <div className="absolute left-3 top-3">
                  <CountdownRing
                    timeLeft={ui.timeLeft}
                    totalMs={gameDurationMs(picked.def, picked.level) || GAME_MS}
                    variant="practice"
                  />
                </div>
                {ui.hud && (
                  <span className="absolute bottom-3 left-3 rounded-md bg-black/50 px-2.5 py-1 text-sm font-medium tabular-nums text-white">
                    {ui.hud}
                  </span>
                )}
              </>
            )}

            {ui.phase === "result" && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p
                  style={{ animation: "arcade-pop 0.4s ease both" }}
                  className={`text-6xl font-black tracking-tight ${
                    ui.outcome === "win" ? "text-accent" : "text-red-500"
                  }`}
                >
                  {ui.outcome === "win" ? "NICE!" : "MISS!"}
                </p>
              </div>
            )}
          </div>

          {/* Title, level, and the hint stay visible — this is a learning space. */}
          {picked && (
            <p className="text-sm text-muted">
              {picked.def.title} · level {picked.level} · {picked.def.hint}
            </p>
          )}
          {/* invisible (not unmounted) during the result, so the playfield
              doesn't jump when the buttons disappear */}
          <div className={`flex gap-2 ${ui.phase === "playing" ? "" : "invisible"}`}>
            <Button onClick={() => session?.recenter()}>Recenter</Button>
            <Button onClick={backToPicker}>Stop</Button>
          </div>
        </>
      )}
    </SessionShell>
  );
}
