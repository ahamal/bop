// The "stack": an ordered list of STEPS the player works through, shown as a
// reel of cards. A step is either a "hold still" card (the only place we recenter
// / re-zero neutral) or a movement to perform. Movements map onto the tracker
// gestures (gestures.ts): tuck, tiltLeft/Right, lookLeft/Right, lookDown, lookUp.

import type { GestureName } from "../tracking/gestures.ts";

export type Step =
  // Hold still — the player settles, then we recenter (re-zero) so the following
  // movements measure from a clean baseline. This is the ONLY step that centers.
  | { kind: "still"; label: string }
  // Return to a neutral head position for a beat (separates consecutive reps).
  // `recenter` re-zeroes neutral afterwards — wanted before a ROM hold, skipped
  // between identical reps where the baseline hasn't drifted.
  | { kind: "relax"; label: string; recenter?: boolean }
  // Hold a single gesture; the timer decreases only while it's held.
  | { kind: "hold"; label: string; state: GestureName; holdMs: number }
  // One directed half-circle pass, chin swept through the chest. dir 1 rolls
  // left → right, −1 right → left; each pass is its own card.
  | { kind: "roll"; label: string; dir: 1 | -1 };

// Each chin tuck is its own card. Every relax re-zeroes (recenters): the tuck
// threshold is a ~2% depth change against the calibrated neutral, so baseline
// drift between reps would swallow it — the recenter is what keeps rep 2+
// detectable.
const tuck = (): Step => ({ kind: "hold", label: "Tuck your chin in", state: "tuck", holdMs: 6000 });
const relax = (): Step => ({ kind: "relax", label: "Relax, back to neutral", recenter: true });

// TEMP(testing): jump straight to the roll cards — restore the full routine below.
export const NECK_ROUTINE: Step[] = [
  { kind: "still", label: "Sit comfortably and hold still" },
  { kind: "roll", label: "Slow half circle, left ear to chest to right", dir: 1 },
  { kind: "roll", label: "And back, right ear to chest to left", dir: -1 },
];

export const FULL_NECK_ROUTINE: Step[] = [
  { kind: "still", label: "Sit comfortably and hold still" },
  // Chin tucks — activation, 6 reps.
  tuck(), relax(),
  tuck(), relax(),
  tuck(), relax(),
  tuck(), relax(),
  tuck(), relax(),
  tuck(), relax(),
  // Range-of-motion holds, each preceded by a relax/re-zero.
  { kind: "hold", label: "Tilt your left ear to your shoulder", state: "tiltLeft", holdMs: 20000 },
  relax(),
  { kind: "hold", label: "Tilt your right ear to your shoulder", state: "tiltRight", holdMs: 20000 },
  relax(),
  { kind: "hold", label: "Look over your left shoulder", state: "lookLeft", holdMs: 20000 },
  relax(),
  { kind: "hold", label: "Look over your right shoulder", state: "lookRight", holdMs: 20000 },
  relax(),
  { kind: "hold", label: "Lower your chin to your chest", state: "lookDown", holdMs: 20000 },
  relax(),
  { kind: "hold", label: "Gently look up", state: "lookUp", holdMs: 5000 },
  relax(),
  // Flowing cooldown: one card per half-circle pass.
  { kind: "roll", label: "Slow half circle, left ear to chest to right", dir: 1 },
  { kind: "roll", label: "And back, right ear to chest to left", dir: -1 },
];
