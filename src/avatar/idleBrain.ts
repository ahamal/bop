// Personality for the home-screen HeroAvatar: an idle-action picker (nod /
// side glance / small tilt / posture shift), a signature ear-to-shoulder neck
// stretch, and lazy pointer awareness. Plain TS, no React — the hero's render
// loop calls update() once per frame and layers the returned offsets on top of
// its base sway/bob/breathe sinusoids.
//
// Design notes (2026-07-04): personality comes from timing, not extra
// geometry. The character is an energetic person doing neck exercises, so
// actions run in REPS (glance left then right, tilt both sides, double nod)
// with smooth bell-shaped easing — real head movement accelerates and
// decelerates; sudden moves from stillness read as twitchy, not lively
// (tried, looked alarming). Energy comes from cadence (short gaps between
// actions) and full, deliberate movements, never from speed of onset.
// Pointer awareness is a "notice" with a dead zone, not cursor tracking;
// while attending, new actions are suppressed (a running one finishes).

/** Per-frame offsets, added onto the hero's base idle motion. */
export interface IdlePose {
  pitch: number; // headPivot.rotation.x (+ = look down)
  yaw: number; // headPivot.rotation.y (+ = toward screen right)
  roll: number; // headPivot.rotation.z
  rootX: number; // whole-figure sideways shift (posture)
}

interface ActionSpec {
  weight: number;
  attack: number; // seconds to peak
  hold: number; // seconds at peak
  settle: number; // seconds back to rest
  reps: number; // rep count — exercises come in sets, not single twitches
  alternate?: boolean; // flip sign each rep (left-right-left…)
  gap?: number; // s of rest between reps
  pitch?: number;
  yaw?: number;
  roll?: number;
  rootX?: number;
  mirror?: boolean; // randomize the starting side each time it plays
}

const ACTIONS: ActionSpec[] = [
  // Double nod — a full "yes-yes", same direction both reps.
  { weight: 3, attack: 0.28, hold: 0.05, settle: 0.34, reps: 2, gap: 0.1, pitch: 0.35 },
  // Glance left then right, like checking form in a mirror.
  { weight: 2, attack: 0.38, hold: 0.35, settle: 0.38, reps: 2, alternate: true, gap: 0.15, yaw: 0.5, mirror: true },
  // Tilt both sides — a light warm-up version of the stretch.
  { weight: 2, attack: 0.45, hold: 0.3, settle: 0.45, reps: 2, alternate: true, gap: 0.15, roll: 0.42, mirror: true },
  // Posture shift: slide the whole figure a touch with a small counter-tilt of
  // the head, like re-settling in a chair.
  { weight: 2, attack: 0.35, hold: 0.9, settle: 0.4, reps: 1, rootX: 0.13, roll: -0.07, mirror: true },
];

// The signature move: a deep ear-to-shoulder stretch, one side then the other
// in a single set — slower and deeper than the tilt, on its own long cooldown.
// The mascot demoing the product.
const STRETCH: ActionSpec = {
  weight: 0, attack: 0.9, hold: 0.7, settle: 0.9, reps: 2, alternate: true, gap: 0.25,
  roll: 0.65, mirror: true,
};

// Pointer attention tuning. Distances are in canvas widths from the canvas
// center (see HeroAvatar's pointermove handler).
const ATTEND_RADIUS = 1.6; // only "notice" a cursor reasonably near the avatar
const DEAD_ZONE = 0.09; // ignore jitter around the last-noticed spot
const ATTEND_LINGER = 2.0; // s of pointer stillness before losing interest
const ATTEND_TAU = 0.3; // s time constant of the head turn

// Smooth bell-shaped motion: eases in AND out, like a real head. No overshoot,
// no snap from rest — suddenness is what read as menacing, not the speed.
function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** One rep's envelope: smooth rise, hold, smooth return, then 0. */
function envelope(t: number, attack: number, hold: number, settle: number): number {
  if (t <= 0) return 0;
  if (t < attack) return easeInOutCubic(t / attack);
  if (t < attack + hold) return 1;
  const s = (t - attack - hold) / settle;
  return s >= 1 ? 0 : 1 - easeInOutCubic(s);
}

function pickWeighted(specs: ActionSpec[]): ActionSpec {
  const total = specs.reduce((sum, s) => sum + s.weight, 0);
  let r = Math.random() * total;
  for (const s of specs) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return specs[specs.length - 1];
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export class IdleBrain {
  // Actions: a new set starts 1.2–3.2s after the last one ends; the stretch
  // preempts the regular picker when due.
  private nextActionAt = 1 + Math.random() * 2;
  private nextStretchAt = 12 + Math.random() * 8;
  private stretchSide: -1 | 1 = Math.random() < 0.5 ? -1 : 1;
  private action: ActionSpec | null = null;
  private actionStart = 0;
  private actionSign = 1;

  // Pointer attention. `pointer` is the latest cursor offset from the canvas
  // center (in canvas widths); `attended` is where the head last turned to.
  private pointer: { x: number; y: number } | null = null;
  private attended: { x: number; y: number } | null = null;
  private attendUntil = -1;
  private attendYaw = 0;
  private attendPitch = 0;
  private lastT = -1;

  /** Latest cursor offset from the canvas center, in canvas widths. */
  setPointer(x: number, y: number): void {
    this.pointer = { x, y };
  }

  clearPointer(): void {
    this.pointer = null;
  }

  update(t: number): IdlePose {
    const dt = this.lastT < 0 ? 0 : Math.min(t - this.lastT, 0.1);
    this.lastT = t;

    // --- Pointer attention -------------------------------------------------
    if (this.pointer) {
      const p = this.pointer;
      const inRadius = Math.hypot(p.x, p.y) < ATTEND_RADIUS;
      const moved =
        !this.attended ||
        Math.hypot(p.x - this.attended.x, p.y - this.attended.y) > DEAD_ZONE;
      if (inRadius && moved) {
        // A fresh spot near the avatar: notice it, and stay interested only as
        // long as the cursor keeps moving (dead-zone jitter doesn't refresh).
        this.attended = { x: p.x, y: p.y };
        this.attendUntil = t + ATTEND_LINGER;
      } else if (!inRadius) {
        this.attendUntil = Math.min(this.attendUntil, t + 0.3);
      }
    }
    const attending = this.attended !== null && t < this.attendUntil;
    const k = 1 - Math.exp(-dt / ATTEND_TAU); // lazy turn / lazy return
    const targetYaw = attending ? clamp(this.attended!.x * 0.9, -0.5, 0.5) : 0;
    const targetPitch = attending ? clamp(this.attended!.y * 0.5, -0.22, 0.22) : 0;
    this.attendYaw += (targetYaw - this.attendYaw) * k;
    this.attendPitch += (targetPitch - this.attendPitch) * k;

    // --- Idle actions ------------------------------------------------------
    if (!this.action && t >= this.nextActionAt && !attending) {
      if (t >= this.nextStretchAt) {
        this.action = STRETCH;
        this.actionSign = this.stretchSide;
        this.stretchSide = this.stretchSide === 1 ? -1 : 1;
        this.nextStretchAt = t + 16 + Math.random() * 10;
      } else {
        this.action = pickWeighted(ACTIONS);
        this.actionSign = this.action.mirror && Math.random() < 0.5 ? -1 : 1;
      }
      this.actionStart = t;
    }
    let pitch = 0;
    let yaw = 0;
    let roll = 0;
    let rootX = 0;
    if (this.action) {
      const a = this.action;
      const at = t - this.actionStart;
      // Reps: each rep is rise/hold/settle plus a short rest; alternating
      // actions flip sign each rep (left-right), others repeat (nod-nod).
      const repDur = a.attack + a.hold + a.settle + (a.gap ?? 0);
      const rep = Math.floor(at / repDur);
      if (rep >= a.reps) {
        // Set done — catch a breath, then the next one. Short rests keep the
        // energy up; the rest length (not movement speed) sets the tempo.
        this.action = null;
        this.nextActionAt = t + 1.2 + Math.random() * 2;
      } else {
        const sign = this.actionSign * (a.alternate && rep % 2 === 1 ? -1 : 1);
        const e = envelope(at - rep * repDur, a.attack, a.hold, a.settle) * sign;
        pitch = (a.pitch ?? 0) * e;
        yaw = (a.yaw ?? 0) * e;
        roll = (a.roll ?? 0) * e;
        rootX = (a.rootX ?? 0) * e;
      }
    }

    return {
      pitch: pitch + this.attendPitch,
      yaw: yaw + this.attendYaw,
      roll,
      rootX,
    };
  }
}
