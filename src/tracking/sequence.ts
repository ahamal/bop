// Turns the parallel gesture STATES into a single "dominant state" stream and
// recognizes short state SEQUENCES on top of it — the layer above gestures.ts.
//
// Gestures can overlap (a turn bleeds a little roll, etc.). For higher-level
// intent we want one thing at a time: the dominant state is the most strongly
// engaged gesture (its signal in multiples of its own enter threshold, so axes
// with different units compare fairly), or "neutral" when nothing is engaged.
//
// A sequence is a timed pattern over that stream. The one we need now is a nod:
//   neutral → lookDown (brief) → neutral
// i.e. a quick downward look bounded by neutral on both sides. Holding the head
// down does NOT count (the segment never ends inside the window); only a real
// down-and-back does. The same "quick gesture bounded by neutral" shape gives a
// quick look-left/right/etc. for free, so this stays general.

import {
  type GestureName,
  type GestureState,
  GESTURE_ENTER,
} from "./gestures.ts";

export type DominantState = GestureName | "neutral";

/** A recognized sequence that completed this frame. */
export interface SequenceEvent {
  /** e.g. "nod", or "quick:lookLeft". */
  name: string;
  timestamp: number;
}

// A quick gesture must last within this window to count (long enough to not be
// noise, short enough to be a deliberate flick rather than a held pose).
const QUICK_MIN_MS = 80;
const QUICK_MAX_MS = 900;

export class SequenceDetector {
  private dominant: DominantState = "neutral";
  private since = 0; // when the current dominant segment began
  private fromNeutral = true; // did the current segment start from neutral?

  /** The single dominant movement right now (or "neutral"). */
  get current(): DominantState {
    return this.dominant;
  }

  reset(): void {
    this.dominant = "neutral";
    this.since = 0;
    this.fromNeutral = true;
  }

  /** Feed the frame's gesture states; returns sequences completed this frame. */
  update(states: readonly GestureState[], now: number): SequenceEvent[] {
    const next = dominantOf(states);
    if (next === this.dominant) return [];

    const events: SequenceEvent[] = [];
    const ended = this.dominant;
    const dur = now - this.since;
    // Returning to neutral closes the previous segment. If that segment was a
    // gesture that STARTED from neutral and was brief, it's a "quick <gesture>".
    if (
      next === "neutral" &&
      ended !== "neutral" &&
      this.fromNeutral &&
      dur >= QUICK_MIN_MS &&
      dur <= QUICK_MAX_MS
    ) {
      events.push({ name: `quick:${ended}`, timestamp: now });
      if (ended === "lookDown") events.push({ name: "nod", timestamp: now });
    }

    // Advance: the new segment "came from neutral" iff we were just neutral.
    this.fromNeutral = ended === "neutral";
    this.dominant = next;
    this.since = now;
    return events;
  }
}

// The most strongly engaged active state (signal as a multiple of its own enter
// threshold, so degrees and depth ratios compare), or "neutral" if none.
function dominantOf(states: readonly GestureState[]): DominantState {
  let best: DominantState = "neutral";
  let bestStrength = 0;
  for (const s of states) {
    if (!s.active) continue;
    const strength = Math.abs(s.value) / (GESTURE_ENTER[s.name] || 1);
    if (strength > bestStrength) {
      bestStrength = strength;
      best = s.name;
    }
  }
  return best;
}
