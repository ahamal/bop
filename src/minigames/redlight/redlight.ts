// Red Light — microgame #5, "Sprint". Squid-game field day: a giant doll
// stands past the finish line with her back turned. MOVE — head or body,
// any motion counts (the run charge chases a combined head + torso movement
// speed), so shake, wag, lean, wobble, whatever; only holding still is
// standing still. When the doll spins around the light goes red: freeze.
// There's a grace window (her turn animation plus a beat) for momentum to die
// down; still moving after it = eliminated, face down in the dirt. Reach the
// line before the director's 10s clock or lose.
//
// The playfield IS the avatar's scene (the Chomp pattern): the player figure
// never translates — the fieldGroup (ground, finish line, doll, crowd)
// scrolls +z past it as distance accrues. The idol-group crowd from Dance
// runs the race alongside as simple cylinder-and-head figures with stick
// arms that pump while they run; they obey the light with per-runner
// reaction lag, and on later levels one straggler per red gets scripted-
// eliminated for drama (flash red, topple — flavor, not judging).
//
// The light state is legible three ways: the doll physically turns, her eyes
// glow red, and a DOM pill at the top of the playfield names the light
// (Dance's overlay pattern — crisp type wants DOM, removed on dispose).

import * as THREE from "three";
import type { FrameResult, TrackingSession } from "../../tracking/session.ts";
import type { Level, Microgame, MicrogameDef } from "../registry.ts";
import { playTick } from "../../audio/sfx.ts";
import { ResourceBag } from "../resources.ts";
import { FIELD_Y, RedLightAvatar } from "./avatar.ts";

// --- Movement → run. ANY head or body motion counts: the run charge chases
// a combined movement speed — head angular speed (|yaw|+|pitch|+|roll|
// deg/s) plus torso tilt speed plus the closeness channels (lean in/out,
// ratios scaled into the same deg-ish units) — smoothed, deadbanded so
// tracker jitter can't creep you forward, and saturating at a vigorous
// shake. Holding still — or holding any pose — is zero velocity, so
// freezing on red works exactly as it should.
// The smoothing is ASYMMETRIC everywhere: rising speed is smoothed enough to
// ride over a shake's zero-crossings, but falling speed tracks fast — when
// you freeze, the figure should plant, not coast.
const SPEED_RISE_MS = 130; // EMA on rising movement speed (frames jitter)
const SPEED_FALL_MS = 55; // falling speed tracks quicker
const CLOSENESS_SCALE = 250; // Δ closeness ratio → deg-ish units
const DEADBAND_DPS = 25; // below this = standing still
const FULL_DPS = 150; // combined deg/s that earns a flat-out sprint
const ATTACK_MS = 120; // charge ramps up this fast when you start moving
const RELEASE_MS = 80; // and winds down this fast when you stop — a PLANT
const MAX_SPEED = 6.2; // world units (≈ meters) per second at full charge

// --- The light. Red is announced by the doll's turn; the kill window only
// opens once she's fully around plus a beat of mercy. Violation must persist
// (accumulated ms above the tolerance) so one jitter frame can't eliminate.
// The doll's spin spans the WHOLE turn+grace window — she lands face-on
// exactly when the kill window opens, so her rotation is the visible timer.
// Both shrink with level: at 5 she WHIPS around.
const TURN_MS = [640, 600, 540, 440, 260];
const GRACE_MS = [1000, 850, 720, 600, 420];
// The round's FIRST red turns slower — a stretched grace while the player is
// still finding the rhythm; later reds run at the level's true pace.
const FIRST_RED_GRACE = 1.25;
const MOVE_TOL = 0.2; // run charge below this is "standing still"
const VIOLATION_MS = 230; // motion above tolerance must persist this long to catch

// --- The course, per level. The race needs room to breathe, so this game
// asks the director for a longer clock than the standard 10s.
const DURATION_MS = 15_000;
// The goal is DERIVED from the rolled light schedule, not fixed: total green
// time inside the clock (minus a finishing reserve) × MAX_SPEED × the
// level's required-effort fraction. Every session is winnable by
// construction — a stingy roll simply builds a shorter course; the level
// only decides how close to a flat-out sprint you must hold.
const EFFORT = [0.4, 0.5, 0.6, 0.7, 0.78];
const RESERVE_MS = 1200; // clock left unbudgeted: linger + human slack
const GREEN_MS: [number, number][] = [
  [2600, 3400],
  [2100, 2800],
  [1700, 2300],
  [1500, 2000],
  [1300, 1900],
];
const RED_MS: [number, number][] = [
  [800, 1100],
  [950, 1300],
  [1100, 1500],
  [1200, 1650],
  [1250, 1700],
];

const DOLL_PAST_LINE = 4.5; // doll stands this far beyond the finish
const LINGER_MS = 650; // let the win pose / the fall read before resolving

// The crowd: lane x, size, and how late each runner reacts to the light.
const RUNNERS = [
  { x: -3.1, scale: 0.5, lagMs: 260 },
  { x: -1.9, scale: 0.56, lagMs: 140 },
  { x: 1.9, scale: 0.56, lagMs: 200 },
  { x: 3.1, scale: 0.5, lagMs: 320 },
  { x: -4.2, scale: 0.46, lagMs: 380 },
  { x: 4.2, scale: 0.46, lagMs: 300 },
];
const RUNNER_HZ = 2.3; // crowd stride rate
const ARM_SWING = 0.9;

type Light = "green" | "red";

interface Phase {
  light: Light;
  at: number; // game-time ms this phase begins
  graceMs?: number; // red phases: this red's grace (the first runs longer)
}

interface Runner {
  group: THREE.Group;
  arms: [THREE.Group, THREE.Group];
  skull: THREE.Mesh;
  baseY: number;
  scale: number;
  lagMs: number;
  dist: number;
  speed: number; // relative to the pack's nominal pace
  phase: number;
  running: number; // eased 0..1, chases the (lagged) light
  state: "racing" | "finished" | "dead";
  fallT: number;
}

class RedLightGame implements Microgame {
  private _outcome: "pending" | "win" | "lose" = "pending";
  private t = 0;
  private decidedAt = NaN;
  private won = false;

  private readonly goal: number;
  private readonly graceMs: number;
  private readonly turnMs: number;
  private phases: Phase[];
  private phaseIdx = 0;
  private redAt = NaN; // when the current red began (its turn+grace anchor)
  private curGrace = 0; // the current red's grace (the first runs longer)

  // Movement detection state.
  private prevYaw = NaN;
  private prevPitch = NaN;
  private prevRoll = NaN;
  private prevCloseness = NaN;
  private prevTorsoTilt = NaN;
  private prevTorsoCloseness = NaN;
  private prevBodyTracked = false;
  private speedEma = 0; // smoothed combined movement speed, deg-ish/s
  private charge = 0;
  private violationMs = 0;

  private dist = 0;
  private fallT = 0;

  private dollTurn = 0; // eased 0 (back turned) … 1 (facing the runners)
  private doll!: THREE.Group;
  private eyeMat: THREE.MeshStandardMaterial;
  private runners: Runner[] = [];
  private victim: Runner | null = null;

  private bag = new ResourceBag();
  private lightPill: HTMLDivElement;

  constructor(
    private avatar: RedLightAvatar,
    private session: TrackingSession,
    private level: Level,
    host: HTMLElement,
  ) {
    this.graceMs = GRACE_MS[level - 1];
    this.turnMs = TURN_MS[level - 1];

    // The light schedule: green out of the gate, then alternate with random
    // durations from the level's ranges, generated well past the clock.
    const rand = ([lo, hi]: [number, number]): number => lo + Math.random() * (hi - lo);
    this.phases = [{ light: "green", at: 0 }];
    // The opening green is capped: the goal's no-one-pass floor scales with
    // it, so a long first green (low levels roll 2.6–3.4s) would inflate the
    // whole course. Cap it and the first red arrives sooner AND the track
    // shortens with it.
    let at = Math.min(rand(GREEN_MS[level - 1]), 2200);
    let firstRed = true;
    while (at < DURATION_MS + 4000) {
      const graceMs = this.graceMs * (firstRed ? FIRST_RED_GRACE : 1);
      firstRed = false;
      this.phases.push({ light: "red", at, graceMs });
      at += rand(RED_MS[level - 1]) + this.turnMs + graceMs;
      this.phases.push({ light: "green", at });
      at += rand(GREEN_MS[level - 1]);
    }

    // The goal this session can actually support: green time inside the
    // usable clock, at max speed, scaled by the level's effort bar.
    const usable = DURATION_MS - RESERVE_MS;
    let greenMs = 0;
    for (let i = 0; i < this.phases.length; i++) {
      if (this.phases[i].light !== "green") continue;
      const start = this.phases[i].at;
      const end = Math.min(this.phases[i + 1]?.at ?? usable, usable);
      greenMs += Math.max(0, end - start);
    }
    const budget = (greenMs / 1000) * MAX_SPEED; // full-sprint ceiling
    // Floor: the doll must matter. Even a perfect sprint from frame zero
    // can't cross the line before the first red's kill window opens (the
    // opening green plus the whole first turn's momentum, and change).
    const firstKillMs = this.phases[1].at + this.turnMs + this.graceMs * FIRST_RED_GRACE;
    const floor = (firstKillMs / 1000) * MAX_SPEED * 1.05;
    this.goal = Math.round(
      Math.max(Math.min(floor, budget * 0.85), budget * EFFORT[level - 1]),
    );

    // --- The field (all parented to fieldGroup, which scrolls +z). ---
    const { geo, mat } = this.bag;
    const field = this.avatar.fieldGroup;

    // Dusty arena ground, long enough to cover the whole run plus horizon.
    const groundLen = this.goal + DOLL_PAST_LINE + 40;
    const ground = new THREE.Mesh(geo(new THREE.PlaneGeometry(26, groundLen)), mat(0xb8a27e, 0.9));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, FIELD_Y, -groundLen / 2 + 14);
    field.add(ground);
    // Side stripes so the scroll (= your progress) is visible even mid-field.
    const stripeGeo = geo(new THREE.BoxGeometry(0.35, 0.04, 1.6));
    const stripeMat = mat(0xf1f5f9, 0.8);
    for (let z = 4; z > -(this.goal + 8); z -= 3.2) {
      for (const x of [-6.5, 6.5]) {
        const s = new THREE.Mesh(stripeGeo, stripeMat);
        s.position.set(x, FIELD_Y + 0.02, z);
        field.add(s);
      }
    }
    // The finish line: a bold white band across the track.
    const line = new THREE.Mesh(geo(new THREE.BoxGeometry(13, 0.05, 0.9)), stripeMat);
    line.position.set(0, FIELD_Y + 0.03, -this.goal);
    field.add(line);

    this.eyeMat = mat(0x1e293b, 0.3);
    this.buildDoll(field, geo, mat);
    this.buildRunners(field, geo, mat);

    // --- The light pill (DOM overlay; the host is the playfield div). ---
    this.lightPill = document.createElement("div");
    this.lightPill.style.cssText =
      "position:absolute;top:10px;left:50%;transform:translateX(-50%);" +
      "padding:6px 18px;border-radius:999px;font-size:13px;font-weight:800;" +
      "letter-spacing:0.14em;text-transform:uppercase;pointer-events:none;" +
      "transition:background 0.15s,color 0.15s,box-shadow 0.15s;";
    host.appendChild(this.lightPill);
    this.setPill("green");
  }

  get outcome(): "pending" | "win" | "lose" {
    return this._outcome;
  }

  get hud(): string {
    return `${Math.max(0, Math.ceil(this.goal - this.dist))} m`;
  }

  dispose(): void {
    this.lightPill.remove();
    this.bag.dispose();
    this.session.detachAvatar();
  }

  update(f: FrameResult, dt: number): void {
    this.t += dt;

    // --- Light state machine. ---
    while (this.phaseIdx + 1 < this.phases.length && this.phases[this.phaseIdx + 1].at <= this.t) {
      this.phaseIdx += 1;
      const light = this.phases[this.phaseIdx].light;
      if (light === "red") {
        this.redAt = this.phases[this.phaseIdx].at;
        this.curGrace = this.phases[this.phaseIdx].graceMs ?? this.graceMs;
        this.pickVictim();
        playTick(true); // sharper tick = the warning
      } else {
        this.redAt = NaN;
        playTick(false);
      }
      this.setPill(light);
    }
    const light = this.phases[this.phaseIdx].light;

    // --- Movement → run charge. ---
    const { headYaw, headPitch, headRoll, headCloseness, torsoTilt, torsoCloseness, bodyTracked } =
      f.metrics;
    if (Number.isNaN(this.prevYaw)) {
      this.prevYaw = headYaw;
      this.prevPitch = headPitch;
      this.prevRoll = headRoll;
      this.prevCloseness = headCloseness;
    }
    let travel =
      Math.abs(headYaw - this.prevYaw) +
      Math.abs(headPitch - this.prevPitch) +
      Math.abs(headRoll - this.prevRoll) +
      Math.abs(headCloseness - this.prevCloseness) * CLOSENESS_SCALE;
    // Torso channels only when BOTH frames had a trusted body reading — the
    // tilt snaps from 0 to its real value when tracking (re)acquires, and
    // that step must not read as a lunge.
    if (bodyTracked && this.prevBodyTracked) {
      travel +=
        Math.abs(torsoTilt - this.prevTorsoTilt) +
        Math.abs(torsoCloseness - this.prevTorsoCloseness) * CLOSENESS_SCALE;
    }
    const dps = (travel / Math.max(1, dt)) * 1000;
    this.prevYaw = headYaw;
    this.prevPitch = headPitch;
    this.prevRoll = headRoll;
    this.prevCloseness = headCloseness;
    this.prevTorsoTilt = torsoTilt;
    this.prevTorsoCloseness = torsoCloseness;
    this.prevBodyTracked = bodyTracked;
    // Smooth the raw speed (an oscillating shake dips through zero at each
    // extreme; the EMA rides over the dips), then chase it with the charge —
    // fast attack, slower release.
    const smoothTau = dps > this.speedEma ? SPEED_RISE_MS : SPEED_FALL_MS;
    this.speedEma += (dps - this.speedEma) * (1 - Math.exp(-dt / smoothTau));
    const target = Math.max(0, Math.min(1, (this.speedEma - DEADBAND_DPS) / (FULL_DPS - DEADBAND_DPS)));
    const tau = target > this.charge ? ATTACK_MS : RELEASE_MS;
    this.charge += (target - this.charge) * (1 - Math.exp(-dt / tau));

    const eliminated = this._outcome !== "pending" || !Number.isNaN(this.decidedAt);
    const moving = this.charge > MOVE_TOL && !eliminated && !this.won;
    if (moving) this.dist = Math.min(this.goal, this.dist + (this.charge * MAX_SPEED * dt) / 1000);

    // --- Judging: red, past the turn and the grace, still moving. ---
    if (light === "red" && !eliminated && !this.won) {
      const killOpen = this.t - this.redAt >= this.turnMs + this.curGrace;
      if (killOpen && this.charge > MOVE_TOL) {
        this.violationMs += dt;
        if (this.violationMs >= VIOLATION_MS) this.decidedAt = this.t; // caught
      } else {
        this.violationMs = Math.max(0, this.violationMs - dt * 2);
      }
    } else {
      this.violationMs = 0;
    }
    if (this.dist >= this.goal && !this.won && Number.isNaN(this.decidedAt)) {
      this.won = true;
      this.decidedAt = this.t;
      playTick(true);
    }

    // --- Animate: player figure, field scroll, doll, crowd. ---
    if (!this.won && !Number.isNaN(this.decidedAt)) {
      // Caught: the run dies and the figure topples through the linger.
      this.fallT = Math.min(1, this.fallT + dt / (LINGER_MS * 0.7));
      this.avatar.setFall(this.fallT);
      this.avatar.run(dt, 0);
    } else {
      this.avatar.run(dt, this.won ? 0 : this.charge);
    }
    this.avatar.fieldGroup.position.z = this.dist;

    // Doll spin: the turn IS the grace — she sweeps around across the whole
    // turn+grace window (smoothstepped so it reads as a wind-up), landing
    // fully face-on exactly when the kill window opens. Green whips her back
    // fast. Eyes burn as she comes around.
    if (light === "red") {
      const p = Math.min(1, (this.t - this.redAt) / (this.turnMs + this.curGrace));
      this.dollTurn = p * p * (3 - 2 * p);
    } else {
      this.dollTurn += (0 - this.dollTurn) * (1 - Math.exp(-dt / 120));
    }
    this.doll.rotation.y = Math.PI * (1 - this.dollTurn);
    this.eyeMat.color.setHex(this.dollTurn > 0.8 ? 0xff2244 : 0x1e293b);
    this.eyeMat.emissive.setHex(this.dollTurn > 0.8 ? 0xcc0022 : 0x000000);

    this.updateRunners(dt, light);

    // --- Outcome: linger so the fall / the finish reads, then resolve. ---
    if (this._outcome === "pending" && !Number.isNaN(this.decidedAt)) {
      if (this.t - this.decidedAt >= LINGER_MS) this._outcome = this.won ? "win" : "lose";
    }
  }

  private setPill(light: Light): void {
    this.lightPill.textContent = light === "green" ? "green light" : "red light";
    this.lightPill.style.background = light === "green" ? "rgba(16,185,129,0.92)" : "rgba(239,68,68,0.95)";
    this.lightPill.style.color = light === "green" ? "#022c22" : "#fff1f2";
    this.lightPill.style.boxShadow =
      light === "green" ? "0 0 18px rgba(16,185,129,0.55)" : "0 0 22px rgba(239,68,68,0.7)";
  }

  // The doll: giant orange-dress figure past the finish line, oversized head,
  // black bob with twin tails, lamp eyes. Built facing AWAY (rotation.y = π
  // via dollTurn = 0); red spins her to face the field.
  private buildDoll(
    field: THREE.Group,
    geo: <G extends THREE.BufferGeometry>(g: G) => G,
    mat: (c: number, r?: number) => THREE.MeshStandardMaterial,
  ): void {
    const group = new THREE.Group();
    const dress = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.5, 1.5, 3.2, 7)), mat(0xf59e0b));
    dress.position.y = 1.6;
    const collar = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.55, 0.55, 0.3, 7)), mat(0xfef3c7));
    collar.position.y = 3.25;
    const head = new THREE.Group();
    head.position.y = 4.3;
    const skull = new THREE.Mesh(geo(new THREE.IcosahedronGeometry(1.05, 1)), mat(0xfcd9b6, 0.5));
    skull.scale.set(0.95, 1.05, 0.95);
    const hair = new THREE.Mesh(geo(new THREE.SphereGeometry(1.12, 8, 6)), mat(0x1c1917, 0.45));
    hair.scale.set(1, 0.85, 0.95);
    hair.position.set(0, 0.28, -0.18);
    head.add(skull, hair);
    for (const side of [-1, 1]) {
      const tail = new THREE.Mesh(geo(new THREE.SphereGeometry(0.3, 6, 5)), mat(0x1c1917, 0.45));
      tail.scale.set(1, 2.1, 1);
      tail.position.set(side * 1.05, -0.25, -0.15);
      head.add(tail);
      // Lamp eyes on the FACE side (+z of the head).
      const eye = new THREE.Mesh(geo(new THREE.SphereGeometry(0.14, 6, 5)), this.eyeMat);
      eye.position.set(side * 0.38, 0.08, 0.92);
      head.add(eye);
    }
    group.add(dress, collar, head);
    group.position.set(0, FIELD_Y, -(this.goal + DOLL_PAST_LINE));
    group.rotation.y = Math.PI; // back turned
    field.add(group);
    this.doll = group;
  }

  // The Dance crowd, repurposed as fellow racers: cylinder body + round head
  // (alternating dress/torso silhouettes), plus thin stick arms on shoulder
  // pivots that pump while they run. Backs to the camera, like the player.
  private buildRunners(
    field: THREE.Group,
    geo: <G extends THREE.BufferGeometry>(g: G) => G,
    mat: (c: number, r?: number) => THREE.MeshStandardMaterial,
  ): void {
    const dressGeo = geo(new THREE.CylinderGeometry(0.17, 0.52, 1.15, 6));
    const torsoGeo = geo(new THREE.CylinderGeometry(0.3, 0.4, 1.1, 6));
    const headGeo = geo(new THREE.IcosahedronGeometry(0.34, 1));
    const hairGeo = geo(new THREE.SphereGeometry(0.36, 7, 5));
    const armGeo = geo(new THREE.CapsuleGeometry(0.07, 0.55, 3, 6));
    const bodyMat = mat(0x818cf8);
    const headMat = mat(0xa5b4fc);
    const hairMat = mat(0x6e7ade);

    this.runners = RUNNERS.map((r, i) => {
      const female = i % 2 === 0;
      const group = new THREE.Group();
      const body = new THREE.Mesh(female ? dressGeo : torsoGeo, bodyMat);
      body.position.y = 0.68;
      const head = new THREE.Group();
      head.position.y = 1.62;
      const skull = new THREE.Mesh(headGeo, headMat);
      const hair = new THREE.Mesh(hairGeo, hairMat);
      hair.scale.set(1, female ? 0.9 : 0.55, 0.92);
      hair.position.set(0, female ? 0.14 : 0.23, -0.09);
      head.add(skull, hair);
      const arms: THREE.Group[] = [];
      for (const side of [-1, 1]) {
        const shoulder = new THREE.Group();
        shoulder.position.set(side * (female ? 0.24 : 0.33), 1.18, 0);
        const arm = new THREE.Mesh(armGeo, bodyMat);
        arm.position.y = -0.33;
        shoulder.add(arm);
        group.add(shoulder);
        arms.push(shoulder);
      }
      group.add(body, head);
      group.scale.setScalar(r.scale * 1.4);
      // Staggered starting line, everyone facing the doll (into the screen).
      group.rotation.y = Math.PI;
      const dist = 0.4 + Math.random() * 1.2;
      group.position.set(r.x, FIELD_Y, -dist);
      field.add(group);
      return {
        group,
        arms: [arms[0], arms[1]] as [THREE.Group, THREE.Group],
        skull,
        baseY: FIELD_Y,
        scale: r.scale * 1.4,
        lagMs: r.lagMs,
        dist,
        speed: 0.62 + Math.random() * 0.33, // fractions of the player's max
        phase: Math.random() * Math.PI * 2,
        running: 0,
        state: "racing" as const,
        fallT: 0,
      };
    });
  }

  // On later levels one laggard per red gets caught for drama — always the
  // slowest-reacting still-racing runner, decided the moment red starts.
  private pickVictim(): void {
    this.victim = null;
    if (this.level < 2 || Math.random() > 0.45) return;
    const racing = this.runners.filter((r) => r.state === "racing");
    if (racing.length <= 2) return; // keep some company to the end
    this.victim = racing.reduce((a, b) => (a.lagMs > b.lagMs ? a : b));
  }

  private updateRunners(dt: number, light: Light): void {
    const kRun = 1 - Math.exp(-dt / 180);
    for (const r of this.runners) {
      if (r.state === "dead") {
        r.fallT = Math.min(1, r.fallT + dt / 450);
        r.group.rotation.x = -r.fallT * (Math.PI / 2 - 0.15);
        r.group.position.y = r.baseY - r.fallT * 0.55 * r.scale;
        continue;
      }

      // Obey the light with this runner's reaction lag; the victim "doesn't
      // hear it" until the kill window catches them.
      const sinceRed = this.t - this.redAt;
      let wants = light === "green" ? 1 : sinceRed < r.lagMs ? 1 : 0;
      if (light === "red" && r === this.victim) {
        wants = 1;
        if (sinceRed >= this.turnMs + this.curGrace + 200) {
          r.state = "dead";
          r.skull.material = this.eyeMat; // the caught flash: eye-lamp red
          continue;
        }
      }
      if (r.state === "finished") wants = 0;
      r.running += (wants - r.running) * kRun;

      if (r.state === "racing") {
        r.dist += (r.running * r.speed * MAX_SPEED * dt) / 1000;
        if (r.dist >= this.goal) r.state = "finished";
      }
      r.group.position.z = -r.dist;

      // The run cycle: bob + waddle, arms pumping — dies out as they stop.
      r.phase += (dt / 1000) * RUNNER_HZ * Math.PI * 2 * (0.2 + 0.8 * r.running);
      const s = r.running;
      const celebrate = r.state === "finished" ? Math.abs(Math.sin(this.t / 130)) * 0.25 : 0;
      r.group.position.y = r.baseY + (0.16 * Math.abs(Math.sin(r.phase)) * s + celebrate) * r.scale;
      r.group.rotation.z = 0.08 * Math.sin(r.phase) * s;
      r.arms[0].rotation.x = ARM_SWING * Math.sin(r.phase) * s;
      r.arms[1].rotation.x = -ARM_SWING * Math.sin(r.phase) * s;
    }
  }
}

export const redLightDef: MicrogameDef = {
  id: "redlight",
  title: "Green Light, Red Light",
  headline: "Killer doll wins daytime TV, again",
  prompt: { lead: "move to", action: "RUN" },
  hint: "move your head or body to run · freeze when the doll turns red",
  durationMs: DURATION_MS,
  create(canvas, session, level) {
    const avatar = session.attachAvatar(canvas, RedLightAvatar);
    // The playfield div (the canvas's positioned parent) hosts the light pill.
    return new RedLightGame(avatar, session, level, canvas.parentElement!);
  },
};
