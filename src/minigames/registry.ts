// The microgame registry (docs/arcade-plan.md). Every arcade game is a
// MicrogameDef: static chrome for the cutscene cards (title, prompt, headline,
// hint) plus a factory that builds the running game. Games attach their own
// Avatar subclass to the shared playfield canvas via the session (the pattern
// proven by ChompAvatar) and consume the frame stream through update() — the
// ArcadeDirector calls it every frame; nothing per-frame touches React.
//
// Difficulty enters ONLY through create(..., level): a def is one game, its
// five levels are one parameter, not five entries.

import type { FrameResult, TrackingSession } from "../tracking/session.ts";
import { chompDef } from "./chomp/chomp.ts";
import { danceDef } from "./dance/dance.ts";
import { droneDef } from "./drone/drone.ts";
import { taxiDef } from "./taxi/taxi.ts";

export type Level = 1 | 2 | 3 | 4 | 5;

/** A running microgame instance — one ~10s play. */
export interface Microgame {
  /** The FrameSink: one detection frame + elapsed ms, every frame while playing. */
  update(f: FrameResult, dt: number): void;
  /** Resolves itself: the director ends the game the frame this leaves "pending". */
  readonly outcome: "pending" | "win" | "lose";
  /** Optional one-line progress ("2 / 5") for the in-game HUD chip. */
  readonly hud?: string;
  /** Release everything create() claimed (meshes, and the attached avatar). */
  dispose(): void;
}

export interface MicrogameDef {
  id: string;
  title: string;
  /** Fake-2026-headline flavor line on the prompt card. */
  headline: string;
  /** Two-tier prompt: small lead-in + huge action word ("tilt to" / "BALANCE"). */
  prompt: { lead: string; action: string };
  /** Control hint, one short line ("lean to slide · open wide to chomp"). */
  hint: string;
  /** Survival games win when the clock runs out; omit/false = timeout is a loss. */
  timeoutWins?: boolean;
  create(canvas: HTMLCanvasElement, session: TrackingSession, level: Level): Microgame;
}

// The lineup — grows toward the 12 in the plan; Chomp ("Eat") is the exemplar
// that proves the round loop end to end.
export const MICROGAMES: readonly MicrogameDef[] = [chompDef, danceDef, taxiDef, droneDef];
