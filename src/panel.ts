// The live indicator panel: builds and updates two clearly separated groups —
//   Metrics: continuous signals, each on a center-origin meter that fills left
//            or right of zero so direction is visible at a glance.
//   States:  discrete movement states, each a lit dot + how long it's been held.
// It's data-driven (METERS + the gesture snapshot) so every row looks uniform
// and adding a signal is a one-line change, not new bespoke markup.

import type { Metrics } from "./metrics.ts";
import type { GestureState, GestureName } from "./gestures.ts";

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
  { key: "depth", label: "Tuck depth", center: 0, range: 0.08, format: ratio },
  { key: "lean", label: "Lean (in/out)", center: 1, range: 0.4, format: pct },
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
    const section = el("section", "panel");
    section.append(el("h2", "panel-title", "Metrics"));
    const grid = el("div", "meters");
    for (const spec of METERS) {
      const row = el("div", "meter");
      const label = el("span", "meter-label", spec.label);
      const track = el("div", "meter-track");
      track.append(el("div", "meter-center"));
      const fill = el("div", "meter-fill") as HTMLDivElement;
      track.append(fill);
      const val = el("span", "meter-val", spec.format(spec.center)) as HTMLSpanElement;
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
    const section = el("section", "panel");
    section.append(el("h2", "panel-title", "States"));
    const grid = el("div", "states");
    for (const name of Object.keys(STATE_LABELS) as GestureName[]) {
      const card = el("div", "state");
      const dot = el("span", "state-dot") as HTMLSpanElement;
      const label = el("span", "state-name", STATE_LABELS[name]);
      const dur = el("span", "state-dur", "—") as HTMLSpanElement;
      card.append(dot, label, dur);
      grid.append(card);
      this.states.set(name, { dot, dur });
    }
    section.append(grid);
    return section;
  }

  /** Update the continuous meters. lean = head closeness; depth = filtered. */
  setMetrics(m: Metrics, lean: number, depthFiltered: number): void {
    this.meter("yaw", m.headYaw);
    this.meter("pitch", m.headPitch);
    this.meter("roll", m.headRoll);
    this.meter("torso", m.torsoTilt);
    this.meter("depth", depthFiltered);
    this.meter("lean", lean);
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
      els.dot.classList.toggle("active", st.active);
      els.dur.textContent = st.active ? `${(st.heldMs / 1000).toFixed(1)}s` : "—";
      els.dur.classList.toggle("active", st.active);
    }
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
