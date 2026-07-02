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
  // A flowing pass through ordered checkpoints, alternating direction each pass.
  | { kind: "roll"; label: string; checkpoints: GestureName[]; passes: number };

// Each chin tuck is its own card. Between tuck reps a plain relax just separates
// them; before each ROM hold the relax also re-zeroes (recenters) so the hold
// measures from a clean baseline.
const tuck = (): Step => ({ kind: "hold", label: "Tuck your chin in", state: "tuck", holdMs: 6000 });
const relax = (): Step => ({ kind: "relax", label: "Relax, back to neutral" });
const relaxZero = (): Step => ({ kind: "relax", label: "Relax, back to neutral", recenter: true });

export const NECK_ROUTINE: Step[] = [
  { kind: "still", label: "Sit comfortably and hold still" },
  // Chin tucks — activation, 6 reps.
  tuck(), relax(),
  tuck(), relax(),
  tuck(), relax(),
  tuck(), relax(),
  tuck(), relax(),
  tuck(), relaxZero(),
  // Range-of-motion holds, each preceded by a relax/re-zero.
  { kind: "hold", label: "Tilt your left ear to your shoulder", state: "tiltLeft", holdMs: 20000 },
  relaxZero(),
  { kind: "hold", label: "Tilt your right ear to your shoulder", state: "tiltRight", holdMs: 20000 },
  relaxZero(),
  { kind: "hold", label: "Look over your left shoulder", state: "lookLeft", holdMs: 20000 },
  relaxZero(),
  { kind: "hold", label: "Look over your right shoulder", state: "lookRight", holdMs: 20000 },
  relaxZero(),
  { kind: "hold", label: "Lower your chin to your chest", state: "lookDown", holdMs: 20000 },
  relaxZero(),
  { kind: "hold", label: "Gently look up", state: "lookUp", holdMs: 5000 },
  relaxZero(),
  // Flowing cooldown.
  {
    kind: "roll",
    label: "Slow half circles, ear to chest to ear",
    checkpoints: ["tiltLeft", "lookDown", "tiltRight"],
    passes: 2,
  },
];
