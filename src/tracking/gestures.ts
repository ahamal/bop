// Turns the continuous metric stream into discrete movement states.
//
// Each state is one direction of one axis (look left, tilt right, tuck, …). A
// state engages when its signal crosses an "enter" threshold and disengages
// only after falling back inside an "exit" threshold (hysteresis), so a single
// slow move toggles once. While engaged we track how long it's been held and
// the peak it reached; the moment it engages we also emit a one-shot
// GestureEvent (the hook the rhythm game times against).
//
// Signals are read from Metrics, which is already mirror-corrected, so states,
// the readout, and the avatar all share one handedness. Each config's `signal`
// returns a scalar where MORE POSITIVE = further INTO the gesture; flip the sign
// there if an axis reads reversed on your camera.
//
// Axes can still bleed — a hard turn fakes some roll — and a deliberate tuck is
// only meaningful facing forward, so a state can also `guard` against other
// axes: it engages only while those stay near neutral. That keeps "look left"
// from also lighting tilt, and limits tuck to a forward-facing retraction.

import { OneEuroFilter } from "./filter.ts";
import type { Metrics } from "./metrics.ts";

export type GestureAxis = "yaw" | "pitch" | "roll" | "depth";

export type GestureName =
  | "lookLeft"
  | "lookRight"
  | "lookUp"
  | "lookDown"
  | "tiltLeft"
  | "tiltRight"
  | "tuck";

/** Stable display/iteration order, grouped by axis. */
export const GESTURE_NAMES: readonly GestureName[] = [
  "lookLeft",
  "lookRight",
  "lookUp",
  "lookDown",
  "tiltLeft",
  "tiltRight",
  "tuck",
];

/** Fired once, at the frame a state engages. */
export interface GestureEvent {
  name: GestureName;
  /** Signal value at the moment it engaged (its own unit; see GestureState). */
  value: number;
  timestamp: number;
}

/** Live snapshot of one state, for the readout. */
export interface GestureState {
  name: GestureName;
  axis: GestureAxis;
  /** Currently engaged (past enter, not yet re-armed). */
  active: boolean;
  /** How long it's been continuously engaged, ms (0 when inactive). */
  heldMs: number;
  /** Current signal value — degrees for angles, depth ratio for tuck. */
  value: number;
  /** Peak |value| reached during the current engagement. */
  peak: number;
}

interface GestureConfig {
  axis: GestureAxis;
  /** Map metrics → a signed scalar; positive = engaged. */
  signal: (m: Metrics) => number;
  enter: number; // engage at/above
  exit: number; // re-arm at/below
  requiresBody?: boolean; // needs a trustworthy torso (tuck)
  dwellMs?: number; // engage condition must persist this long first
  filtered?: boolean; // smooth the signal before thresholding (tuck)
  // Torso-stillness guard: |torsoCloseness − 1| must stay at/below this for the
  // gesture to engage or persist. This is how a tuck (head retracts, torso
  // holds) is told apart from a whole-body lean — as a veto, not a subtraction,
  // so shoulder-width scale error can't shift the signal being thresholded.
  torsoBand?: number;
  // Cross-axis guards: each named axis's magnitude (deg from neutral) must stay
  // at/below its limit for this gesture to ENGAGE. This is what keeps a turn
  // from bleeding into a tilt, or a turn/nod from bleeding into a tuck — the
  // angle estimates couple, so a "centered" requirement is how a state stays
  // its own movement. Entry-only, deliberately: once a gesture is genuinely
  // engaged, adding a secondary movement on top (the assisted tilt's "look
  // slightly up" bleeds coupled yaw) must not drop it — disengaging is owned
  // by the signal's own exit hysteresis (plus validity/torso, which really do
  // invalidate a hold).
  guards?: Partial<Record<"yaw" | "pitch" | "roll", number>>;
}

// Angle thresholds are degrees from neutral; tuck is on the head retraction
// ratio (1 − metrics.headCloseness). These are the tuning knobs. Lateral flexion
// (roll) and pitch use smaller ranges than yaw because their comfortable range
// of motion is smaller.
const CONFIGS: Record<GestureName, GestureConfig> = {
  lookLeft: { axis: "yaw", signal: (m) => -m.headYaw, enter: 21, exit: 10 },
  lookRight: { axis: "yaw", signal: (m) => m.headYaw, enter: 21, exit: 10 },
  // pitch is chin-down-positive in metrics, but reads inverted for "looking" —
  // so up is +pitch, down is −pitch here.
  lookUp: { axis: "pitch", signal: (m) => m.headPitch, enter: 15, exit: 8 },
  lookDown: { axis: "pitch", signal: (m) => -m.headPitch, enter: 15, exit: 8 },
  // A tilt is roll without a turn: a big yaw fakes roll, so guard on yaw.
  tiltLeft: {
    axis: "roll",
    signal: (m) => m.headRoll,
    enter: 12,
    exit: 6,
    guards: { yaw: 15 },
  },
  tiltRight: {
    axis: "roll",
    signal: (m) => -m.headRoll,
    enter: 12,
    exit: 6,
    guards: { yaw: 15 },
  },
  tuck: {
    axis: "depth",
    // Head retraction alone: face-matrix-Z closeness drops below 1 as the head
    // pulls back, so 1 − closeness is positive = tucked. The torso is a
    // stillness veto (torsoBand), not part of the signal — its scale error and
    // noise stay out of this tiny threshold. Fractions of neutral closeness.
    // Tuned permissive (1.4% after filtering): a false negative on an honest
    // tuck is far more frustrating than a false positive — the tuck card is
    // explicit about what's being asked, so lean toward trusting the player.
    signal: (m) => 1 - m.headCloseness,
    enter: 0.014,
    exit: 0.007,
    requiresBody: true,
    // Generous: shoulder width is the noisiest signal in the stack, and people
    // naturally brace their shoulders while tucking.
    torsoBand: 0.06,
    dwellMs: 150,
    filtered: true,
    // A deliberate tuck is done facing forward; keep it from counting mid-turn.
    // Pitch is the loose one: a natural tuck INCLUDES some chin-down, so real
    // tucks ride 12–18° of pitch — the guard only needs to reject a full
    // chin-to-chest nod (lookDown enters at 15° and keeps going).
    guards: { yaw: 12, pitch: 20, roll: 10 },
  },
};

/**
 * Enter threshold per gesture — used to normalize signal strength across axes
 * (degrees vs depth ratio) when deciding the single dominant state (sequence.ts).
 */
export const GESTURE_ENTER: Record<GestureName, number> = Object.fromEntries(
  GESTURE_NAMES.map((n) => [n, CONFIGS[n].enter]),
) as Record<GestureName, number>;

function guardsSatisfied(cfg: GestureConfig, m: Metrics): boolean {
  const g = cfg.guards;
  if (!g) return true;
  if (g.yaw !== undefined && Math.abs(m.headYaw) > g.yaw) return false;
  if (g.pitch !== undefined && Math.abs(m.headPitch) > g.pitch) return false;
  if (g.roll !== undefined && Math.abs(m.headRoll) > g.roll) return false;
  return true;
}

function torsoStill(cfg: GestureConfig, m: Metrics): boolean {
  return cfg.torsoBand === undefined || Math.abs(m.torsoCloseness - 1) <= cfg.torsoBand;
}

// How long a body-requiring gesture keeps working after the last trustworthy
// shoulder frame. Body tracking flickers (a raised arm, lighting); one dropped
// frame must not kill an engaged tuck or reset its dwell — only a sustained
// loss should veto.
const BODY_GRACE_MS = 400;

export class GestureDetector {
  private states: Record<GestureName, GestureState>;
  private pendingSince: Record<GestureName, number | null>;
  private activatedAt: Record<GestureName, number>;
  private filters: Partial<Record<GestureName, OneEuroFilter>> = {};
  private lastBodyMs = -Infinity; // when the body was last trustworthy

  constructor() {
    this.states = {} as Record<GestureName, GestureState>;
    this.pendingSince = {} as Record<GestureName, number | null>;
    this.activatedAt = {} as Record<GestureName, number>;
    for (const name of GESTURE_NAMES) {
      const cfg = CONFIGS[name];
      this.states[name] = {
        name,
        axis: cfg.axis,
        active: false,
        heldMs: 0,
        value: 0,
        peak: 0,
      };
      this.pendingSince[name] = null;
      this.activatedAt[name] = 0;
      // One-Euro on the jittery depth signal: steady at rest, low-lag on a move.
      if (cfg.filtered) this.filters[name] = new OneEuroFilter(0.6, 0.7, 1.0);
    }
  }

  /** Clear all state and filter history (call at (re)calibration). */
  reset(): void {
    for (const name of GESTURE_NAMES) {
      const st = this.states[name];
      st.active = false;
      st.heldMs = 0;
      st.value = 0;
      st.peak = 0;
      this.pendingSince[name] = null;
      this.activatedAt[name] = 0;
      this.filters[name]?.reset();
    }
    this.lastBodyMs = -Infinity;
  }

  /** Live state of every gesture, in GESTURE_NAMES order. */
  snapshot(): readonly GestureState[] {
    return GESTURE_NAMES.map((n) => this.states[n]);
  }

  /** Filtered head retraction (closeness − 1, so negative = retracted) — the
   * signal the tuck threshold compares against, in the meter's sign convention. */
  get depthFiltered(): number {
    return -this.states.tuck.value;
  }

  /** Feed a frame of metrics; returns any states that engaged this frame. */
  update(m: Metrics, now: number): GestureEvent[] {
    if (m.bodyTracked) this.lastBodyMs = now;
    const events: GestureEvent[] = [];
    for (const name of GESTURE_NAMES) this.step(name, m, now, events);
    return events;
  }

  private step(
    name: GestureName,
    m: Metrics,
    now: number,
    out: GestureEvent[],
  ): void {
    const cfg = CONFIGS[name];
    const st = this.states[name];

    let sig = cfg.signal(m);
    if (cfg.filtered) sig = this.filters[name]!.filter(sig, now);
    st.value = sig;

    // requiresBody with grace: a fresh trustworthy shoulder frame isn't needed
    // every frame, just recently — dropouts bridge instead of vetoing. (The
    // torso-stillness check self-neutralizes on dropout frames: torsoCloseness
    // reads exactly 1 when no body backed the frame.)
    const valid = !cfg.requiresBody || now - this.lastBodyMs <= BODY_GRACE_MS;
    const torsoOk = torsoStill(cfg, m);
    const engaged = valid && guardsSatisfied(cfg, m) && torsoOk && sig >= cfg.enter;

    if (!st.active) {
      if (engaged) {
        const since = this.pendingSince[name] ?? now;
        this.pendingSince[name] = since;
        // Dwell: the condition has to hold for a beat before it counts.
        if (now - since >= (cfg.dwellMs ?? 0)) {
          st.active = true;
          st.heldMs = 0;
          st.peak = Math.abs(sig);
          this.activatedAt[name] = now;
          this.pendingSince[name] = null;
          out.push({ name, value: sig, timestamp: now });
        }
      } else {
        this.pendingSince[name] = null;
      }
    } else if (!valid || !torsoOk || sig <= cfg.exit) {
      // Re-arm on the way back out, or if the torso moved / body was lost.
      // Cross-axis guards deliberately do NOT drop an engaged gesture (see
      // GestureConfig.guards) — only entry checks them.
      st.active = false;
      st.heldMs = 0;
    } else {
      // Still engaged: grow the duration and remember the peak.
      st.heldMs = now - this.activatedAt[name];
      st.peak = Math.max(st.peak, Math.abs(sig));
    }
  }
}
