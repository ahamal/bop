// The live indicator panel: builds and updates two clearly separated groups —
//   Metrics: continuous signals, each on a center-origin meter that fills left
//            or right of zero so direction is visible at a glance.
//   States:  discrete movement states, each a lit dot + how long it's been held.
// It's data-driven (METERS + the gesture snapshot) so every row looks uniform.
// Styling is Tailwind utilities applied here (no stylesheet); theme tokens
// (bg-panel, text-muted, bg-accent) keep it on the app's light/dark palette.

import type { Metrics } from "../tracking/metrics.ts";
import type { GestureState, GestureName } from "../tracking/gestures.ts";

// Shared class strings for the repeated card/grid shapes.
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2";
const CARD = "rounded-md bg-panel";

interface MeterSpec {
  key: string;
  label: string;
  /** Value that sits at the meter's center. */
  center: number;
  /** Half-width: how far from center fills the bar to its edge. */
  range: number;
  format: (v: number) => string;
}

// Continuous readouts. Angles are degrees from neutral (center 0); lean is the
// head closeness ratio (center 1.0); tuck depth is head-vs-torso closeness
// (center 0, negative = retracted).
const METERS: readonly MeterSpec[] = [
  { key: "yaw", label: "Yaw — turn L/R", center: 0, range: 30, format: deg },
  { key: "pitch", label: "Pitch — look U/D", center: 0, range: 30, format: deg },
  { key: "roll", label: "Roll — tilt L/R", center: 0, range: 30, format: deg },
  { key: "torso", label: "Torso tilt", center: 0, range: 25, format: deg },
  { key: "lean", label: "Lean (in/out)", center: 1, range: 0.4, format: pct },
  // Tuck diagnostics, grouped at the end: tuck depth = head depth − shoulder depth.
  // (Head depth is the same value as Lean, shown raw for the subtraction.)
  { key: "headDepth", label: "Head depth", center: 1, range: 0.4, format: ratio },
  { key: "shoulderDepth", label: "Shoulder depth", center: 1, range: 0.4, format: ratio },
  { key: "depth", label: "Tuck depth", center: 0, range: 0.08, format: ratio },
];

const STATE_LABELS: Record<GestureName, string> = {
  lookLeft: "Look left",
  lookRight: "Look right",
  lookUp: "Look up",
  lookDown: "Look down",
  tiltLeft: "Tilt left",
  tiltRight: "Tilt right",
  tuck: "Chin tuck",
};

function deg(v: number): string {
  return `${v.toFixed(0)}°`;
}
function ratio(v: number): string {
  return v.toFixed(3);
}
function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

interface MeterEls {
  spec: MeterSpec;
  fill: HTMLDivElement;
  val: HTMLSpanElement;
}
interface StateEls {
  dot: HTMLSpanElement;
  dur: HTMLSpanElement;
}

export class IndicatorPanel {
  private meters = new Map<string, MeterEls>();
  private states = new Map<GestureName, StateEls>();

  constructor(root: HTMLElement) {
    root.replaceChildren(this.buildMeters(), this.buildStates());
  }

  private buildMeters(): HTMLElement {
    const section = el("section", "mt-5");
    section.append(
      el("h2", "mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted", "Metrics"),
    );
    const grid = el("div", GRID);
    for (const spec of METERS) {
      const row = el(
        "div",
        `${CARD} grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1.5 px-2.5 py-2`,
      );
      const label = el("span", "text-[0.72rem] text-muted", spec.label);
      const track = el(
        "div",
        "relative col-span-full h-[3px] overflow-hidden rounded-full bg-black/10 dark:bg-white/10",
      );
      track.append(el("div", "absolute inset-y-0 left-1/2 w-px bg-black/20 dark:bg-white/20"));
      const fill = el(
        "div",
        "absolute inset-y-0 rounded-full bg-accent transition-[width,left,right] duration-[60ms] ease-linear",
      ) as HTMLDivElement;
      track.append(fill);
      const val = el(
        "span",
        "text-right text-[0.8rem] tabular-nums",
        spec.format(spec.center),
      ) as HTMLSpanElement;
      // Order matters: label, value, then the full-width track — so the track
      // lands on its own row below and the value sits top-right (grid auto-flow).
      row.append(label, val, track);
      grid.append(row);
      this.meters.set(spec.key, { spec, fill, val });
    }
    section.append(grid);
    return section;
  }

  private buildStates(): HTMLElement {
    const section = el("section", "mt-5");
    section.append(
      el("h2", "mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted", "States"),
    );
    const grid = el("div", GRID);
    for (const name of Object.keys(STATE_LABELS) as GestureName[]) {
      const card = el("div", `${CARD} flex items-center gap-2 px-3 py-2 text-sm`);
      const dot = el(
        "span",
        "h-2.5 w-2.5 flex-none rounded-full bg-black/15 transition-[background-color,box-shadow] duration-[80ms] ease-linear dark:bg-white/15",
      ) as HTMLSpanElement;
      const label = el("span", "text-muted", STATE_LABELS[name]);
      const dur = el("span", "ml-auto tabular-nums text-muted", "—") as HTMLSpanElement;
      card.append(dot, label, dur);
      grid.append(card);
      this.states.set(name, { dot, dur });
    }
    section.append(grid);
    return section;
  }

  /** Update the continuous meters. depthFiltered = the value tuck thresholds. */
  setMetrics(m: Metrics, depthFiltered: number): void {
    this.meter("yaw", m.headYaw);
    this.meter("pitch", m.headPitch);
    this.meter("roll", m.headRoll);
    this.meter("torso", m.torsoTilt);
    this.meter("lean", m.headCloseness);
    this.meter("headDepth", m.headCloseness);
    this.meter("shoulderDepth", m.torsoCloseness);
    this.meter("depth", depthFiltered);
  }

  private meter(key: string, value: number): void {
    const m = this.meters.get(key);
    if (!m) return;
    m.val.textContent = m.spec.format(value);
    // Fraction of the half-track to fill, signed: + fills right, − fills left.
    const f = clamp((value - m.spec.center) / m.spec.range, -1, 1);
    const pctWidth = Math.abs(f) * 50;
    if (f >= 0) {
      m.fill.style.left = "50%";
      m.fill.style.right = "auto";
    } else {
      m.fill.style.right = "50%";
      m.fill.style.left = "auto";
    }
    m.fill.style.width = `${pctWidth}%`;
  }

  /** Update the discrete state dots + hold timers. */
  setStates(snapshot: readonly GestureState[]): void {
    for (const st of snapshot) {
      const els = this.states.get(st.name);
      if (!els) continue;
      const on = st.active;
      // Toggle mutually-exclusive utilities so there's never a cascade tie.
      els.dot.classList.toggle("bg-accent", on);
      els.dot.classList.toggle("shadow-[0_0_8px_var(--color-accent)]", on);
      els.dot.classList.toggle("bg-black/15", !on);
      els.dot.classList.toggle("dark:bg-white/15", !on);
      els.dur.textContent = on ? `${(st.heldMs / 1000).toFixed(1)}s` : "—";
      els.dur.classList.toggle("text-accent", on);
      els.dur.classList.toggle("text-muted", !on);
    }
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
