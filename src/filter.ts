// One-Euro filter: low-latency adaptive smoothing for noisy live signals.
//
// At rest it smooths hard (kills jitter); as the signal moves faster it eases
// off (kills lag). That trade is exactly what gesture detection wants — a steady
// resting baseline so a near-threshold signal doesn't flicker, without adding
// the constant latency a fixed EMA would. Reference: Casiez, Roussel & Vogel,
// "1€ Filter" (CHI 2012).

export class OneEuroFilter {
  private has = false;
  private xPrev = 0; // previous filtered value
  private dxPrev = 0; // previous filtered derivative
  private tPrev = 0; // previous timestamp (ms)

  constructor(
    /** Cutoff at rest, Hz. Lower = more smoothing (steadier, slightly laggier). */
    private minCutoff = 1.0,
    /** Speed coupling. Higher = less lag while moving fast. */
    private beta = 0.0,
    /** Cutoff for the derivative estimate, Hz. */
    private dCutoff = 1.0,
  ) {}

  /** Forget history so the next sample is taken as-is (no startup spike). */
  reset(): void {
    this.has = false;
  }

  /** Filter one sample taken at time tMs (milliseconds). */
  filter(x: number, tMs: number): number {
    if (!this.has) {
      this.has = true;
      this.xPrev = x;
      this.dxPrev = 0;
      this.tPrev = tMs;
      return x;
    }
    // Guard against duplicate/backwards timestamps (paused video, etc.).
    let dt = (tMs - this.tPrev) / 1000;
    if (dt <= 0) dt = 1 / 60;
    this.tPrev = tMs;

    const dx = (x - this.xPrev) / dt;
    const edx = lowpass(dx, this.dxPrev, alpha(this.dCutoff, dt));
    this.dxPrev = edx;

    // Faster motion → higher cutoff → less smoothing → less lag.
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const ex = lowpass(x, this.xPrev, alpha(cutoff, dt));
    this.xPrev = ex;
    return ex;
  }
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

function lowpass(x: number, prev: number, a: number): number {
  return a * x + (1 - a) * prev;
}
