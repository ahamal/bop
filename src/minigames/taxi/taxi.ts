// Traffic — microgame #3, "Dodge". A subway-surfer sprint down a three-lane
// road with two moves and only two: LEAN and JUMP. Leaning (shoulder tilt,
// same mirror handedness as Chomp) QUANTIZES into three discrete lanes with
// hysteresis — the avatar slides crisply lane to lane, it doesn't track the
// lean continuously. Tipping the head up (or down) launches a jump: it
// clears a taxi (it passes underneath) and it clears the low striped hurdle
// that sometimes spans all three lanes — the hurdle is the beat where
// jumping is the ONLY answer.
//
// The playfield IS the avatar's three.js scene (the pattern proven by Chomp):
// TaxiAvatar sprints back-to-camera into the screen, oncoming taxis rush at
// it head-on out of the horizon, and hazards cross the avatar's z-plane — so
// "got hit" is judged at that single plane, a pure function of lane + jump
// height at the crossing (Chomp's center-judging lesson). Lane dashes scroll
// toward the camera to sell the sprint.
//
// Microgame shape: survival — timeoutWins, any collision is an instant loss.
// Waves spawn with two fairness guarantees: at most two lanes blocked per
// wave (there is always an escape), and consecutive escape lanes differ by at
// most one (you're never asked to cross two lanes in one gap). Escape lanes
// prefer to MOVE so play sweeps the lean through its range instead of
// rewarding lane-camping. Level raises speed, wave rate, double-taxi odds and
// barrier odds.

import * as THREE from "three";
import type { FrameResult, TrackingSession } from "../../tracking/session.ts";
import type { Level, Microgame, MicrogameDef } from "../registry.ts";
import { playTick } from "../../audio/sfx.ts";
import { BARRIER_Y, LANE_X, ROAD_Y, TaxiAvatar } from "./avatar.ts";

// Shoulder tilt (deg) mapped to the full -1..1 lean signal — same comfortable
// range as Chomp. Lane changes commit at ±LANE_ENTER of that signal and
// release back to center inside ±LANE_EXIT (hysteresis, so the boundary
// doesn't chatter), i.e. ~5° of tilt picks a side lane.
const TILT_RANGE_DEG = 11;
const LEAN_SMOOTH_MS = 110; // EMA on the lean signal (shoulder tilt jitters)
const LANE_ENTER = 0.42;
const LANE_EXIT = 0.22;
const SLIDE_SMOOTH_MS = 90; // the avatar's snap between lane positions

// Jump: a look-up or look-down ONSET (the gesture engaging, from the
// tracking layer's own thresholds + hysteresis) launches a fixed ballistic
// arc. Airborne high enough, a taxi passes underneath and the low hurdle
// passes under your tucked feet.
const JUMP_APEX = 1.6; // world units
const JUMP_MS = 620; // full arc, launch to landing (shorter = heavier g)
const JUMP_V0 = (4 * JUMP_APEX) / JUMP_MS; // world units per ms
const JUMP_G = (8 * JUMP_APEX) / (JUMP_MS * JUMP_MS);
const JUMP_CLEAR = 0.55; // airborne above this = a taxi passes underneath
const JUMP_HURDLE = 0.55; // height required at the hurdle crossing

// World geometry. Hazards travel +z from the horizon to the avatar's plane at
// z = 0, then on past the camera.
const SPAWN_Z = -42;
const DESPAWN_Z = 10;
const PASS_Z = 2.2; // fully behind the avatar = dodged, count it
const TAXI_HALF_LEN = 1.0; // z half-window a taxi occupies at the plane
const HIT_DX = LANE_X * 0.55; // lane proximity that counts as "in its path"
const ROAD_W = LANE_X * 2 + 1.6;
// Lane-dash scroll field: DASH_COUNT dashes per line, DASH_GAP apart, wrapping.
const DASH_COUNT = 14;
const DASH_GAP = 3.4;

// Per-level tuning, indexed by level-1.
const TRAVEL_MS = [1800, 1600, 1450, 1300, 1150]; // horizon → avatar plane
const WAVE_MS = [1550, 1400, 1250, 1100, 980];
const DOUBLE_CHANCE = [0.2, 0.3, 0.45, 0.55, 0.65]; // wave blocks two lanes
const BARRIER_CHANCE = [0.16, 0.2, 0.22, 0.26, 0.3]; // wave is a jump hurdle

type LaneIdx = 0 | 1 | 2; // left, center, right
const laneX = (l: LaneIdx): number => (l - 1) * LANE_X;

interface Hazard {
  obj: THREE.Object3D;
  kind: "taxi" | "barrier";
  lane: LaneIdx; // barriers span all lanes; the field is unused for them
  z: number;
  judged: boolean; // barriers are judged once, at the crossing frame
  counted: boolean; // dodge counted once, when fully past
}

class TaxiMicrogame implements Microgame {
  private _outcome: "pending" | "win" | "lose" = "pending";
  private dodged = 0;
  private hazards: Hazard[] = [];
  private waveIn = 900; // first wave a beat in; TRAVEL_MS is the reaction time
  private escape: LaneIdx = 1; // the guaranteed-open lane of the last wave
  private lastWasBarrier = false;
  private lean = 0; // smoothed lean signal, -1..1
  private lane: LaneIdx = 1; // committed lane (hysteresis on `lean`)
  private slideX = 0; // smoothed avatar x, chasing laneX(lane)
  private jumpY = 0; // height above the road (world units)
  private jumpVy = 0; // vertical speed; 0 while grounded

  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private taxiKinds: (() => THREE.Object3D)[];
  private buildBarrier: () => THREE.Object3D;
  private dashes: THREE.Mesh[] = [];

  constructor(
    private avatar: TaxiAvatar,
    private session: TrackingSession,
    private level: Level,
  ) {
    // Shared GPU resources; builders compose them into per-hazard groups, so
    // a spawned taxi costs meshes but no new geometry/materials.
    const geo = <G extends THREE.BufferGeometry>(g: G): G => {
      this.geos.push(g);
      return g;
    };
    const mat = (color: number, roughness = 0.55): THREE.MeshStandardMaterial => {
      const m = new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness: 0.08,
        flatShading: true,
      });
      this.mats.push(m);
      return m;
    };

    // --- The road: asphalt, kerbs, and lane dashes that scroll toward the
    // camera to sell the sprint. Static scenery lives directly in roadGroup.
    const asphalt = mat(0x2b3441, 0.9);
    const kerbGrey = mat(0x64748b, 0.8);
    const dashWhite = mat(0xe2e8f0, 0.7);

    const road = new THREE.Mesh(geo(new THREE.PlaneGeometry(ROAD_W, 70)), asphalt);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, ROAD_Y, -25);
    this.avatar.roadGroup.add(road);
    const kerbGeo = geo(new THREE.BoxGeometry(0.3, 0.18, 70));
    for (const side of [-1, 1]) {
      const kerb = new THREE.Mesh(kerbGeo, kerbGrey);
      kerb.position.set(side * (ROAD_W / 2 + 0.15), ROAD_Y + 0.06, -25);
      this.avatar.roadGroup.add(kerb);
    }
    // Two dashed lines halfway between lane centers.
    const dashGeo = geo(new THREE.BoxGeometry(0.09, 0.02, 1.1));
    for (const lineX of [-LANE_X / 2, LANE_X / 2]) {
      for (let k = 0; k < DASH_COUNT; k++) {
        const dash = new THREE.Mesh(dashGeo, dashWhite);
        dash.position.set(lineX, ROAD_Y + 0.02, 4 - k * DASH_GAP);
        this.avatar.roadGroup.add(dash);
        this.dashes.push(dash);
      }
    }

    // --- Taxis: low-poly flat-shaded composites in the Chomp aesthetic —
    // yellow cab, dark window band, roof light, headlights facing you.
    const cabYellow = mat(0xfacc15, 0.4);
    const windowDark = mat(0x1e293b, 0.35);
    const tyreDark = mat(0x334155, 0.85);
    const lampWhite = mat(0xfef9c3, 0.3);
    const checkerDark = mat(0x0f172a, 0.6);

    const bodyGeo = geo(new THREE.BoxGeometry(0.95, 0.4, 1.7));
    const stripeGeo = geo(new THREE.BoxGeometry(0.97, 0.1, 1.72));
    const cabinGeo = geo(new THREE.BoxGeometry(0.8, 0.3, 0.85));
    const windowGeo = geo(new THREE.BoxGeometry(0.82, 0.16, 0.87));
    const wheelGeo = geo(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 8));
    const roofLightGeo = geo(new THREE.BoxGeometry(0.3, 0.11, 0.16));
    const lampGeo = geo(new THREE.BoxGeometry(0.14, 0.1, 0.05));

    const copWhite = mat(0xe2e8f0, 0.4);
    const copRed = mat(0xef4444, 0.3);
    const copBlue = mat(0x3b82f6, 0.3);
    // Civilian paint jobs — everyday colors, no roof furniture.
    const civvies = [mat(0x60a5fa, 0.4), mat(0xf87171, 0.4), mat(0x94a3b8, 0.4), mat(0x475569, 0.45)];

    // One car chassis, two liveries: yellow cab with a checker band + white
    // roof light, or a black-and-white with a red/blue light bar.
    const car = (paint: THREE.Material, band: THREE.Material, roof: (g: THREE.Group) => void) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, paint);
      const stripe = new THREE.Mesh(stripeGeo, band);
      const cabin = new THREE.Mesh(cabinGeo, paint);
      cabin.position.set(0, 0.35, -0.1);
      const windows = new THREE.Mesh(windowGeo, windowDark);
      windows.position.set(0, 0.28, -0.1);
      g.add(body, stripe, cabin, windows);
      roof(g);
      for (const [x, z] of [[-0.42, 0.55], [0.42, 0.55], [-0.42, -0.55], [0.42, -0.55]]) {
        const wheel = new THREE.Mesh(wheelGeo, tyreDark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, -0.22, z);
        g.add(wheel);
      }
      for (const x of [-0.3, 0.3]) {
        const lamp = new THREE.Mesh(lampGeo, lampWhite);
        lamp.position.set(x, -0.05, 0.86); // front = +z, toward the camera
        g.add(lamp);
      }
      return g;
    };
    const taxi = () =>
      car(cabYellow, checkerDark, (g) => {
        const roofLight = new THREE.Mesh(roofLightGeo, lampWhite);
        roofLight.position.set(0, 0.55, -0.1);
        g.add(roofLight);
      });
    const copCar = () =>
      car(copWhite, checkerDark, (g) => {
        // Split light bar: red left, blue right (screen handedness be damned —
        // it reads as a cop car either way).
        for (const [x, m] of [[-0.08, copRed], [0.08, copBlue]] as const) {
          const light = new THREE.Mesh(roofLightGeo, m);
          light.scale.set(0.55, 1, 1);
          light.position.set(x, 0.55, -0.1);
          g.add(light);
        }
      });
    // A civilian car: random everyday paint, same dark band, bare roof.
    const civilian = () =>
      car(civvies[Math.floor(Math.random() * civvies.length)], checkerDark, () => {});
    // Taxis headline, with civilians mixed in and the odd patrol car.
    this.taxiKinds = [taxi, taxi, civilian, civilian, copCar];

    // --- The hurdle: a LOW orange/white striped sawhorse spanning the road
    // at shin height, legs at the kerbs — you jump it.
    const conesOrange = mat(0xf97316, 0.5);
    const stripePale = mat(0xf1f5f9, 0.5);
    const SEGS = 8;
    const segLen = (ROAD_W + 0.2) / SEGS;
    const segGeo = geo(new THREE.BoxGeometry(segLen, 0.22, 0.12));
    const legGeo = geo(new THREE.BoxGeometry(0.12, BARRIER_Y - ROAD_Y, 0.12));
    this.buildBarrier = () => {
      const g = new THREE.Group();
      for (let k = 0; k < SEGS; k++) {
        const seg = new THREE.Mesh(segGeo, k % 2 ? stripePale : conesOrange);
        seg.position.x = (k - (SEGS - 1) / 2) * segLen;
        g.add(seg);
      }
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(legGeo, kerbGrey);
        leg.position.set(side * (ROAD_W / 2), (ROAD_Y - BARRIER_Y) / 2, 0);
        g.add(leg);
      }
      g.position.y = BARRIER_Y;
      return g;
    };
  }

  get outcome(): "pending" | "win" | "lose" {
    return this._outcome;
  }

  get hud(): string {
    return `${this.dodged} dodged`;
  }

  /** Release the shared GPU resources and give the playfield canvas back. */
  dispose(): void {
    for (const h of this.hazards) this.avatar.roadGroup.remove(h.obj);
    this.hazards = [];
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.session.detachAvatar();
  }

  /** Advance one frame. Called by the director; the avatar's loop draws it. */
  update(f: FrameResult, dt: number): void {
    const lv = this.level - 1;
    const vz = -SPAWN_Z / TRAVEL_MS[lv]; // world units per ms, toward camera

    // The figure never stops sprinting (even through the result beat).
    this.avatar.run(dt);

    // Inputs. Lean → lane, with hysteresis so the committed lane only flips
    // on a deliberate tilt. torsoTilt's mirrored sign matches head roll (lean
    // left = positive) and screen-left is -x, hence the negation. When the
    // shoulders aren't trackable this frame the lean just holds.
    if (f.metrics.bodyTracked) {
      const kx = 1 - Math.exp(-dt / LEAN_SMOOTH_MS);
      const target = Math.max(-1, Math.min(1, -f.metrics.torsoTilt / TILT_RANGE_DEG));
      this.lean += (target - this.lean) * kx;
    }
    if (this.lane === 1) {
      if (this.lean <= -LANE_ENTER) this.lane = 0;
      else if (this.lean >= LANE_ENTER) this.lane = 2;
    } else if (Math.abs(this.lean) <= LANE_EXIT) {
      this.lane = 1;
    }
    const ks = 1 - Math.exp(-dt / SLIDE_SMOOTH_MS);
    this.slideX += (laneX(this.lane) - this.slideX) * ks;
    this.avatar.setSlide(this.slideX);

    // Jump: tipping the head up OR down launches (the gesture ONSET events —
    // engage-edge only, so holding a look doesn't bounce); gravity brings it
    // home, and mid-air onsets are ignored. Onset beats the nod sequence
    // here: no waiting for the return-to-neutral, the jump fires the moment
    // the head commits.
    const grounded = this.jumpY === 0 && this.jumpVy === 0;
    if (
      grounded &&
      f.events.some((e) => e.name === "lookUp" || e.name === "lookDown")
    ) {
      this.jumpVy = JUMP_V0;
    }
    if (!grounded || this.jumpVy > 0) {
      this.jumpVy -= JUMP_G * dt;
      this.jumpY = Math.max(0, this.jumpY + this.jumpVy * dt);
      if (this.jumpY === 0 && this.jumpVy < 0) this.jumpVy = 0;
      this.avatar.setJump(this.jumpY);
    }

    // Road dashes scroll toward the camera (the run), slower than traffic
    // (which drives at you on top of your own speed).
    const roadV = vz * 0.45 * dt;
    for (const dash of this.dashes) {
      dash.position.z += roadV;
      if (dash.position.z > 6) dash.position.z -= DASH_COUNT * DASH_GAP;
    }

    if (this._outcome !== "pending") return;

    this.waveIn -= dt;
    if (this.waveIn <= 0) {
      this.waveIn = WAVE_MS[lv];
      this.spawnWave(lv);
    }

    // Advance hazards and judge at the avatar's z-plane.
    let dodgedThisFrame = false;
    this.hazards = this.hazards.filter((h) => {
      const prevZ = h.z;
      h.z += vz * dt;
      h.obj.position.z = h.z;

      if (h.kind === "taxi") {
        // In the collision window: hit if the avatar is in its path. Judged
        // on the VISUAL x (what you see is what's judged) — the slide snap is
        // fast, so a committed switch clears in time.
        if (
          Math.abs(h.z) < TAXI_HALF_LEN &&
          Math.abs(this.slideX - laneX(h.lane)) < HIT_DX &&
          this.jumpY < JUMP_CLEAR
        ) {
          this._outcome = "lose";
        }
      } else if (!h.judged && prevZ < 0 && h.z >= 0) {
        // Hurdle: judged once, exactly at the crossing — airborne or hit.
        h.judged = true;
        if (this.jumpY < JUMP_HURDLE) this._outcome = "lose";
      }

      if (!h.counted && h.z > PASS_Z) {
        h.counted = true;
        this.dodged += 1;
        dodgedThisFrame = true;
      }
      if (h.z > DESPAWN_Z) {
        this.avatar.roadGroup.remove(h.obj);
        return false;
      }
      return true;
    });
    // One tick per frame even when a double wave passes together.
    if (dodgedThisFrame) playTick(true);
  }

  // One wave: a jump hurdle (never two in a row), or taxis blocking one or
  // two lanes. The open lane is guaranteed and moves at most one lane from
  // the previous wave's open lane — and prefers to MOVE, so the round sweeps
  // the lean instead of letting one lane stay safe throughout.
  private spawnWave(lv: number): void {
    if (!this.lastWasBarrier && Math.random() < BARRIER_CHANCE[lv]) {
      this.lastWasBarrier = true;
      const obj = this.buildBarrier();
      obj.position.z = SPAWN_Z;
      this.avatar.roadGroup.add(obj);
      this.hazards.push({ obj, kind: "barrier", lane: 1, z: SPAWN_Z, judged: false, counted: false });
      return;
    }
    this.lastWasBarrier = false;

    const lanes: LaneIdx[] = [0, 1, 2];
    const reachable = lanes.filter((l) => Math.abs(l - this.escape) <= 1);
    const moved = reachable.filter((l) => l !== this.escape);
    const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
    this.escape = moved.length && Math.random() < 0.7 ? pick(moved) : pick(reachable);

    const blocked = lanes.filter((l) => l !== this.escape);
    const wave = Math.random() < DOUBLE_CHANCE[lv] ? blocked : [pick(blocked)];
    for (const lane of wave) {
      const obj = this.taxiKinds[Math.floor(Math.random() * this.taxiKinds.length)]();
      obj.position.set(laneX(lane), ROAD_Y + 0.42, SPAWN_Z);
      this.avatar.roadGroup.add(obj);
      this.hazards.push({ obj, kind: "taxi", lane, z: SPAWN_Z, judged: false, counted: false });
    }
  }
}

export const taxiDef: MicrogameDef = {
  id: "taxi",
  title: "Jaywalker",
  headline: "Robotaxi fleet ships 'assertive mode', pedestrians advised to hustle",
  prompt: { lead: "lean and jump to", action: "DODGE" },
  hint: "lean to switch lanes · look up to jump the hurdles",
  timeoutWins: true,
  create(canvas, session, level) {
    const avatar = session.attachAvatar(canvas, TaxiAvatar);
    return new TaxiMicrogame(avatar, session, level);
  },
};
