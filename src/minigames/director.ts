// The ArcadeDirector: the WarioWare run's brain, plain TS. Owns the state
// machine (nod-wait → stats → prompt → playing → result → …), the shuffled
// game bag, and lives/level/score. Fed a FrameResult + elapsed ms every frame
// (it IS the arcade's frame sink); emits coarse snapshots to React on phase
// changes and whole-second ticks only — the same split as StackPlayer /
// PlayScreen. Per-frame gameplay stays inside the running Microgame, which
// renders through its own Avatar subclass on the playfield canvas.
//
// Run structure (docs/arcade-plan.md): a round is GAMES_PER_ROUND microgames
// drawn from a bag with no repeats until it empties; after each round the
// level ticks up (1→5). Lives start at 4, a loss costs one, 0 ends the run;
// surviving round 5 wins it. Score = games cleared.
//
// The director also fires the result stingers (win chime / fail thud + music
// duck) — it's the only place that knows the exact transition frame.

import { arcadeMusicPlayer } from "../audio/player.ts";
import { playCelebrate, playDone, playFail } from "../audio/sfx.ts";
import type { FrameResult, TrackingSession } from "../tracking/session.ts";
import {
  BOSSES,
  MICROGAMES,
  gameDurationMs,
  type Level,
  type Microgame,
  type MicrogameDef,
} from "./registry.ts";

// Cutscene beat lengths (ms). Exported so the React chrome can size its CSS
// card animations to exactly one phase.
export const STATS_MS = 1500;
export const PROMPT_MS = 1700;
export const RESULT_MS = 1000;
/** One microgame's clock — the countdown ring's full sweep. */
export const GAME_MS = 10_000;

export const GAMES_PER_ROUND = 8;
export const MAX_LEVEL = 5;
export const START_LIVES = 4;

type ArcadePhase =
  | "nod-wait"
  | "stats"
  | "prompt"
  | "playing"
  | "result"
  | "gameover"
  | "win";

export type Outcome = "win" | "lose";

export interface ArcadeSnapshot {
  phase: ArcadePhase;
  level: Level;
  /** 1-based game number within the current round. */
  gameNum: number;
  lives: number;
  score: number;
  /** Total games started this visit (across runs) — keys the playfield canvas
   *  so every game mounts a fresh node. */
  plays: number;
  /** The game being introduced / played / just resolved. */
  def: MicrogameDef | null;
  /** Last game's result — set through the result card, cleared at next stats. */
  outcome: Outcome | null;
  /** Whole seconds left on the game clock (playing only). */
  timeLeft: number;
  /** Which stat just changed — the stats card animates that one. */
  statChange: "level" | "life" | null;
  /** The running game's progress line ("2 / 5"), for the HUD chip. */
  hud: string;
  /** This play is the round's boss fight (the 9th slot, gating the level). */
  boss: boolean;
}

export class ArcadeDirector {
  private phase: ArcadePhase = "nod-wait";
  private level: Level = 1;
  private gameNum = 1;
  private lives = START_LIVES;
  private score = 0;
  private plays = 0;
  private bag: MicrogameDef[] = [];
  private def: MicrogameDef | null = null;
  private lastBoss: MicrogameDef | null = null;
  private game: Microgame | null = null;
  private outcome: Outcome | null = null;
  private statChange: "level" | "life" | null = null;
  private phaseMs = 0; // time spent in the current cutscene phase
  private timerMs = GAME_MS;
  private lastSecond = -1;
  private lastHud = "";
  private listeners = new Set<(s: ArcadeSnapshot) => void>();

  private startLevel: Level = 1;
  private enabledIds: ReadonlySet<string> | null = null; // null = all games

  constructor(
    private session: TrackingSession,
    // Resolved lazily: React mounts the playfield canvas when the run starts
    // (phase leaves nod-wait), a couple of seconds before the first create().
    private canvas: () => HTMLCanvasElement | null,
  ) {}

  /** Dev panel: restrict the bag AND the boss pool to these game ids
   * (empty/unknown = all; a pool with none of its games enabled stays full,
   * so checking only bag games never leaves the boss slot empty). */
  setEnabledGames(ids: readonly string[]): void {
    const set = new Set(ids);
    this.enabledIds = set.size > 0 ? set : null;
    // Drop queued games that are no longer enabled; the bag refills filtered.
    const bagPool = new Set(this.pool(MICROGAMES));
    this.bag = this.bag.filter((d) => bagPool.has(d));
  }

  // A pool filtered to the dev panel's enabled ids, falling back to the full
  // pool when the filter would empty it.
  private pool(defs: readonly MicrogameDef[]): readonly MicrogameDef[] {
    if (!this.enabledIds) return defs;
    const on = defs.filter((d) => this.enabledIds!.has(d.id));
    return on.length > 0 ? on : defs;
  }

  /** Dev panel: jump the run to this level — runs start here, and mid-run the
   * NEXT game is created at it (the running game keeps its level). */
  setLevel(l: Level): void {
    this.startLevel = l;
    if (this.level !== l) {
      this.level = l;
      this.emit();
    }
  }

  get snapshot(): ArcadeSnapshot {
    return {
      phase: this.phase,
      level: this.level,
      gameNum: this.gameNum,
      lives: this.lives,
      score: this.score,
      plays: this.plays,
      def: this.def,
      outcome: this.outcome,
      timeLeft: Math.max(0, Math.ceil(this.timerMs / 1000)),
      statChange: this.statChange,
      hud: this.game?.hud ?? "",
      boss: this.def !== null && BOSSES.includes(this.def),
    };
  }

  subscribe(fn: (s: ArcadeSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Kick off a run — the nod does this, or a button as the fallback. */
  startRun(): void {
    if (this.phase !== "nod-wait" && this.phase !== "gameover" && this.phase !== "win") return;
    this.level = this.startLevel;
    this.gameNum = 1;
    this.lives = START_LIVES;
    this.score = 0;
    this.bag = [];
    this.outcome = null;
    this.statChange = null;
    this.drawNext();
    this.setPhase("stats");
  }

  /** Tear down whatever game is running. Call on unmount. */
  dispose(): void {
    this.game?.dispose();
    this.game = null;
    this.listeners.clear();
  }

  /** The arcade's frame sink: advances cutscene clocks and the running game. */
  update(f: FrameResult, dt: number): void {
    switch (this.phase) {
      case "nod-wait":
      case "gameover":
      case "win":
        // A real nod (neutral → brief look-down → neutral) starts/restarts.
        if (f.sequenceEvents.some((e) => e.name === "nod")) this.startRun();
        return;
      case "stats":
        this.phaseMs += dt;
        if (this.phaseMs >= STATS_MS) this.setPhase("prompt");
        return;
      case "prompt":
        this.phaseMs += dt;
        // beginGame is a no-op until the playfield canvas exists (React mounts
        // it during stats), so an unlucky frame just retries.
        if (this.phaseMs >= PROMPT_MS) this.beginGame();
        return;
      case "playing": {
        const g = this.game!;
        g.update(f, dt);
        this.timerMs -= dt;
        if (g.outcome !== "pending") {
          this.resolve(g.outcome);
        } else if (this.timerMs <= 0) {
          this.resolve(this.def?.timeoutWins ? "win" : "lose");
        } else {
          // Keep the ring and HUD chip ticking without per-frame renders.
          const sec = Math.ceil(this.timerMs / 1000);
          const hud = g.hud ?? "";
          if (sec !== this.lastSecond || hud !== this.lastHud) {
            this.lastSecond = sec;
            this.lastHud = hud;
            this.emit();
          }
        }
        return;
      }
      case "result":
        this.phaseMs += dt;
        if (this.phaseMs >= RESULT_MS) this.advance();
        return;
    }
  }

  // No repeats until the bag of every enabled game empties, then reshuffle.
  private drawNext(): void {
    if (this.bag.length === 0) this.bag = shuffle([...this.pool(MICROGAMES)]);
    this.def = this.bag.pop()!;
    this.plays += 1;
  }

  // One boss per round from the candidate pool, varying across rounds when
  // there's more than one (a boss LOSS never redraws — advance() keeps def).
  private drawBoss(): MicrogameDef {
    const pool = this.pool(BOSSES);
    const fresh = pool.filter((d) => d !== this.lastBoss);
    const pick = fresh.length > 0 ? fresh[Math.floor(Math.random() * fresh.length)] : pool[0];
    this.lastBoss = pick;
    return pick;
  }

  private beginGame(): void {
    const canvas = this.canvas();
    if (!canvas || !this.def) return;
    this.game = this.def.create(canvas, this.session, this.level);
    this.timerMs = gameDurationMs(this.def, this.level) || GAME_MS;
    this.lastSecond = -1;
    this.lastHud = "";
    this.setPhase("playing");
  }

  private resolve(outcome: Outcome): void {
    this.game?.dispose();
    this.game = null;
    this.outcome = outcome;
    if (outcome === "win") {
      this.score += 1;
      playDone();
    } else {
      this.lives -= 1;
      playFail();
      arcadeMusicPlayer.duck();
    }
    this.setPhase("result");
  }

  private advance(): void {
    if (this.lives <= 0) {
      this.setPhase("gameover");
      return;
    }
    // A loss greys a heart on the next stats card; a round rollover trumps it
    // (the level digit roll is the bigger beat — the missing heart still shows).
    this.statChange = this.outcome === "lose" ? "life" : null;
    if (this.def && BOSSES.includes(this.def)) {
      // The boss gates the level: a loss (with lives left) replays the fight;
      // beating it opens the next level — or the run's win after level 5.
      if (this.outcome === "lose") {
        this.outcome = null;
        this.plays += 1; // fresh canvas for the rematch
        this.setPhase("stats");
        return;
      }
      if (this.level >= MAX_LEVEL) {
        playCelebrate();
        this.setPhase("win");
        return;
      }
      this.level = (this.level + 1) as Level;
      this.gameNum = 1;
      this.statChange = "level";
      this.outcome = null;
      this.drawNext();
      this.setPhase("stats");
      return;
    }
    this.gameNum += 1;
    if (this.gameNum > GAMES_PER_ROUND) {
      // Round cleared — a boss blocks the level door (the 9th slot).
      this.def = this.drawBoss();
      this.plays += 1;
      this.outcome = null;
      this.setPhase("stats");
      return;
    }
    this.outcome = null;
    this.drawNext();
    this.setPhase("stats");
  }

  private setPhase(p: ArcadePhase): void {
    this.phase = p;
    this.phaseMs = 0;
    this.emit();
  }

  private emit(): void {
    const s = this.snapshot;
    for (const fn of this.listeners) fn(s);
  }
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
