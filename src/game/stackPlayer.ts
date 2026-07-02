// Drives the routine one STEP at a time. Fed a FrameResult + elapsed ms each
// frame; returns a snapshot for the card reel. Pure game logic — no rendering.
//
//   still → wait for the head to hold still, then ask the host to RECENTER
//           (re-zero neutral). The host calls recentered() when it lands, which
//           advances to the next step. This is the ONLY step that centers.
//   relax → wait for the head to return near neutral for a beat (separates reps).
//   hold  → the timer decreases only while the target gesture is held.
//   roll  → advance through ordered checkpoints (dominant stream), each full pass
//           alternating direction.

import type { GestureName, GestureState } from "../tracking/gestures.ts";
import type { FrameResult } from "../tracking/session.ts";
import type { Step } from "./routine.ts";

export interface StackSnapshot {
  index: number; // current step (== total when done)
  total: number;
  kind: Step["kind"] | "done";
  label: string;
  detail: string; // "12s", "2 / 3", "1 / 2" (empty for still)
  progress: number; // 0..1 (stillness while settling, movement while running)
  active: boolean; // target satisfied this frame
  done: boolean;
  /** One-shot: true the frame a still step wants the host to recenter. */
  requestRecenter: boolean;
}

// "Hold still" gate.
const READY_STILL_MS = 1800;
const STILL_THRESH = 2.0; // deg/frame (yaw+pitch+roll) below this counts as still
// "Relax" gate: how long to stay near neutral before we recenter and move on.
const RELAX_MS = 1200;

export class StackPlayer {
  private index = 0;
  private done = false;
  // movement accumulators
  private held = 0;
  private checkpoint = 0;
  private passes = 0;
  private dir = 1;
  // still accumulators
  private stillMs = 0;
  private prevAngles: { yaw: number; pitch: number; roll: number } | null = null;
  private recenterRequested = false;

  constructor(private routine: Step[]) {}

  get isDone(): boolean {
    return this.done;
  }

  /** Host confirms the requested recenter landed → move past this still/relax step. */
  recentered(): void {
    if (this.done) return;
    const k = this.routine[this.index]?.kind;
    if (k === "still" || k === "relax") this.advance();
  }

  update(f: FrameResult, dt: number): StackSnapshot {
    if (this.done) return this.snapshot(false, false);
    const step = this.routine[this.index];
    if (step.kind === "still") return this.updateStill(f, dt);
    if (step.kind === "relax") return this.updateRelax(f, dt);
    return this.updateMove(f, dt);
  }

  // Wait until the head returns near neutral for a beat, then recenter (re-zero)
  // before the next movement. Advances when the host confirms via recentered().
  private updateRelax(f: FrameResult, dt: number): StackSnapshot {
    const neutral = f.dominant === "neutral";
    this.held = neutral ? this.held + dt : 0; // must be continuously neutral
    let requestRecenter = false;
    if (this.held >= RELAX_MS && !this.recenterRequested) {
      this.recenterRequested = true;
      requestRecenter = true;
    }
    return this.snapshot(neutral, requestRecenter);
  }

  private updateStill(f: FrameResult, dt: number): StackSnapshot {
    const a = { yaw: f.metrics.headYaw, pitch: f.metrics.headPitch, roll: f.metrics.headRoll };
    let requestRecenter = false;
    if (this.prevAngles) {
      const move =
        Math.abs(a.yaw - this.prevAngles.yaw) +
        Math.abs(a.pitch - this.prevAngles.pitch) +
        Math.abs(a.roll - this.prevAngles.roll);
      this.stillMs = move < STILL_THRESH ? this.stillMs + dt : Math.max(0, this.stillMs - dt * 2);
      if (this.stillMs >= READY_STILL_MS && !this.recenterRequested) {
        this.recenterRequested = true;
        requestRecenter = true; // host recenters, then calls recentered()
      }
    }
    this.prevAngles = a;
    return this.snapshot(false, requestRecenter);
  }

  private updateMove(f: FrameResult, dt: number): StackSnapshot {
    const step = this.routine[this.index];
    let active = false;
    switch (step.kind) {
      case "hold": {
        active = isActive(f.states, step.state);
        if (active) this.held = Math.min(step.holdMs, this.held + dt);
        if (this.held >= step.holdMs) this.advance();
        break;
      }
      case "roll": {
        const seq = this.dir === 1 ? step.checkpoints : [...step.checkpoints].reverse();
        if (f.dominant === seq[this.checkpoint]) this.checkpoint += 1;
        active = f.dominant !== "neutral";
        if (this.checkpoint >= seq.length) {
          this.passes += 1;
          this.checkpoint = 0;
          this.dir *= -1;
          if (this.passes >= step.passes) this.advance();
        }
        break;
      }
    }
    return this.snapshot(active, false);
  }

  private advance(): void {
    this.index += 1;
    this.held = 0;
    this.checkpoint = 0;
    this.passes = 0;
    this.dir = 1;
    this.stillMs = 0;
    this.prevAngles = null;
    this.recenterRequested = false;
    if (this.index >= this.routine.length) this.done = true;
  }

  private snapshot(active: boolean, requestRecenter: boolean): StackSnapshot {
    const total = this.routine.length;
    if (this.done) {
      return { index: total, total, kind: "done", label: "All done — nice work.", detail: "", progress: 1, active: false, done: true, requestRecenter: false };
    }
    const step = this.routine[this.index];
    let detail = "";
    let progress = 0;
    switch (step.kind) {
      case "still": {
        progress = Math.min(1, this.stillMs / READY_STILL_MS);
        break;
      }
      case "relax": {
        progress = Math.min(1, this.held / RELAX_MS);
        break;
      }
      case "hold": {
        progress = this.held / step.holdMs;
        detail = `${Math.ceil((step.holdMs - this.held) / 1000)}s`;
        break;
      }
      case "roll": {
        const len = step.checkpoints.length;
        progress = (this.passes + this.checkpoint / len) / step.passes;
        detail = `${Math.min(this.passes + 1, step.passes)} / ${step.passes}`;
        break;
      }
    }
    return { index: this.index, total, kind: step.kind, label: step.label, detail, progress: Math.min(1, progress), active, done: false, requestRecenter };
  }
}

function isActive(states: readonly GestureState[], name: GestureName): boolean {
  return states.find((s) => s.name === name)?.active ?? false;
}
