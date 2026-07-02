// Averages tracker samples over a short "hold still" window and hands back the
// mean pose/body as the neutral baseline.
//
// Why this matters: the tuck signal is a depth RATIO against neutral with a
// threshold around ~1%. If neutral is a single captured frame, that frame's
// own jitter (easily ~1%) becomes a permanent baseline offset that makes tuck
// either fire constantly or never. A mean over ~1.5s of frames spends that
// error budget on the real resting pose instead. Angles are near zero here, so
// a plain arithmetic mean (no wraparound handling) is fine.

import type { HeadPose } from "./pose.ts";
import type { BodyPose } from "./bodyTracker.ts";

export class Calibrator {
  private h = { yaw: 0, pitch: 0, roll: 0, distance: 0, cx: 0, cy: 0 };
  private hN = 0;
  private b = { shoulderTilt: 0, sway: 0, centerY: 0, width: 0 };
  private bN = 0;

  reset(): void {
    this.h = { yaw: 0, pitch: 0, roll: 0, distance: 0, cx: 0, cy: 0 };
    this.hN = 0;
    this.b = { shoulderTilt: 0, sway: 0, centerY: 0, width: 0 };
    this.bN = 0;
  }

  /** Number of head samples gathered so far this window. */
  get headCount(): number {
    return this.hN;
  }

  addHead(p: HeadPose): void {
    this.h.yaw += p.yaw;
    this.h.pitch += p.pitch;
    this.h.roll += p.roll;
    this.h.distance += p.distance;
    this.h.cx += p.cx;
    this.h.cy += p.cy;
    this.hN++;
  }

  addBody(b: BodyPose): void {
    this.b.shoulderTilt += b.shoulderTilt;
    this.b.sway += b.sway;
    this.b.centerY += b.centerY;
    this.b.width += b.width;
    this.bN++;
  }

  /** Running mean of head samples, or null if none yet. */
  headMean(): HeadPose | null {
    if (this.hN === 0) return null;
    const n = this.hN;
    return {
      yaw: this.h.yaw / n,
      pitch: this.h.pitch / n,
      roll: this.h.roll / n,
      distance: this.h.distance / n,
      cx: this.h.cx / n,
      cy: this.h.cy / n,
    };
  }

  /** Running mean of body samples, or null if none yet. */
  bodyMean(): BodyPose | null {
    if (this.bN === 0) return null;
    const n = this.bN;
    return {
      shoulderTilt: this.b.shoulderTilt / n,
      sway: this.b.sway / n,
      centerY: this.b.centerY / n,
      width: this.b.width / n,
      confidence: 1,
      landmarks2d: [],
    };
  }
}
