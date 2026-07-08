// Final Boss: The Keep — a boss-slot candidate (the director draws one boss
// per round; docs/arcade-plan.md). The player IS the dragon (DragonAvatar):
// it flies forward on its own, HEAD TILT banks it into turns (the Drone
// steering verbatim — the dragon rolls into the turn with you). Embers are
// MAGNETIC: pass within MAGNET_R and they're drawn to the dragon, swallowed
// on contact, up to MAX_AMMO stocked — each one becomes a glowing orb
// circling the chest (the ring widens with the count) and the belly lights.
// OPENING YOUR MOUTH breathes them out as fireballs straight ahead — HOLD
// it open and the whole clutch leaves as a rapid burst (RAPID_FIRE_MS
// apart). Land hits on the
// stone keep in the middle to burn it down. The keep fights back: it lobs
// flaming boulders at a point LEADING the dragon's flight — flying straight
// is what gets you hit; turning is the dodge. A dodged boulder cools where
// it fell and lights into a fresh ember (ROCK_TO_ORB_MS): the keep's own
// ammunition feeds the dragon. Boss rules: gates the level, replayed on a
// loss (which costs a life).
//
// Movement channels: banked turns from head roll AND torso lean (either
// works; together they add — whole-body engagement, both directions forced
// by ember placement and dodges), pitch as the throttle (chin-down dive /
// chin-up brake), and mouth open/close cycles for every shot.
//
// Judging: a boulder is judged at ONE frame — impact — as a pure function
// of the two positions (inside BLAST_R = hit); its whole flight is the
// visible grace: the target ring appears at launch and a disc fills it over
// exactly the flight time. The mortar leads the dragon with randomized
// scatter, so a steady turn beats it and camping a straight line doesn't.
// Eating is pure proximity (fly through the ember), firing uses the
// open/rearm pattern and starts unarmed — a swallow also un-arms, so a
// mouth already hanging open can't fire the instant an orb is picked up.
//
// Winnable by construction: bossClockMs budgets, per point of keep HP, one
// full damage cycle — cruise to an ember (~8 world units), swallow, come
// around, and a fireball flight — plus one dodge detour, and adds TWO spare
// cycles for missed shots. Dodge feasibility: a full-rate turn over one
// boulder flight sweeps ≥3 rad of heading — lateral escape far beyond
// BLAST_R, so every telegraph is beatable from any state.

import * as THREE from "three";
import type { FrameResult, TrackingSession } from "../../tracking/session.ts";
import type { Level, Microgame, MicrogameDef } from "../registry.ts";
import { playTick } from "../../audio/sfx.ts";
import { ResourceBag } from "../resources.ts";
import { DragonAvatar, FLY_Y, GROUND_Y, MAX_AMMO } from "./avatar.ts";

// --- The schedule, per level [level-1] — the whole difficulty curve. ---
const KEEP_HP = [3, 3, 4, 4, 5]; // fireball hits to win
const SHIELD = [3, 3, 3, 2, 2]; // boulder hits you can take; 0 = KO
const ATTACK_EVERY_MS = [3400, 3000, 2700, 2400, 2100];
const BOULDER_FLIGHT_MS = [1800, 1700, 1600, 1500, 1400]; // telegraph = flight
const BLAST_R = [2.0, 2.2, 2.4, 2.6, 2.8];
const SPEED = [0.011, 0.0115, 0.012, 0.0125, 0.013]; // world units per ms
// Damage-cycle budget for the clock (see the header's winnability note) —
// sized to the island: an ember run averages ~15 world units each way.
const CYCLE_MS = [7000, 6800, 6600, 6400, 6200];
const FIRST_ATTACK_SCALE = 1.6; // level-1 mercy: the opening boulder waits

// --- Fight beats (ms). ---
const INTRO_MS = 1200; // fly in; the keep holds fire
const SPARE_CYCLES = 2; // missed-shot allowance in the clock
const WIN_OUTRO_MS = 3600; // wheel around + watch the keep come down, unhurried
const CRASH_MS = 2000; // the shot-down spiral before the loss reports
const FLASH_MS = 380; // red vignette on a player hit
const OUTRO_MARGIN_MS = 250;

// --- Input shaping. ---
const STEER_DEADBAND = 0.12; // 0% zone around center (fraction of full input)
const ROLL_RANGE_DEG = 16; // head tilt for a full-rate turn
const TORSO_RANGE_DEG = 13; // shoulder lean for a full-rate turn — the two add
const ROLL_SMOOTH_MS = 130;
const TURN_RATE = 0.0022; // rad/ms at full bank (scaled up with the speed)
// Pitch is the throttle: look down to dive (faster), up to brake. Chin-down
// is positive and NOT mirrored (see the authoring guide).
const PITCH_RANGE_DEG = 8; // small chin moves reach full dive/brake
const PITCH_SMOOTH_MS = 90; // snappy — the posture answers the head
const DIVE_GAIN = 1.0; // chin down: up to ×2 speed at full dive
const BRAKE_GAIN = 0.5; // chin up: down to ×0.5 at full pull-up
const DIVE_DROP = 0.6; // cosmetic altitude dip at full dive (judging stays 2D)
const MOUTH_FIRE = 0.4; // open past this while loaded = breathe fire
const MOUTH_REARM = 0.18;
const MOUTH_SMOOTH_MS = 70;

// --- The arena: a big island, a ring of open water, then the edge of the
// world — flight is clamped at BOUND_R, so the water is explorable but what
// lies beyond it isn't (the visibly darker deep marks the boundary).
const LAND_R = 55; // the island's shoreline
const BOUND_R = 80; // flight is clamped inside this ring (mid-water)
const KEEP_R = 3.0; // curtain-wall radius; also the fireball's hit radius
const KEEP_PUSH_R = KEEP_R + 1.1; // flight is pushed outside the stonework
const KEEP_TOP_Y = GROUND_Y + 6.7; // the keep's open top, where boulders launch
const EMBER_COUNT = 9; // always this many floating, respawn after a swallow
const ROCK_ORB_COUNT = 3; // extra ember slots fed by landed boulders (one per mortar)
const ROCK_TO_ORB_MS = 1000; // a landed boulder cools into an ember after this
const EMBER_MIN_R = 7;
const EMBER_MAX_R = 26;
const EMBER_SPACING = 5;
const EAT_R = 1.8; // ember pickup distance (xz)
const MAGNET_R = 6; // embers inside this get pulled toward the dragon…
const MAGNET_V = 0.012; // …at up to this speed (per ms), while there's room
const EMBER_RESPAWN_MS = 1500;
const FIREBALL_V = 0.022; // world units per ms, ~2× flight speed
const RAPID_FIRE_MS = 320; // held-open burst: one orb leaves per this interval
const HIT_BURST_MS = 450; // impact flash swelling off the stonework
const HIT_SHAKE_MS = 350; // castle rattle after a hit
const MORTAR_POOL = 3; // max boulders in flight (attack cadence caps at 2)

function attackEvery(level: Level): number {
  return ATTACK_EVERY_MS[level - 1];
}

/** The clock, derived from the schedule (see the header's winnability note). */
export function bossClockMs(level: Level): number {
  const i = level - 1;
  const total =
    INTRO_MS + (KEEP_HP[i] + SPARE_CYCLES) * CYCLE_MS[i] + WIN_OUTRO_MS + 600;
  return Math.ceil(total / 500) * 500; // ≈40.5s at level 1, ≈49s at level 5
}

interface Ember {
  obj: THREE.Group;
  alive: boolean;
  respawnIn: number;
  bobPhase: number;
  /** Rock-born embers only come back when another boulder lands. */
  rock: boolean;
}

interface Mortar {
  active: boolean;
  boulder: THREE.Group; // flaming rock: dark core + fire shell
  ring: THREE.Mesh; // the target marker, visible for exactly the flight
  disc: THREE.Mesh; // fills the ring over the flight — the visible timer
  tx: number;
  tz: number;
  flightMs: number;
  ms: number; // elapsed flight
  restMs: number; // landed rock cooling on the ground before it turns ember
  dust: THREE.Mesh; // impact puff, reused per mortar
  dustMs: number;
}

type Mode = "intro" | "fight" | "burnout" | "crash";

class KeepGame implements Microgame {
  private _outcome: "pending" | "win" | "lose" = "pending";
  private t = 0;
  private mode: Mode = "intro";
  private modeAt = 0;
  private readonly lvl: number; // level-1, the schedule index
  private readonly clockMs: number;

  private hp: number;
  private shield: number;

  // Flight model (the game owns it; the avatar just draws it).
  private x = 14;
  private z = 0;
  private heading = 0; // 0 = -z; positive = screen-left turn
  private steerNorm = 0; // smoothed bank input (head tilt + torso lean), -1..1
  private leanNorm = 0; // torso contribution — held through tracking dropouts
  private pitchNorm = 0; // smoothed dive/brake input, -1..1

  // Mouth fires; eating is automatic. Ammo is the stocked-ember count.
  private mouth = 0;
  private armed = false; // must close once before firing (starts unarmed)
  private ammo = 0;

  private nextAttackAt: number;
  private embers: Ember[] = [];
  private mortars: Mortar[] = [];

  // Fireballs: a pool sized to the clutch, so a full rapid burst can be in
  // the air at once.
  private fireballs: { mesh: THREE.Mesh; active: boolean; dx: number; dz: number }[] = [];
  private nextShotAt = 0;
  // Hit feedback: swelling bursts at the impact point + a castle rattle.
  private bursts: { mesh: THREE.Mesh; ms: number }[] = [];
  private shakeAt = NaN;

  // Keep presentation.
  private keepGroup = new THREE.Group();
  private windowMat: THREE.MeshBasicMaterial; // glows when the shot lines up
  private flames: THREE.Mesh[] = []; // one revealed per hit; all swell on the win
  private armGroup = new THREE.Group(); // the catapult arm, snapped on launch
  private armSnapMs = NaN;

  // Presentation timers.
  private flashAt = NaN;

  private bag = new ResourceBag();

  // DOM overlays.
  private pill: HTMLDivElement;
  private flash: HTMLDivElement;
  private hpBlocks: HTMLSpanElement[] = [];
  private hearts: HTMLSpanElement[] = [];

  constructor(
    private avatar: DragonAvatar,
    private session: TrackingSession,
    level: Level,
    host: HTMLElement,
  ) {
    this.lvl = level - 1;
    this.clockMs = bossClockMs(level);
    this.hp = KEEP_HP[this.lvl];
    this.shield = SHIELD[this.lvl];
    this.nextAttackAt =
      INTRO_MS + attackEvery(level) * (this.lvl === 0 ? FIRST_ATTACK_SCALE : 1);
    const { geo, mat } = this.bag;
    const world = this.avatar.worldGroup;

    // --- The field: an island meadow with a sand shoreline, open water
    // around it, and visibly darker deep past the flight boundary. Darker
    // grass patches give the motion cues (the Drone lesson — a bare plane
    // gives no sense of speed).
    const water = new THREE.Mesh(geo(new THREE.PlaneGeometry(500, 500)), mat(0x0c4a6e, 0.9));
    water.rotation.x = -Math.PI / 2;
    water.position.y = GROUND_Y - 0.02;
    const deep = new THREE.Mesh(geo(new THREE.RingGeometry(BOUND_R, 240, 48)), mat(0x082f49, 0.95));
    deep.rotation.x = -Math.PI / 2;
    deep.position.y = GROUND_Y - 0.01;
    const land = new THREE.Mesh(geo(new THREE.CircleGeometry(LAND_R, 48)), mat(0x2f5233, 0.95));
    land.rotation.x = -Math.PI / 2;
    land.position.y = GROUND_Y + 0.01;
    const shore = new THREE.Mesh(geo(new THREE.RingGeometry(LAND_R, LAND_R + 2, 48)), mat(0xb8a76f, 0.95));
    shore.rotation.x = -Math.PI / 2;
    shore.position.y = GROUND_Y + 0.005;
    world.add(water, deep, land, shore);
    const patchGeo = geo(new THREE.CircleGeometry(1, 8));
    const patchMat = mat(0x24422a, 0.95);
    for (let i = 0; i < 60; i++) {
      const patch = new THREE.Mesh(patchGeo, patchMat);
      patch.rotation.x = -Math.PI / 2;
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * (LAND_R - 6);
      patch.position.set(Math.cos(a) * r, GROUND_Y + 0.02, Math.sin(a) * r);
      patch.scale.setScalar(0.9 + Math.random() * 2.4);
      world.add(patch);
    }

    // --- The castle: a rock plinth carrying a crenellated curtain wall
    // with four turreted corner towers and a gatehouse, and the tall central
    // keep rising out of the middle with the catapult on its open top. The
    // fireball judges at KEEP_R — the curtain wall — so hits visibly land on
    // stonework. The keep's windows share one glow material: they light
    // amber when a shot fired now would connect (the aim aid).
    this.keepGroup.position.set(0, GROUND_Y, 0);
    world.add(this.keepGroup);
    const stone = mat(0x78716c, 0.85);
    const stoneDark = mat(0x57534e, 0.9);
    const roofMat = mat(0x7f1d1d, 0.7); // crimson turret caps + banner
    const merlonGeo = geo(new THREE.BoxGeometry(0.42, 0.42, 0.3));
    const crenellate = (radius: number, y: number, count: number): void => {
      for (let m = 0; m < count; m++) {
        const a = (m / count) * Math.PI * 2;
        const merlon = new THREE.Mesh(merlonGeo, stone);
        merlon.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius);
        merlon.rotation.y = -a;
        this.keepGroup.add(merlon);
      }
    };

    // Plinth + curtain wall (the fireball's target plane) + wall walk.
    const plinth = new THREE.Mesh(geo(new THREE.CylinderGeometry(KEEP_R + 0.5, KEEP_R + 1.1, 0.6, 14)), stoneDark);
    plinth.position.y = 0.3;
    const wall = new THREE.Mesh(geo(new THREE.CylinderGeometry(KEEP_R, KEEP_R + 0.25, 2.2, 14)), stone);
    wall.position.y = 1.6;
    const walk = new THREE.Mesh(geo(new THREE.CylinderGeometry(KEEP_R + 0.3, KEEP_R + 0.3, 0.22, 14)), stoneDark);
    walk.position.y = 2.75;
    this.keepGroup.add(plinth, wall, walk);
    crenellate(KEEP_R + 0.15, 3.05, 14);

    // Corner towers on the wall, capped in crimson cones.
    const towerGeo = geo(new THREE.CylinderGeometry(0.55, 0.65, 3.2, 8));
    const turretGeo = geo(new THREE.ConeGeometry(0.75, 0.9, 8));
    for (let c = 0; c < 4; c++) {
      const a = (c / 4) * Math.PI * 2 + Math.PI / 4;
      const cx = Math.cos(a) * KEEP_R;
      const cz = Math.sin(a) * KEEP_R;
      const corner = new THREE.Mesh(towerGeo, stone);
      corner.position.set(cx, 1.7, cz);
      const turret = new THREE.Mesh(turretGeo, roofMat);
      turret.position.set(cx, 3.7, cz);
      this.keepGroup.add(corner, turret);
    }

    // The gatehouse: a squared front with a dark arch, facing +z.
    const gate = new THREE.Mesh(geo(new THREE.BoxGeometry(1.6, 2.4, 0.7)), stone);
    gate.position.set(0, 1.2, KEEP_R + 0.1);
    const arch = new THREE.Mesh(geo(new THREE.BoxGeometry(0.8, 1.3, 0.15)), this.bag.track(new THREE.MeshBasicMaterial({ color: 0x0c0a09 })));
    arch.position.set(0, 0.75, KEEP_R + 0.5);
    this.keepGroup.add(gate, arch);

    // The central keep: tall and tapered, glowing windows high on each
    // face, crenellated open top for the catapult, banner streaming.
    const keep = new THREE.Mesh(geo(new THREE.CylinderGeometry(1.5, 1.85, 6.5, 10)), stone);
    keep.position.y = 3.25;
    const keepCap = new THREE.Mesh(geo(new THREE.CylinderGeometry(1.7, 1.7, 0.3, 10)), stoneDark);
    keepCap.position.y = 6.5;
    this.keepGroup.add(keep, keepCap);
    crenellate(1.6, 6.85, 8);
    this.windowMat = this.bag.track(new THREE.MeshBasicMaterial({ color: 0x1c1917 }));
    const winGeo = geo(new THREE.BoxGeometry(0.36, 0.66, 0.1));
    for (let w = 0; w < 4; w++) {
      const a = (w / 4) * Math.PI * 2 + Math.PI / 4;
      const win = new THREE.Mesh(winGeo, this.windowMat);
      win.position.set(Math.cos(a) * 1.62, 5.2, Math.sin(a) * 1.62);
      win.rotation.y = -a + Math.PI / 2;
      this.keepGroup.add(win);
    }
    const pole = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 5)), stoneDark);
    pole.position.set(1.35, 7.3, 0);
    const banner = new THREE.Mesh(
      geo(new THREE.PlaneGeometry(0.8, 0.42)),
      this.bag.track(
        new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.7, side: THREE.DoubleSide }),
      ),
    );
    banner.position.set(1.78, 7.72, 0);
    this.keepGroup.add(pole, banner);

    // The catapult arm on the keep's open top: snaps upright per launch.
    this.armGroup.position.y = 6.6;
    const beam = new THREE.Mesh(geo(new THREE.BoxGeometry(0.18, 1.7, 0.18)), stoneDark);
    beam.position.y = 0.75;
    const cup = new THREE.Mesh(geo(new THREE.BoxGeometry(0.45, 0.18, 0.45)), stoneDark);
    cup.position.y = 1.6;
    this.armGroup.add(beam, cup);
    this.armGroup.rotation.x = 1.1; // cocked
    this.keepGroup.add(this.armGroup);

    // Damage flames: one cone per HP, hidden until that hit lands, spread
    // over wall and keep; the win outro swells them all into the burnout.
    const flameGeo = geo(new THREE.ConeGeometry(0.45, 1.2, 6));
    const flameMat = this.bag.track(new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.9 }));
    for (let fl = 0; fl < this.hp; fl++) {
      const a = Math.random() * Math.PI * 2;
      const onWall = fl % 2 === 0;
      const fr = onWall ? KEEP_R * 0.85 : 1.2;
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(Math.cos(a) * fr, onWall ? 2.6 : 4 + Math.random() * 2.5, Math.sin(a) * fr);
      flame.visible = false;
      this.keepGroup.add(flame);
      this.flames.push(flame);
    }

    // --- Embers: glowing swallowables, scattered in the flight ring with
    // minimum spacing (rejection sampling, bounded tries).
    const emberGeo = geo(new THREE.IcosahedronGeometry(0.42, 0));
    const emberMat = this.bag.track(new THREE.MeshBasicMaterial({ color: 0xfb923c }));
    const haloGeo = geo(new THREE.IcosahedronGeometry(0.62, 0));
    const haloMat = this.bag.track(
      new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.3 }),
    );
    for (let e = 0; e < EMBER_COUNT + ROCK_ORB_COUNT; e++) {
      const obj = new THREE.Group();
      obj.add(new THREE.Mesh(emberGeo, emberMat), new THREE.Mesh(haloGeo, haloMat));
      world.add(obj);
      // The last few slots are rock-born: they start dormant and only light
      // up where a dodged boulder cooled off.
      const rock = e >= EMBER_COUNT;
      const ember: Ember = {
        obj,
        alive: false,
        respawnIn: Infinity,
        bobPhase: Math.random() * Math.PI * 2,
        rock,
      };
      if (rock) obj.visible = false;
      else this.placeEmber(ember);
      this.embers.push(ember);
    }

    // --- The fireball pool (a full clutch can be airborne) + boulders. ---
    const fireballGeo = geo(new THREE.SphereGeometry(0.34, 10, 8));
    for (let n = 0; n < MAX_AMMO; n++) {
      const mesh = new THREE.Mesh(fireballGeo, emberMat);
      mesh.visible = false;
      world.add(mesh);
      this.fireballs.push({ mesh, active: false, dx: 0, dz: 0 });
    }
    // Hit bursts: one per possible airborne fireball, so rapid-fire hits
    // each get their own flash.
    const burstGeo = geo(new THREE.SphereGeometry(1, 10, 8));
    for (let n = 0; n < MAX_AMMO; n++) {
      // Material per burst: overlapping rapid-fire flashes fade on their own.
      const mesh = new THREE.Mesh(
        burstGeo,
        this.bag.track(new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.9 })),
      );
      mesh.visible = false;
      world.add(mesh);
      this.bursts.push({ mesh, ms: 0 });
    }

    // Boulders read as FLAMING rock — a bigger dark core wrapped in a glowing
    // fire shell (unlit material), so they stay visible against sky and sea.
    const boulderGeo = geo(new THREE.IcosahedronGeometry(0.7, 0));
    const boulderMat = mat(0x44403c, 0.9);
    const fireShellGeo = geo(new THREE.IcosahedronGeometry(0.95, 0));
    const fireShellMat = this.bag.track(
      new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.45 }),
    );
    const ringGeo = geo(new THREE.RingGeometry(0.8, 1.05, 20));
    const ringMat = this.bag.track(
      new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.85 }),
    );
    const discGeo = geo(new THREE.CircleGeometry(0.8, 20));
    const discMat = this.bag.track(
      new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.35 }),
    );
    const dustGeo = geo(new THREE.CircleGeometry(1, 12));
    const dustMat = this.bag.track(
      new THREE.MeshBasicMaterial({ color: 0x9ca3af, transparent: true, opacity: 0.7 }),
    );
    for (let m = 0; m < MORTAR_POOL; m++) {
      const boulder = new THREE.Group();
      boulder.add(new THREE.Mesh(boulderGeo, boulderMat), new THREE.Mesh(fireShellGeo, fireShellMat));
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.rotation.x = -Math.PI / 2;
      const dust = new THREE.Mesh(dustGeo, dustMat);
      dust.rotation.x = -Math.PI / 2;
      boulder.visible = ring.visible = disc.visible = dust.visible = false;
      world.add(boulder, ring, disc, dust);
      this.mortars.push({
        active: false,
        boulder,
        ring,
        disc,
        tx: 0,
        tz: 0,
        flightMs: 0,
        ms: 0,
        restMs: 0,
        dust,
        dustMs: 0,
      });
    }

    // --- DOM: the boss bar (top-center) and the player-hit vignette. ---
    this.pill = document.createElement("div");
    // One slim row — name · HP blocks · hearts — so it stays out of the sky.
    this.pill.style.cssText =
      "position:absolute;top:8px;left:50%;transform:translateX(-50%);display:flex;" +
      "align-items:center;gap:8px;padding:3px 10px;border-radius:999px;" +
      "background:rgba(15,23,42,0.6);pointer-events:none;";
    const name = document.createElement("span");
    name.textContent = "THE KEEP";
    name.style.cssText =
      "color:#d6d3d1;font-size:9px;font-weight:800;letter-spacing:0.14em;white-space:nowrap;";
    const blockRow = document.createElement("span");
    blockRow.style.cssText = "display:flex;gap:3px;";
    for (let b = 0; b < this.hp; b++) {
      const block = document.createElement("span");
      block.style.cssText =
        "width:11px;height:5px;border-radius:2px;background:#f97316;transition:opacity 0.3s;";
      blockRow.appendChild(block);
      this.hpBlocks.push(block);
    }
    const heartRow = document.createElement("span");
    heartRow.style.cssText = "display:flex;gap:2px;font-size:9px;line-height:1;";
    for (let h = 0; h < this.shield; h++) {
      const heart = document.createElement("span");
      heart.textContent = "♥";
      heart.style.cssText = "color:#f87171;transition:opacity 0.3s;";
      heartRow.appendChild(heart);
      this.hearts.push(heart);
    }
    this.pill.append(name, blockRow, heartRow);
    this.flash = document.createElement("div");
    this.flash.style.cssText =
      "position:absolute;inset:0;pointer-events:none;opacity:0;" +
      "background:radial-gradient(ellipse at center, transparent 45%, rgba(239,68,68,0.6));";
    host.append(this.pill, this.flash);
  }

  get outcome(): "pending" | "win" | "lose" {
    return this._outcome;
  }

  dispose(): void {
    this.pill.remove();
    this.flash.remove();
    this.bag.dispose();
    this.session.detachAvatar();
  }

  update(f: FrameResult, dt: number): void {
    this.t += dt;
    this.avatar.animate(dt);

    // Inputs. Steering is head tilt PLUS torso lean — either banks the
    // dragon, together they add (both mirrored channels: positive =
    // screen-left = heading-positive, the Drone mapping). The torso term
    // holds its last value through bodyTracked dropouts (the Red Light
    // lesson — reacquisition must not read as a swerve). Pitch is the
    // throttle: chin down dives, chin up brakes. Mouth fires.
    if (f.metrics.bodyTracked) {
      this.leanNorm = Math.max(-1, Math.min(1, f.metrics.torsoTilt / TORSO_RANGE_DEG));
    }
    const k = 1 - Math.exp(-dt / ROLL_SMOOTH_MS);
    const rollT = f.metrics.headRoll / ROLL_RANGE_DEG;
    const steerT = Math.max(-1, Math.min(1, rollT + this.leanNorm));
    this.steerNorm += (steerT - this.steerNorm) * k;
    const kp = 1 - Math.exp(-dt / PITCH_SMOOTH_MS);
    // Negated: in practice headPitch reads positive on a chin-UP here, and
    // pitchNorm must be positive for the dive (chin down = faster).
    const pitchT = Math.max(-1, Math.min(1, -f.metrics.headPitch / PITCH_RANGE_DEG));
    this.pitchNorm += (pitchT - this.pitchNorm) * kp;
    if (f.expression) {
      const km = 1 - Math.exp(-dt / MOUTH_SMOOTH_MS);
      this.mouth += (f.expression.mouthOpen - this.mouth) * km;
    }
    if (this.mouth <= MOUTH_REARM) this.armed = true;

    // Fly — the crash outro takes the stick away and spirals down instead.
    if (this.mode === "crash") {
      const p = Math.min(1, (this.t - this.modeAt) / CRASH_MS);
      this.heading += 0.004 * dt; // the spin
      const v = SPEED[this.lvl] * (1 - 0.6 * p);
      this.x += -Math.sin(this.heading) * v * dt;
      this.z += -Math.cos(this.heading) * v * dt;
      this.pushOffKeep();
      this.avatar.setFlight(this.x, this.z, this.heading, 1, dt, FLY_Y - (FLY_Y - GROUND_Y - 0.4) * p * p);
      if (this.t >= this.modeAt + CRASH_MS) this._outcome = "lose";
      this.animateWorld(dt);
      return;
    }
    if (this.mode === "burnout") {
      // The kill shot takes the stick: the dragon glides to a hover and
      // wheels around to face the keep — the chase camera (lagging behind
      // the heading) swings with it, framing the collapse past the dragon.
      const p = Math.min(1, (this.t - this.modeAt) / 900);
      const face = Math.atan2(this.x, this.z); // heading that points at the keep
      const d = Math.atan2(Math.sin(face - this.heading), Math.cos(face - this.heading));
      this.heading += d * (1 - Math.exp(-dt / 350));
      const v = SPEED[this.lvl] * (1 - p); // glide out the remaining momentum
      this.x += -Math.sin(this.heading) * v * dt;
      this.z += -Math.cos(this.heading) * v * dt;
      this.pushOffKeep();
      this.avatar.setFlight(this.x, this.z, this.heading, Math.max(-1, Math.min(1, d)), dt);
      this.animateWorld(dt);
      if (this.t >= Math.min(this.modeAt + WIN_OUTRO_MS, this.clockMs - OUTRO_MARGIN_MS))
        this._outcome = "win";
      return;
    }
    // Expo response with a true 0% zone: inside the deadband nothing steers
    // (rest wobble flies dead straight), then the remaining range is squared
    // (sign-preserving) so the first degrees past it stay gentle and a full
    // tilt keeps the full rate.
    const mag = Math.max(0, Math.abs(this.steerNorm) - STEER_DEADBAND) / (1 - STEER_DEADBAND);
    const steer = Math.sign(this.steerNorm) * mag * mag;
    this.heading += steer * TURN_RATE * dt;
    const dx = -Math.sin(this.heading);
    const dz = -Math.cos(this.heading);
    const v = SPEED[this.lvl] * this.speedFactor();
    this.x += dx * v * dt;
    this.z += dz * v * dt;
    // Stay off the stonework and this side of the deep water (positions
    // clamp; heading is the player's, so steering out is always available).
    this.pushOffKeep();
    const r = Math.hypot(this.x, this.z);
    if (r > BOUND_R) {
      this.x *= BOUND_R / r;
      this.z *= BOUND_R / r;
    }
    // The dive reads in the picture: nose down, a small altitude dip (judging
    // stays 2D — embers, blasts and fireballs all live at the cruise plane).
    // The staging gets the SHAPED steer — bank and tail always show the
    // turn rate actually being flown.
    this.avatar.setFlight(
      this.x,
      this.z,
      this.heading,
      steer,
      dt,
      FLY_Y - DIVE_DROP * this.pitchNorm,
      this.pitchNorm,
    );

    this.animateWorld(dt);

    // --- Eat (automatic on flyover, up to the clutch's capacity). ---
    if (this.ammo < MAX_AMMO) {
      const bite = this.embers.find(
        (e) => e.alive && Math.hypot(this.x - e.obj.position.x, this.z - e.obj.position.z) <= EAT_R,
      );
      if (bite) {
        bite.alive = false;
        bite.obj.visible = false;
        // Rock-born embers don't respawn on their own — the next boulder is
        // their respawn.
        bite.respawnIn = bite.rock ? Infinity : EMBER_RESPAWN_MS;
        // Only the FIRST pickup un-arms (a hanging-open mouth shouldn't fire
        // it instantly); topping up mid-attack never eats a queued shot.
        if (this.ammo === 0) this.armed = false;
        this.ammo += 1;
        this.avatar.setAmmo(this.ammo);
        playTick(false);
      }
    }

    // --- Fire: the mouth's only job. HOLD it open and the dragon empties
    // the clutch as a rapid burst, one orb every RAPID_FIRE_MS; armed stays
    // true through the burst (it only drops on an empty-mouthed pickup), so
    // closing is never required between burst shots — only between bursts
    // that started from an empty clutch.
    if (this.ammo > 0 && this.armed && this.mouth >= MOUTH_FIRE && this.t >= this.nextShotAt) {
      const ball = this.fireballs.find((b) => !b.active);
      if (ball) {
        this.ammo -= 1;
        this.avatar.setAmmo(this.ammo);
        this.nextShotAt = this.t + RAPID_FIRE_MS;
        ball.active = true;
        ball.dx = dx;
        ball.dz = dz;
        ball.mesh.visible = true;
        ball.mesh.position.set(this.x + dx * 1.2, FLY_Y, this.z + dz * 1.2);
        playTick(false);
      }
    }

    // Fireballs fly flat and judge against the curtain wall's radius.
    for (const ball of this.fireballs) {
      if (!ball.active) continue;
      ball.mesh.position.x += ball.dx * FIREBALL_V * dt;
      ball.mesh.position.z += ball.dz * FIREBALL_V * dt;
      const fr = Math.hypot(ball.mesh.position.x, ball.mesh.position.z);
      if (fr <= KEEP_R) {
        ball.active = false;
        ball.mesh.visible = false;
        this.spawnBurst(ball.mesh.position);
        this.keepHit();
        if (this.mode !== "fight") break; // that hit was the burnout
      } else if (fr > BOUND_R + 3) {
        ball.active = false;
        ball.mesh.visible = false;
      }
    }

    // --- The keep's mortar: leads the dragon with scatter; the ring at the
    // impact point is the whole telegraph.
    if (this.mode === "fight" && this.t >= this.nextAttackAt) {
      this.launchBoulder();
      this.nextAttackAt = this.t + attackEvery((this.lvl + 1) as Level);
    }
    if (this.mode === "intro" && this.t >= INTRO_MS) {
      this.mode = "fight";
      this.modeAt = this.t;
    }
  }

  // --- Transitions. ---

  private keepHit(): void {
    this.hp -= 1;
    this.flames[KEEP_HP[this.lvl] - this.hp - 1].visible = true;
    this.updateHud();
    playTick(true);
    if (this.hp <= 0) {
      this.mode = "burnout";
      this.modeAt = this.t;
      // Dead mortars: rings vanish, boulders in flight fall inert (they just
      // stop being judged — killMortar hides them); stray fireballs too.
      for (const m of this.mortars) if (m.active) this.killMortar(m);
      this.clearFireballs();
    }
  }

  private playerHit(): void {
    this.shield -= 1;
    this.flashAt = this.t;
    this.updateHud();
    playTick(true);
    if (this.shield <= 0) {
      this.mode = "crash";
      this.modeAt = this.t;
      this.avatar.setAmmo(0);
      for (const m of this.mortars) if (m.active) this.killMortar(m);
      this.clearFireballs();
    }
  }

  /** The pitch throttle, asymmetric: chin down runs to ×2, chin up brakes
   * to ×0.5. Also feeds the mortar's lead, so the keep aims at the speed
   * you're actually flying. */
  private speedFactor(): number {
    return 1 + this.pitchNorm * (this.pitchNorm > 0 ? DIVE_GAIN : BRAKE_GAIN);
  }

  /** Keep the dragon outside the stonework — cruise, crash and burnout all
   * integrate their own motion, and none of them may fly into the castle. */
  private pushOffKeep(): void {
    const r = Math.hypot(this.x, this.z);
    if (r < KEEP_PUSH_R && r > 0) {
      this.x *= KEEP_PUSH_R / r;
      this.z *= KEEP_PUSH_R / r;
    }
  }

  private clearFireballs(): void {
    for (const ball of this.fireballs) {
      ball.active = false;
      ball.mesh.visible = false;
    }
  }

  /** The hit signal: a flash swells off the stonework and the castle rattles. */
  private spawnBurst(at: THREE.Vector3): void {
    const burst = this.bursts.find((b) => b.ms <= 0) ?? this.bursts[0];
    burst.ms = HIT_BURST_MS;
    burst.mesh.visible = true;
    burst.mesh.position.copy(at);
    this.shakeAt = this.t;
  }

  private launchBoulder(): void {
    const m = this.mortars.find((mm) => !mm.active && mm.restMs <= 0);
    if (!m) return;
    const i = this.lvl;
    // Lead the dragon: where a straight line AT ITS CURRENT SPEED would put
    // it over most of the flight (a braking dragon gets led less — camping
    // the brake can't bait every boulder long), scattered so the aim is
    // beatable and unlearnable.
    const v = SPEED[i] * this.speedFactor();
    const lead = v * BOULDER_FLIGHT_MS[i] * (0.55 + Math.random() * 0.45);
    const px = Math.cos(this.heading); // perpendicular to the flight dir
    const pz = -Math.sin(this.heading); // (dx,dz rotated a quarter turn)
    const jitter = (Math.random() - 0.5) * 3.6;
    let tx = this.x + -Math.sin(this.heading) * lead + px * jitter;
    let tz = this.z + -Math.cos(this.heading) * lead + pz * jitter;
    // Clamp the impact into the playable ring.
    const tr = Math.hypot(tx, tz);
    const clamped = Math.max(KEEP_PUSH_R + 1, Math.min(BOUND_R, tr));
    if (tr > 0) {
      tx *= clamped / tr;
      tz *= clamped / tr;
    }
    m.active = true;
    m.tx = tx;
    m.tz = tz;
    m.flightMs = BOULDER_FLIGHT_MS[i];
    m.ms = 0;
    m.boulder.visible = true;
    m.ring.visible = true;
    m.disc.visible = true;
    m.ring.position.set(tx, GROUND_Y + 0.03, tz);
    m.disc.position.set(tx, GROUND_Y + 0.02, tz);
    const blast = BLAST_R[i];
    m.ring.scale.set(blast, blast, 1);
    this.armSnapMs = 0;
    playTick(false);
  }

  private killMortar(m: Mortar): void {
    m.active = false;
    m.restMs = 0;
    m.boulder.visible = false;
    m.ring.visible = false;
    m.disc.visible = false;
  }

  private updateHud(): void {
    this.hpBlocks.forEach((b, n) => (b.style.opacity = n < this.hp ? "1" : "0.15"));
    this.hearts.forEach((h, n) => (h.style.opacity = n < this.shield ? "1" : "0.15"));
  }

  // --- Per-frame presentation + mortar physics (no allocation). ---

  private animateWorld(dt: number): void {
    // Embers bob, get magnetically drawn to a passing dragon (only while
    // there's clutch room — a full dragon leaves them be), and respawn.
    const magnetOn =
      this.ammo < MAX_AMMO && (this.mode === "fight" || this.mode === "intro");
    for (const e of this.embers) {
      if (e.alive) {
        if (magnetOn) {
          const ex = this.x - e.obj.position.x;
          const ez = this.z - e.obj.position.z;
          const d = Math.hypot(ex, ez);
          if (d < MAGNET_R && d > 0.001) {
            // Pull strengthens as it closes — reads as gravity, and the
            // catch is still sealed by the EAT_R check (never at range).
            const v = MAGNET_V * (1 - d / MAGNET_R) * dt;
            e.obj.position.x += (ex / d) * Math.min(v, d);
            e.obj.position.z += (ez / d) * Math.min(v, d);
          }
        }
        e.obj.position.y = FLY_Y + Math.sin(this.t / 400 + e.bobPhase) * 0.18;
        e.obj.rotation.y += dt * 0.002;
      } else if (this.mode === "fight" || this.mode === "intro") {
        e.respawnIn -= dt;
        if (e.respawnIn <= 0) this.placeEmber(e);
      }
    }

    // Mortars: the boulder arcs from the tower top to the marked point over
    // exactly flightMs; the disc fills the ring across the same span. Impact
    // is judged at the ONE frame the flight completes.
    for (const m of this.mortars) {
      if (m.dustMs > 0) {
        m.dustMs -= dt;
        const p = Math.max(0, m.dustMs / FLASH_MS);
        m.dust.scale.setScalar(1 + (1 - p) * 1.8);
        (m.dust.material as THREE.MeshBasicMaterial).opacity = p * 0.7;
        if (m.dustMs <= 0) m.dust.visible = false;
      }
      if (!m.active) {
        // A landed rock cools on the field, then wakes a rock-ember slot
        // right where it fell — the dodge becomes the next pickup.
        if (m.restMs > 0) {
          m.restMs -= dt;
          if (m.restMs <= 0) {
            m.boulder.visible = false;
            const slot = this.embers.find((e) => e.rock && !e.alive);
            if (slot) {
              slot.alive = true;
              slot.obj.visible = true;
              slot.obj.position.set(m.tx, FLY_Y, m.tz);
            }
          }
        }
        continue;
      }
      m.ms += dt;
      const p = Math.min(1, m.ms / m.flightMs);
      const bx = 0 + (m.tx - 0) * p;
      const bz = 0 + (m.tz - 0) * p;
      const by = KEEP_TOP_Y + (GROUND_Y + 0.4 - KEEP_TOP_Y) * p + Math.sin(p * Math.PI) * 4.5;
      m.boulder.position.set(bx, by, bz);
      m.boulder.rotation.x += dt * 0.006;
      const blast = BLAST_R[this.lvl];
      m.disc.scale.set(blast * p, blast * p, 1);
      if (p >= 1) {
        if (Math.hypot(this.x - m.tx, this.z - m.tz) <= blast) this.playerHit();
        // The rock stays where it fell, cooling — the ring vanishes, dust
        // kicks up, and after ROCK_TO_ORB_MS it lights into an ember.
        m.active = false;
        m.ring.visible = false;
        m.disc.visible = false;
        m.boulder.position.set(m.tx, GROUND_Y + 0.55, m.tz);
        m.restMs = ROCK_TO_ORB_MS;
        m.dust.position.set(m.tx, GROUND_Y + 0.04, m.tz);
        m.dust.visible = true;
        m.dustMs = FLASH_MS;
      }
    }

    // The catapult arm snaps for a launch, then re-cocks.
    if (!Number.isNaN(this.armSnapMs)) {
      this.armSnapMs += dt;
      const p = Math.min(1, this.armSnapMs / 600);
      this.armGroup.rotation.x = p < 0.3 ? 1.1 - (p / 0.3) * 1.1 : ((p - 0.3) / 0.7) * 1.1;
      if (p >= 1) this.armSnapMs = NaN;
    }

    // Aim aid: the windows glow amber when a shot fired NOW would connect
    // (the ray from the dragon along its heading passes the tower).
    let locked = false;
    if (this.ammo > 0) {
      const dx = -Math.sin(this.heading);
      const dz = -Math.cos(this.heading);
      const ahead = -(this.x * dx + this.z * dz) > 0; // tower is in front
      const miss = Math.abs(this.x * dz - this.z * dx); // ray-to-center distance
      locked = ahead && miss <= KEEP_R;
    }
    this.windowMat.color.setHex(locked ? 0xfbbf24 : 0x1c1917);

    // The burnout: every flame swells and the tower slumps.
    if (this.mode === "burnout") {
      const p = Math.min(1, (this.t - this.modeAt) / WIN_OUTRO_MS);
      for (const flame of this.flames) {
        flame.visible = true;
        flame.scale.setScalar(1 + p * 2.2);
      }
      this.keepGroup.position.y = GROUND_Y - p * 1.8;
      this.keepGroup.rotation.z = p * 0.12;
    } else {
      // Live damage flames flicker.
      for (const flame of this.flames) {
        if (flame.visible) flame.scale.setScalar(0.9 + 0.2 * Math.sin(this.t / 90 + flame.position.x));
      }
    }

    // Fireball tumble.
    for (const ball of this.fireballs) {
      if (ball.active) ball.mesh.rotation.y += dt * 0.01;
    }

    // Hit feedback: bursts swell and fade off the stonework; the castle
    // rattles for a beat (burnout owns the keep transform, so no shake there).
    for (const b of this.bursts) {
      if (b.ms <= 0) continue;
      b.ms -= dt;
      const p = 1 - Math.max(0, b.ms) / HIT_BURST_MS;
      b.mesh.scale.setScalar(0.5 + 2 * p);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - p);
      if (b.ms <= 0) b.mesh.visible = false;
    }
    if (!Number.isNaN(this.shakeAt) && this.mode !== "burnout") {
      const p = (this.t - this.shakeAt) / HIT_SHAKE_MS;
      if (p >= 1) {
        this.shakeAt = NaN;
        this.keepGroup.position.x = 0;
        this.keepGroup.position.z = 0;
      } else {
        const amp = 0.1 * (1 - p);
        this.keepGroup.position.x = Math.sin(this.t / 14) * amp;
        this.keepGroup.position.z = Math.cos(this.t / 17) * amp;
      }
    }

    // Player-hit vignette, driven from game time.
    if (!Number.isNaN(this.flashAt)) {
      const p = (this.t - this.flashAt) / FLASH_MS;
      this.flash.style.opacity = p >= 1 ? "0" : String(0.9 * (1 - p));
      if (p >= 1) this.flashAt = NaN;
    }
  }

  /** Drop an ember somewhere fresh in the flight ring (bounded tries). */
  private placeEmber(e: Ember): void {
    let px = 0;
    let pz = 0;
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * Math.PI * 2;
      const rr = EMBER_MIN_R + Math.random() * (EMBER_MAX_R - EMBER_MIN_R);
      px = Math.cos(a) * rr;
      pz = Math.sin(a) * rr;
      const clear = this.embers.every(
        (o) => o === e || !o.alive || Math.hypot(px - o.obj.position.x, pz - o.obj.position.z) >= EMBER_SPACING,
      );
      // Not right under the dragon either — a swallow should be flown to.
      if (clear && Math.hypot(px - this.x, pz - this.z) > EAT_R * 2) break;
    }
    e.obj.position.set(px, FLY_Y, pz);
    e.obj.visible = true;
    e.alive = true;
  }
}

export const keepDef: MicrogameDef = {
  id: "keep",
  title: "Final Boss: The Keep",
  prompt: { lead: "collect, then", action: "SHOOT" },
  hint: "tilt to steer · fly through embers to collect them · open your mouth to shoot a fireball · turn to dodge the boulders",
  durationMs: bossClockMs,
  create(canvas, session, level) {
    const avatar = session.attachAvatar(canvas, DragonAvatar);
    return new KeepGame(avatar, session, level, canvas.parentElement!);
  },
};
