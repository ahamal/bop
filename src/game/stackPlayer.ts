// Drives the routine one STEP at a time. Fed a FrameResult + elapsed ms each
// frame; returns a snapshot for the card reel. Pure game logic — no rendering.
//
//   still → wait for the head to hold still, then ask the host to RECENTER
//           (re-zero neutral). The host calls recentered() when it lands, which
//           advances to the next step. This is the ONLY step that centers.
//   relax → wait for the head to return inside generous near-rest angle bands
//           (raw axes, no gesture hysteresis) AND hold measurably still for a
//           beat (separates reps); most relax steps then recenter, absorbing
//           whatever the move shifted. Long stillness that never reaches the
//           bands = the baseline itself is off → recenter anyway (self-repair)
//           instead of deadlocking.
//   hold  → the timer decreases only while the target gesture is held.
//   roll  → one directed half-circle pass. Head roll/pitch map to a single angle
//           along a semicircle (180° = left ear down, 90° = chin to chest, 0° =
//           right ear down); a furthest-reached mark sweeps toward the far end
//           and can only advance CONTINUOUSLY, so skipping the middle can't count.
//           Only `progress` (how much of the pass is finished) is exposed — the
//           UI shows it as filling segments, not a live position.

import { GESTURE_ENTER, type GestureName, type GestureState } from "../tracking/gestures.ts";
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
const STILL_THRESH_DPS = 60; // deg/sec (yaw+pitch+roll) below this counts as still
// "Relax" gate: how much near-rest time to bank before we recenter and move
// on. Banked, not continuous: time in the bands accumulates, time outside
// drains in real time (1×) — a blip costs what it lasts, no 2× punishment,
// while sustained movement still empties the bank.
const RELAX_MS = 2000;
const RELAX_DRAIN = 1; // bank drain rate while outside the bands (× dt)
// ...and measurably STILL while doing it, so the recenter can't capture a
// still-settling pose as the new baseline. The rate sits above landmark
// jitter, below a settling move's tail.
const RELAX_STILL_DPS = 25;
// "Near rest" bands (deg from the current baseline), judged on the RAW axes —
// NOT via dominant === "neutral". Dominant carries every gesture's exit
// hysteresis, so when a move also shifts the body, the new resting pose can
// hover at an exit threshold (6° roll / ~1% depth) and flicker in and out of
// "neutral" forever. Raw bands have no hysteresis to flicker, and they're
// generous on purpose: a moderately deviated baseline is exactly what the
// recenter that follows is here to absorb (same trick as the dance game's
// center judging). Depth is deliberately NOT checked — it can't be told apart
// from rest without the baseline that's in question; recentering repairs it.
const RELAX_YAW_DEG = 13;
const RELAX_PITCH_DEG = 10;
const RELAX_ROLL_DEG = 9;
// Deadlock breaker: this much accumulated stillness without ever reaching the
// near-rest bands means the baseline itself has deviated past them (a person
// told to relax doesn't hold a stretch this steadily for this long). Recenter
// anyway: the fresh capture of the current (still) pose repairs the baseline,
// and the step advances when it lands.
const STUCK_STILL_MS = 7000;
// If a requested recenter never lands (host's onCalibrated doesn't fire — e.g.
// the face was lost mid-recenter), re-request after this long so the step can't
// stall forever.
const RECENTER_RETRY_MS = 3000;
// Roll pass tuning. Roll/pitch are normalized by their gesture enter thresholds,
// so magnitude 1 ≈ "far enough to count as that gesture". The tilt/pitch vector
// is EMA-smoothed BEFORE the angle is taken — atan2 on the raw metrics flips
// wildly near neutral — and every tolerance is generous because the off-axis
// camera couples the angle estimates.
const ARC_SMOOTH_MS = 250; // EMA time constant on the tilt/pitch vector
const ARC_MIN_MAG = 0.25; // below this the head is near neutral: marker holds, no progress
const ARC_MAX_ADVANCE = 60; // furthest mark can't jump more than this (deg) — forces a sweep
// Reaching within this (deg) of the far end completes the pass. Very generous:
// an angled camera can't reliably read a full ear-to-shoulder tilt at the ends.
const ARC_END_TOL = 50;

export class StackPlayer {
  private index = 0;
  private done = false;
  // movement accumulators
  private held = 0;
  // roll pass: smoothed tilt/pitch vector + furthest angle reached (deg; NaN
  // until the head first leaves neutral)
  private arcVecX = 0;
  private arcVecY = 0;
  private arcFurthest = NaN;
  // still accumulators
  private stillMs = 0;
  private prevAngles: { yaw: number; pitch: number; roll: number } | null = null;
  // Relax release latch: true once the previous hold's gesture has let go.
  private prevReleased = false;
  private recenterRequested = false;
  private recenterWaitMs = 0;

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

  /** Dev/testing helper: complete the current step unconditionally. */
  skip(): void {
    if (!this.done) this.advance();
  }

  /** Host recentered manually mid-step (new neutral baseline) → the progress
   * earned against the old baseline no longer means anything; start the current
   * step over without advancing. */
  resetCurrent(): void {
    if (this.done) return;
    this.held = 0;
    this.arcVecX = 0;
    this.arcVecY = 0;
    this.arcFurthest = NaN;
    this.stillMs = 0;
    this.prevAngles = null;
    this.prevReleased = false;
  }

  update(f: FrameResult, dt: number): StackSnapshot {
    if (this.done) return this.snapshot(false, false);
    const step = this.routine[this.index];
    if (step.kind === "still") return this.updateStill(f, dt);
    if (step.kind === "relax") return this.updateRelax(f, dt);
    return this.updateMove(f, dt);
  }

  // Wait until the head is inside the near-rest bands AND measurably still for
  // a beat, then recenter (re-zero) before the next movement. Advances when the
  // host confirms via recentered(). If the head stays still for a long time but
  // never inside the bands (the baseline itself deviated more than the bands —
  // see STUCK_STILL_MS), recenter anyway: the capture repairs the baseline.
  private updateRelax(f: FrameResult, dt: number): StackSnapshot {
    const step = this.routine[this.index];
    this.trackStillness(f, dt, RELAX_STILL_DPS, RELAX_DRAIN);
    const m = f.metrics;
    const nearRest =
      Math.abs(m.headYaw) <= RELAX_YAW_DEG &&
      Math.abs(m.headPitch) <= RELAX_PITCH_DEG &&
      Math.abs(m.headRoll) <= RELAX_ROLL_DEG;
    // Release latch: the bank opens only once the previous hold's gesture has
    // let go. The angle bands can't see a held TUCK (depth is deliberately
    // unchecked), so without this the bank — and the recenter — could run
    // while the player is still tucked and reading the card, baking a tucked
    // pose into the baseline. One-way: a later flicker can't close it again.
    // (A phantom "still held" gesture from a skewed baseline parks the bank at
    // zero, but the stuck-breaker below stays live and repairs that path.)
    if (!this.prevReleased) {
      const prev = this.index > 0 ? this.routine[this.index - 1] : null;
      this.prevReleased = !(prev?.kind === "hold" && isActive(f.states, prev.state));
    }
    this.held =
      this.prevReleased && nearRest
        ? this.held + dt
        : Math.max(0, this.held - dt * RELAX_DRAIN);
    const settled = this.held >= RELAX_MS && this.stillMs >= RELAX_MS;
    const stuck = this.stillMs >= STUCK_STILL_MS;
    if (settled || stuck) {
      // Only re-zero when the step asks for it (before a ROM hold); between
      // identical reps the baseline hasn't drifted, so just move on — unless
      // we got here stuck, where the recenter IS the repair.
      if (step.kind === "relax" && !step.recenter && !stuck) {
        this.advance();
        return this.snapshot(true, false);
      }
      return this.snapshot(nearRest, this.requestRecenterOnce(dt));
    }
    this.recenterWaitMs = 0;
    return this.snapshot(nearRest, false);
  }

  /** One-shot recenter request, re-armed if the host never confirms in time. */
  private requestRecenterOnce(dt: number): boolean {
    if (!this.recenterRequested) {
      this.recenterRequested = true;
      this.recenterWaitMs = 0;
      return true;
    }
    this.recenterWaitMs += dt;
    if (this.recenterWaitMs >= RECENTER_RETRY_MS) {
      this.recenterWaitMs = 0;
      return true;
    }
    return false;
  }

  private updateStill(f: FrameResult, dt: number): StackSnapshot {
    this.trackStillness(f, dt, STILL_THRESH_DPS);
    let requestRecenter = false;
    if (this.stillMs >= READY_STILL_MS) {
      requestRecenter = this.requestRecenterOnce(dt); // host recenters, then calls recentered()
    }
    return this.snapshot(false, requestRecenter);
  }

  // Accumulate/decay stillMs from the frame-to-frame angular rate (deg/sec, so
  // the gate reads the same at any camera fps). Measured against the previous
  // FRAME, not the baseline — which is what lets it stay trustworthy even when
  // the baseline itself is skewed. `drain` scales how fast moving frames eat
  // the bank (the still card punishes movement; relax forgives wobbles).
  private trackStillness(f: FrameResult, dt: number, thresholdDps: number, drain = 2): void {
    const a = { yaw: f.metrics.headYaw, pitch: f.metrics.headPitch, roll: f.metrics.headRoll };
    if (this.prevAngles && dt > 0) {
      const move =
        Math.abs(a.yaw - this.prevAngles.yaw) +
        Math.abs(a.pitch - this.prevAngles.pitch) +
        Math.abs(a.roll - this.prevAngles.roll);
      const rate = (move / dt) * 1000;
      this.stillMs =
        rate < thresholdDps ? this.stillMs + dt : Math.max(0, this.stillMs - dt * drain);
    }
    this.prevAngles = a;
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
        // Where the head is along the semicircle: tilt (roll) is the horizontal
        // axis, chin-down (pitch) the vertical, each normalized by its gesture
        // enter threshold so the arc is round in "gesture units".
        const x = -f.metrics.headRoll / GESTURE_ENTER.tiltRight; // + = tilted right
        const y = -f.metrics.headPitch / GESTURE_ENTER.lookDown; // + = chin down
        // Smooth the vector, not the angle (no 0°/180° wraparound artifacts).
        const k = 1 - Math.exp(-dt / ARC_SMOOTH_MS);
        this.arcVecX += (x - this.arcVecX) * k;
        this.arcVecY += (y - this.arcVecY) * k;
        const mag = Math.hypot(this.arcVecX, this.arcVecY);
        active = mag >= ARC_MIN_MAG;
        if (Number.isNaN(this.arcFurthest)) this.arcFurthest = step.dir === 1 ? 180 : 0;
        if (active) {
          // Above-horizontal (looking up) clamps to the nearest end.
          const angle = (Math.atan2(Math.max(0, this.arcVecY), this.arcVecX) * 180) / Math.PI;
          // The furthest mark only moves toward the far end, and only by a
          // continuous amount — a jump straight across can't skip the chest.
          const ahead = step.dir === 1 ? this.arcFurthest - angle : angle - this.arcFurthest;
          if (ahead > 0 && ahead <= ARC_MAX_ADVANCE) this.arcFurthest = angle;
          const reached =
            step.dir === 1 ? this.arcFurthest <= ARC_END_TOL : this.arcFurthest >= 180 - ARC_END_TOL;
          if (reached) this.advance();
        }
        break;
      }
    }
    return this.snapshot(active, false);
  }

  private advance(): void {
    this.index += 1;
    this.held = 0;
    this.arcVecX = 0;
    this.arcVecY = 0;
    this.arcFurthest = NaN;
    this.stillMs = 0;
    this.prevAngles = null;
    this.prevReleased = false;
    this.recenterRequested = false;
    this.recenterWaitMs = 0;
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
        // Both gates must fill: continuous neutral AND accumulated stillness.
        progress = Math.min(1, Math.min(this.held, this.stillMs) / RELAX_MS);
        break;
      }
      case "hold": {
        progress = this.held / step.holdMs;
        detail = `${Math.ceil((step.holdMs - this.held) / 1000)}s`;
        break;
      }
      case "roll": {
        const start = step.dir === 1 ? 180 : 0;
        const swept = Number.isNaN(this.arcFurthest) ? 0 : Math.abs(start - this.arcFurthest);
        progress = swept / (180 - ARC_END_TOL);
        break;
      }
    }
    return { index: this.index, total, kind: step.kind, label: step.label, detail, progress: Math.min(1, progress), active, done: false, requestRecenter };
  }
}

function isActive(states: readonly GestureState[], name: GestureName): boolean {
  return states.find((s) => s.name === name)?.active ?? false;
}
