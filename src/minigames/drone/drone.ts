// Drone Drop — microgame #4, "Drop". A bombing run: the quadcopter flies
// FORWARD on its own, ROLL (head tilt) banks it into turns, and OPENING YOUR
// MOUTH lets the payload go — one in the air at a time, re-armed by closing.
// Tanks are scattered across the desert, crawling slowly; a reticle on the
// ground leads AHEAD of the craft at exactly the spot the payload will land
// (it inherits the drone's forward speed), so the play is: bank until the
// reticle sweeps over a tank, and let go. Third-person chase camera, flown
// by the avatar (see DroneAvatar).
//
// The playfield IS the avatar's three.js scene (the pattern proven by Chomp):
// DroneAvatar is the tracked figure dangling from the quad; the game owns
// the flight model plus the tank/payload/ground meshes in worldGroup.
//
// Microgame shape: hit QUOTA tanks before the director's 10s clock runs out
// (timeout = loss). Level raises the quota, the flight speed (tighter
// turning radii), and the tanks' crawl.

import * as THREE from "three";
import type { FrameResult, TrackingSession } from "../../tracking/session.ts";
import type { Level, Microgame, MicrogameDef } from "../registry.ts";
import { playTick } from "../../audio/sfx.ts";
import { DROP_Y, DroneAvatar, GROUND_Y } from "./avatar.ts";

// Head roll (deg) for a full-rate turn — comfortable, not a stretch.
const ROLL_RANGE_DEG = 12;
const ROLL_SMOOTH_MS = 130;
const TURN_RATE = 0.0018; // rad/ms at full bank

// Pitch throttle: chin DOWN speeds the run up, chin UP eases it off — the
// dragon game's idea, but gentle (that one runs to ×2 dive; here chin-down
// tops out at ×1.4 and chin-up at ×0.7, so it's a trim, not a lurch).
const PITCH_RANGE_DEG = 10; // head tilt for full throttle either way
const PITCH_SMOOTH_MS = 110;
const DIVE_GAIN = 0.4; // chin down → up to ×1.4 speed
const BRAKE_GAIN = 0.3; // chin up → down to ×0.7 speed

// Mouth: open past DROP to release, close under REARM before the next one.
const MOUTH_DROP = 0.35;
const MOUTH_REARM = 0.18;
const MOUTH_SMOOTH_MS = 70;

// Payload ballistics: released under the figure, inheriting the craft's
// velocity, ~430ms to the tank deck — so the impact point leads the craft by
// speed × fall time, which is exactly where the reticle rides.
const HATCH_Y = -1.5; // tank deck height, where the hit is judged
const FALL_MS = 430;
const PAYLOAD_G = (2 * (DROP_Y - HATCH_Y)) / (FALL_MS * FALL_MS);
const HIT_R = 1.5; // payload-to-tank-center distance that counts
const FLASH_MS = 420;

// The field: tanks scattered in a forward-biased ring around the start.
const TANK_COUNT = 10;
const SCATTER_MIN = 12;
const SCATTER_MAX = 55;
const TANK_SPACING = 9;
const TANK_WANDER = 0.00035; // slow random heading drift, rad/ms

// Per-level tuning, indexed by level-1.
const SPEED = [0.009, 0.0095, 0.01, 0.0105, 0.011]; // world units per ms
const QUOTA = [2, 3, 3, 4, 5];
const TANK_V = [0.0008, 0.001, 0.0012, 0.0014, 0.0016]; // slow crawl

interface Tank {
  obj: THREE.Group;
  heading: number;
  hit: boolean;
  /** The surrender flag (mounted hidden on the turret) and its rise clock. */
  flag: THREE.Group;
  flagMs: number;
}

interface Flash {
  obj: THREE.Mesh;
  ms: number;
}

// Explosion: a burst of flat-shaded chunks that fly out, arc under gravity
// and shrink away — no material mutation, so the chunk materials stay shared.
interface Chunk {
  obj: THREE.Mesh;
  v: THREE.Vector3;
  ms: number;
  size: number; // base scale; the life fraction multiplies it away
}
// Scratch objects for the per-frame flag wave (no per-frame allocation).
const WAVE_AXIS = new THREE.Vector3();
const WAVE_Q = new THREE.Quaternion();
const TANK_INV_Q = new THREE.Quaternion();

const EXPLODE_MS = 750;
const EXPLODE_CHUNKS = 14;
const CHUNK_G = 0.000012;
const FLAG_RISE_MS = 450;

// After the quota-meeting hit, the win is EARNED but not yet REPORTED — the
// outcome stays "pending" while the explosion and the white flag play out,
// then flips. (The director cuts to the result card the frame the outcome
// changes, so reporting immediately would cut the scene off.)
const WIN_OUTRO_MS = 1800;
// This game's clock (declared as durationMs on the def): a base run plus a
// fixed slice of time for every tank the level's quota demands, so a bigger
// quota buys proportionally more time. The win outro must resolve before it
// or a hit in the final second would time out as a loss.
const CLOCK_BASE_MS = 22_000;
const CLOCK_PER_TANK_MS = 7_000;
const clockMs = (level: Level): number => CLOCK_BASE_MS + CLOCK_PER_TANK_MS * QUOTA[level - 1];
const OUTRO_MARGIN_MS = 250;

class DroneMicrogame implements Microgame {
  private _outcome: "pending" | "win" | "lose" = "pending";
  private hits = 0;
  private elapsed = 0; // our copy of the director's clock, for the outro cap
  private winIn = -1; // ms left of the win outro; <0 = not earned yet
  private x = 0;
  private z = 0;
  private heading = 0; // 0 = -z; positive = screen-left turn
  private rollNorm = 0; // smoothed roll input, -1..1
  private pitchNorm = 0; // smoothed throttle input, -1..1 (chin down = +)
  private mouth = 0;
  // Starts UNARMED: the mouth must be seen closed once before the first drop,
  // so a mouth already open at the whistle (talking, mid-"open wide" from the
  // prompt) can't fire a payload at t=0.
  private armed = false;

  private tanks: Tank[] = [];
  private payload: THREE.Group;
  private payloadV = new THREE.Vector3();
  private falling = false;
  private reticle: THREE.Mesh;
  private flashes: Flash[] = [];
  private chunks: Chunk[] = [];
  private t = 0; // for the flag wave

  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private hitMat: THREE.MeshBasicMaterial;
  private missMat: THREE.MeshBasicMaterial;
  private flashGeo: THREE.CircleGeometry;
  private chunkGeo: THREE.IcosahedronGeometry;
  private chunkMats: THREE.Material[];

  constructor(
    private avatar: DroneAvatar,
    private session: TrackingSession,
    private level: Level,
  ) {
    // Shared GPU resources, disposed with the game.
    const geo = <G extends THREE.BufferGeometry>(g: G): G => {
      this.geos.push(g);
      return g;
    };
    const mat = (color: number, roughness = 0.6): THREE.MeshStandardMaterial => {
      const m = new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness: 0.08,
        flatShading: true,
      });
      this.mats.push(m);
      return m;
    };

    // --- The field: one big sandy plane (the whole 10s run fits on it) with
    // darker patches scattered for motion/depth cues.
    const sand = mat(0x9c8a63, 0.95);
    const patchMat = mat(0x82724f, 0.95);
    const ground = new THREE.Mesh(geo(new THREE.PlaneGeometry(360, 360)), sand);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, GROUND_Y, -60);
    this.avatar.worldGroup.add(ground);
    const patchGeo = geo(new THREE.CircleGeometry(1, 8));
    for (let i = 0; i < 40; i++) {
      const patch = new THREE.Mesh(patchGeo, patchMat);
      patch.rotation.x = -Math.PI / 2;
      const a = Math.random() * Math.PI * 2;
      const r = 8 + Math.random() * 90;
      patch.position.set(Math.cos(a) * r, GROUND_Y + 0.01, -30 + Math.sin(a) * r);
      patch.scale.setScalar(0.8 + Math.random() * 1.8);
      this.avatar.worldGroup.add(patch);
    }

    // --- The tanks: olive low-poly composites (shared geometry, one group
    // per tank), hatch as a bright disc so the target reads from above.
    const olive = mat(0x5b6b3a, 0.7);
    const oliveDark = mat(0x47542e, 0.8);
    const trackDark = mat(0x2f3542, 0.85);
    const hatchOrange = mat(0xf97316, 0.4);
    const hullGeo = geo(new THREE.BoxGeometry(1.5, 0.5, 2.4));
    const turretGeo = geo(new THREE.CylinderGeometry(0.55, 0.65, 0.4, 8));
    const barrelGeo = geo(new THREE.CylinderGeometry(0.07, 0.09, 1.6, 6));
    const hatchGeo = geo(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 10));
    const trackGeo = geo(new THREE.BoxGeometry(0.4, 0.45, 2.6));
    // Explosion chunks: fire orange, ember red, smoke grey.
    this.chunkGeo = geo(new THREE.IcosahedronGeometry(0.16, 0));
    this.chunkMats = [mat(0xf97316, 0.4), mat(0xef4444, 0.45), mat(0x475569, 0.8)];

    // Surrender flag: grey pole + white cloth, mounted on the turret, hidden
    // until the tank is hit (it rises over FLAG_RISE_MS and waves).
    const poleGrey = mat(0x94a3b8, 0.5);
    const flagWhite = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });
    this.mats.push(flagWhite);
    const poleGeo = geo(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 5));
    const clothGeo = geo(new THREE.PlaneGeometry(0.7, 0.42));
    const buildFlag = (): THREE.Group => {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, poleGrey);
      pole.position.y = 0.75;
      const cloth = new THREE.Mesh(clothGeo, flagWhite);
      cloth.position.set(0.36, 1.28, 0);
      g.add(pole, cloth);
      g.position.set(0, 1.1, -0.1); // on the turret
      g.scale.setScalar(0.001); // raised on hit
      g.visible = false;
      return g;
    };

    const buildTank = (): THREE.Group => {
      const g = new THREE.Group();
      const hull = new THREE.Mesh(hullGeo, olive);
      hull.position.y = 0.45;
      const turret = new THREE.Mesh(turretGeo, oliveDark);
      turret.position.set(0, 0.9, -0.1);
      const barrel = new THREE.Mesh(barrelGeo, oliveDark);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.95, 1.0); // forward = local +z
      const hatch = new THREE.Mesh(hatchGeo, hatchOrange);
      hatch.position.set(0, 1.12, -0.1);
      g.add(hull, turret, barrel, hatch);
      for (const sx of [-1, 1]) {
        const track = new THREE.Mesh(trackGeo, trackDark);
        track.position.set(sx * 0.75, 0.22, 0);
        g.add(track);
      }
      g.position.y = GROUND_Y;
      return g;
    };

    // Scatter: forward-biased ring around the start, minimum spacing so two
    // tanks never read as one blob (rejection sampling, bounded tries).
    const placed: [number, number][] = [];
    for (let i = 0; i < TANK_COUNT; i++) {
      let px = 0;
      let pz = 0;
      for (let tries = 0; tries < 40; tries++) {
        // Angle biased toward the initial flight direction (-z): a full
        // circle, but 2/3 of draws squeeze into the forward half.
        const fwd = Math.random() < 0.67;
        const a = (fwd ? Math.PI : Math.PI * 2) * (Math.random() - 0.5);
        const r = SCATTER_MIN + Math.random() * (SCATTER_MAX - SCATTER_MIN);
        px = Math.sin(a) * r;
        pz = -Math.cos(a) * r;
        if (placed.every(([qx, qz]) => Math.hypot(px - qx, pz - qz) >= TANK_SPACING)) break;
      }
      placed.push([px, pz]);
      const obj = buildTank();
      obj.position.x = px;
      obj.position.z = pz;
      const heading = Math.random() * Math.PI * 2;
      obj.rotation.y = heading;
      const flag = buildFlag();
      obj.add(flag);
      this.avatar.worldGroup.add(obj);
      this.tanks.push({ obj, heading, hit: false, flag, flagMs: 0 });
    }

    // --- The payload: a stubby grey bomb with an orange band and fins.
    const bombGrey = mat(0x64748b, 0.5);
    const bandOrange = mat(0xf97316, 0.45);
    this.payload = new THREE.Group();
    const body = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.14, 0.3, 3, 8)), bombGrey);
    const band = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.145, 0.145, 0.08, 8)), bandOrange);
    const finGeo = geo(new THREE.BoxGeometry(0.02, 0.16, 0.12));
    this.payload.add(body, band);
    for (const a of [0, Math.PI / 2]) {
      const fin = new THREE.Mesh(finGeo, bombGrey);
      fin.rotation.y = a;
      fin.position.y = 0.24;
      this.payload.add(fin);
    }
    this.payload.visible = false;
    this.avatar.worldGroup.add(this.payload);

    // --- The reticle: a dark ring riding AHEAD of the craft at the true
    // impact point (release now = land here).
    this.hitMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.9,
    });
    this.missMat = new THREE.MeshBasicMaterial({
      color: 0x1f2937,
      transparent: true,
      opacity: 0.5,
    });
    this.mats.push(this.hitMat, this.missMat);
    this.flashGeo = geo(new THREE.CircleGeometry(0.5, 12));
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.45,
    });
    this.mats.push(reticleMat);
    this.reticle = new THREE.Mesh(geo(new THREE.RingGeometry(0.34, 0.5, 16)), reticleMat);
    this.reticle.rotation.x = -Math.PI / 2;
    this.avatar.worldGroup.add(this.reticle);
  }

  get outcome(): "pending" | "win" | "lose" {
    return this._outcome;
  }

  get hud(): string {
    return `${this.hits} / ${QUOTA[this.level - 1]}`;
  }

  /** Release the shared GPU resources and give the playfield canvas back. */
  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.session.detachAvatar();
  }

  /** Advance one frame. Called by the director; the avatar's loop draws it. */
  update(f: FrameResult, dt: number): void {
    const lv = this.level - 1;
    this.elapsed += dt;
    this.avatar.animate(dt);

    // Earned win: let the explosion/flag scene finish, then report it —
    // capped so it always lands before the director's clock would call a
    // timeout loss on a game that was actually won.
    if (this.winIn >= 0 && this._outcome === "pending") {
      this.winIn -= dt;
      const clockLeft = clockMs(this.level) - this.elapsed - OUTRO_MARGIN_MS;
      if (this.winIn <= 0 || clockLeft <= 0) this._outcome = "win";
    }

    // Inputs: roll banks the craft, turning the heading. Tilt left (mirrored
    // roll positive) turns screen-left, which is heading-positive. Mouth is
    // the bombardier.
    const k = 1 - Math.exp(-dt / ROLL_SMOOTH_MS);
    const rollT = Math.max(-1, Math.min(1, f.metrics.headRoll / ROLL_RANGE_DEG));
    this.rollNorm += (rollT - this.rollNorm) * k;
    // Sign matches the dragon (Keep): headPitch reads positive on chin-UP in
    // practice (despite the "chin-down positive" doc), so negate it. Then
    // pitchNorm > 0 = head FORWARD (chin down) = faster AND nose down (dive);
    // pitchNorm < 0 = head BACK = slower AND nose up. Speed and the nose-tilt
    // visual share this one sign, so they always agree.
    const kp = 1 - Math.exp(-dt / PITCH_SMOOTH_MS);
    const pitchT = Math.max(-1, Math.min(1, -f.metrics.headPitch / PITCH_RANGE_DEG));
    this.pitchNorm += (pitchT - this.pitchNorm) * kp;
    if (f.expression) {
      const km = 1 - Math.exp(-dt / MOUTH_SMOOTH_MS);
      this.mouth += (f.expression.mouthOpen - this.mouth) * km;
    }

    // Fly: forward along the heading, at a speed the pitch throttle trims —
    // chin down runs to ×1.4, chin up eases to ×0.7.
    this.heading += this.rollNorm * TURN_RATE * dt;
    const dx = -Math.sin(this.heading);
    const dz = -Math.cos(this.heading);
    const throttle = 1 + this.pitchNorm * (this.pitchNorm > 0 ? DIVE_GAIN : BRAKE_GAIN);
    const v = SPEED[lv] * throttle;
    this.x += dx * v * dt;
    this.z += dz * v * dt;
    // Bank sign: from the chase cam (looking down -z with the craft),
    // positive rotation.z dips the left wing — matching a left turn. The
    // throttle also tips the nose (down when diving) for a sense of speed.
    // Nose tilt uses the opposite sign from the throttle: head back tips the
    // craft back (nose up), head forward tips it down — while speed stays as is.
    this.avatar.setCraft(this.x, this.z, this.heading, this.rollNorm, -this.pitchNorm);

    // The reticle leads by exactly the payload's inherited travel.
    const lead = v * FALL_MS;
    this.reticle.position.set(this.x + dx * lead, GROUND_Y + 0.02, this.z + dz * lead);

    this.t += dt;
    // Explosion chunks fly, arc and shrink; surrendered flags rise and wave.
    // Both keep going past the outcome so the win scene finishes itself.
    this.chunks = this.chunks.filter((c) => {
      c.ms -= dt;
      c.v.y -= CHUNK_G * dt;
      c.obj.position.addScaledVector(c.v, dt);
      c.obj.scale.setScalar(Math.max(0.001, (c.ms / EXPLODE_MS) * c.size));
      c.obj.rotation.x += 0.004 * dt;
      c.obj.rotation.z += 0.003 * dt;
      if (c.ms <= 0) this.avatar.worldGroup.remove(c.obj);
      return c.ms > 0;
    });
    for (const t of this.tanks) {
      if (!t.hit) continue;
      t.flagMs += dt;
      const rise = Math.min(1, t.flagMs / FLAG_RISE_MS);
      t.flag.scale.setScalar(Math.max(0.001, rise));
      // The pole rocks left-right ON SCREEN — someone waving it at you. The
      // wave is a roll around the CAMERA's view axis (a screen-plane tilt),
      // expressed in the tank's local frame by undoing the tank's own
      // rotation; a local-axis rock would read as nodding on tanks that
      // happen to face across the view.
      const dx = -Math.sin(this.heading);
      const dz = -Math.cos(this.heading);
      WAVE_AXIS.set(dx, 0, dz);
      WAVE_Q.setFromAxisAngle(WAVE_AXIS, 0.45 * Math.sin(this.t * 0.011));
      t.flag.quaternion.copy(TANK_INV_Q.copy(t.obj.quaternion).invert()).multiply(WAVE_Q);
    }

    // Fade hit/miss flashes regardless of outcome so the last one finishes.
    this.flashes = this.flashes.filter((fl) => {
      fl.ms -= dt;
      const p = Math.max(0, fl.ms / FLASH_MS);
      fl.obj.scale.setScalar(1 + (1 - p) * 1.6);
      (fl.obj.material as THREE.MeshBasicMaterial).opacity = p * 0.9;
      if (fl.ms <= 0) this.avatar.worldGroup.remove(fl.obj);
      return fl.ms > 0;
    });

    if (this._outcome !== "pending") return;

    // Tanks crawl and wander — slow enough to lead, alive enough to matter.
    for (const t of this.tanks) {
      if (t.hit) continue;
      t.heading += (Math.random() - 0.5) * TANK_WANDER * dt;
      t.obj.rotation.y = t.heading;
      t.obj.position.x += Math.sin(t.heading) * TANK_V[lv] * dt;
      t.obj.position.z += Math.cos(t.heading) * TANK_V[lv] * dt;
    }

    // Drop: open past the threshold releases (one in the air at a time);
    // closing re-arms. The payload carries the craft's velocity.
    if (this.armed && !this.falling && this.mouth >= MOUTH_DROP) {
      this.armed = false;
      this.falling = true;
      this.payload.visible = true;
      this.payload.position.set(this.x, DROP_Y, this.z);
      this.payloadV.set(dx * v, 0, dz * v);
    }
    if (!this.armed && this.mouth <= MOUTH_REARM) this.armed = true;

    if (this.falling) {
      this.payloadV.y -= PAYLOAD_G * dt;
      this.payload.position.x += this.payloadV.x * dt;
      this.payload.position.y += this.payloadV.y * dt;
      this.payload.position.z += this.payloadV.z * dt;
      this.payload.rotation.z += 0.002 * dt;
      // Judged at the tank deck: near any live tank = hit; the sand scorches
      // otherwise.
      if (this.payload.position.y <= HATCH_Y) {
        const px = this.payload.position.x;
        const pz = this.payload.position.z;
        const target = this.tanks.find(
          (t) => !t.hit && Math.hypot(px - t.obj.position.x, pz - t.obj.position.z) <= HIT_R,
        );
        if (target) {
          this.resolveHit(target, px, pz);
        } else if (this.payload.position.y <= GROUND_Y + 0.05) {
          this.falling = false;
          this.payload.visible = false;
          this.spawnFlash(px, pz, this.missMat);
        }
      }
    }
  }

  private resolveHit(t: Tank, x: number, z: number): void {
    this.falling = false;
    this.payload.visible = false;
    t.hit = true;
    // A dead tank slumps, blows a burst of chunks, then runs up the white
    // flag (the rise/wave animates in update).
    t.obj.rotation.z = 0.12;
    t.obj.position.y = GROUND_Y - 0.12;
    t.flag.visible = true;
    for (let i = 0; i < EXPLODE_CHUNKS; i++) {
      const chunk = new THREE.Mesh(
        this.chunkGeo,
        this.chunkMats[i % this.chunkMats.length],
      );
      chunk.position.set(x, HATCH_Y + 0.2, z);
      const a = Math.random() * Math.PI * 2;
      const out = 0.002 + Math.random() * 0.004;
      this.chunks.push({
        obj: chunk,
        v: new THREE.Vector3(
          Math.cos(a) * out,
          0.005 + Math.random() * 0.005, // up and out
          Math.sin(a) * out,
        ),
        ms: EXPLODE_MS * (0.6 + Math.random() * 0.4),
        size: 0.6 + Math.random() * 0.8,
      });
      this.avatar.worldGroup.add(chunk);
    }
    this.hits += 1;
    playTick(true);
    this.spawnFlash(x, z, this.hitMat);
    // Quota met = the win is earned; the outro timer reports it (see update).
    if (this.hits >= QUOTA[this.level - 1]) this.winIn = WIN_OUTRO_MS;
  }

  private spawnFlash(x: number, z: number, m: THREE.MeshBasicMaterial): void {
    const flash = new THREE.Mesh(this.flashGeo, m);
    flash.rotation.x = -Math.PI / 2;
    flash.position.set(x, GROUND_Y + 0.03, z);
    this.avatar.worldGroup.add(flash);
    this.flashes.push({ obj: flash, ms: FLASH_MS });
  }
}

export const droneDef: MicrogameDef = {
  id: "drone",
  title: "Special Delivery",
  prompt: { lead: "steer in and", action: "DROP" },
  hint: "tilt to steer · chin down to speed up, up to slow · open your mouth to drop a bomb on a tank",
  durationMs: (level) => clockMs(level),
  create(canvas, session, level) {
    const avatar = session.attachAvatar(canvas, DroneAvatar);
    return new DroneMicrogame(avatar, session, level);
  },
};
