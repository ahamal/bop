// Chomp — microgame #1, "Eat". Fruit tumbles from the top of the playfield;
// you slide the avatar under it by LEANING — shoulder tilt → x, same mirror
// handedness as everywhere else — and eat it with your mouth wide open at
// contact. The head is free to look around; it steers nothing.
//
// The playfield IS the avatar's three.js scene: the real AbstractAvatar (via
// ChompAvatar) slides along the bottom with its mouth mirroring yours. What
// falls is low-poly composite fruit (apple, orange, banana, grapes,
// strawberry — flat-shaded groups, same crystal aesthetic as the figure),
// mixed with random NOT-food (hammer, plate, pen, football) in giveaway
// greys/browns: chomp one of those and the round is lost on the spot — keep
// the mouth shut and let it pass. This engine owns game state and the
// meshes; rendering belongs to the avatar's own loop.
//
// Microgame shape: eat QUOTA fruit before the director's 10s clock runs out.
// A fruit COUNTS when it's swallowed — the shrink-into-the-mouth animation
// finishing — not at first contact, so the score and the win land exactly
// when the food disappears. Level raises the quota, the pace, and how often
// junk drops. Spawn x alternates screen halves so play sweeps the neck
// through its range instead of rewarding center-hovering.

import * as THREE from "three";
import type { FrameResult, TrackingSession } from "../../tracking/session.ts";
import type { Level, Microgame, MicrogameDef } from "../registry.ts";
import { playTick } from "../../audio/sfx.ts";
import { soccerBallFactory, type PropFactory } from "../props.ts";
import { ChompAvatar, ITEM_Z, MOUTH_Y } from "./avatar.ts";

// Shoulder tilt (deg) that reaches the slide bound — a comfortable lean, not a
// stretch. Steering is torso-only: metrics.torsoTilt is relative to the
// calibrated neutral and mirrored, so leaning right moves screen-right.
const TILT_RANGE_DEG = 11;
const LEAN_SMOOTH_MS = 130; // EMA on the slide position (shoulder tilt jitters)
const MOUTH_SMOOTH_MS = 70; // light EMA on mouthOpen
const MOUTH_EAT = 0.32; // open at least this much at contact to eat
const EAT_ANIM_MS = 160; // eaten fruit shrinks into the mouth over this long

// World geometry. The camera's vertical fov is fixed (y ≈ -3.3..2.1 at z = 0),
// so the visible width scales with the frame's aspect: at 8:7 it's x ≈ ±3.05.
const X_BOUND = 2.3; // slide range and spawn band, inside the 8:7 view
const TOP_Y = 2.6; // spawn just above the visible top
const FLOOR_Y = -3.4; // past the visible bottom = gone
const EAT_R = 0.75; // mouth-zone radius (generous relative to the small avatar)

// Per-level tuning, indexed by level-1. Fall time top→floor is ~6/vy ms, so
// even level 1 gets 2-3 catchable fruit well inside the 10s clock.
const QUOTA = [3, 4, 5, 6, 6];
const SPAWN_MS = [950, 880, 800, 720, 600];
const FALL_VY = [0.002, 0.0023, 0.0026, 0.0029, 0.0032];
const JUNK_CHANCE = [0.12, 0.16, 0.2, 0.25, 0.3]; // odds a drop is NOT food

// Consecutive drops land a bounded step apart — the spawn point walks across
// the band and turns around at the edges, so the neck still sweeps its whole
// range but never has to teleport from one side to the other.
const STEP_MIN = 0.55;
const STEP_MAX = 1.15;

interface Item {
  obj: THREE.Object3D;
  vy: number; // world units per ms (downward)
  spin: THREE.Vector3; // radians per ms, per axis
  junk: boolean;
  /** ms left of the shrink-into-the-mouth animation; NaN while still falling. */
  eatMs: number;
}

class ChompMicrogame implements Microgame {
  private _outcome: "pending" | "win" | "lose" = "pending";
  private score = 0;
  private items: Item[] = [];
  private spawnIn = 350;
  private spawnX = 0; // where the last drop fell; the next steps from here
  private spawnDir: -1 | 1 = Math.random() < 0.5 ? -1 : 1;
  private xNorm = 0; // smoothed head position, -1..1
  private mouth = 0; // smoothed mouthOpen

  private fruitKinds: (() => THREE.Object3D)[];
  private junkKinds: (() => THREE.Object3D)[];
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private soccer: PropFactory = soccerBallFactory(0.24);

  constructor(
    private avatar: ChompAvatar,
    private session: TrackingSession,
    private level: Level,
  ) {
    // Shared GPU resources; the builders below compose them into per-item
    // groups, so a dropped apple costs meshes but no new geometry/materials.
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

    // Fruit bodies are low-segment SPHERES, not icosahedra — with flat shading
    // they still facet, but the silhouette reads round like produce, not like
    // a gem. Leaves are squashed spheres (blobby, organic), and the fruit
    // materials are glossier than the junk's so they look juicy.
    const appleBody = geo(new THREE.SphereGeometry(0.25, 9, 7));
    const orangeBody = geo(new THREE.SphereGeometry(0.24, 8, 6));
    const stem = geo(new THREE.CylinderGeometry(0.018, 0.032, 0.15, 5));
    const leaf = geo(new THREE.SphereGeometry(0.1, 6, 4));
    // A gentle ~109° arc of a bigger circle — a semicircle read as a handle,
    // not a banana; real ones only bend about a quarter turn.
    const BANANA_ARC = 1.9;
    const BANANA_R = 0.42;
    const bananaGeo = geo(new THREE.TorusGeometry(BANANA_R, 0.095, 7, 12, BANANA_ARC));
    const bananaTip = geo(new THREE.IcosahedronGeometry(0.05, 0));
    const grapeBall = geo(new THREE.SphereGeometry(0.095, 7, 5));
    // Strawberry body from a lathe profile — plump shoulders curving to a
    // rounded tip. (A straight cone faceted like a cut diamond, not a berry.)
    const berryBody = geo(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.0, -0.24),
          new THREE.Vector2(0.075, -0.16),
          new THREE.Vector2(0.135, -0.06),
          new THREE.Vector2(0.17, 0.05),
          new THREE.Vector2(0.155, 0.13),
          new THREE.Vector2(0.09, 0.18),
          new THREE.Vector2(0.0, 0.2),
        ],
        8,
      ),
    );
    const berryLeaf = geo(new THREE.ConeGeometry(0.06, 0.16, 4));

    const appleRed = mat(0xe0453a, 0.38);
    const orange = mat(0xfb923c, 0.42);
    const yellow = mat(0xfde047, 0.42);
    const purple = mat(0x9d5ce8, 0.38);
    const berryRose = mat(0xf43f5e, 0.38);
    const green = mat(0x4ade80, 0.5);
    const stemBrown = mat(0x8a5a33);

    // Fruits: recognizable silhouettes from a handful of flat-shaded parts.
    const apple = () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(appleBody, appleRed);
      body.scale.y = 0.88; // squat, apple-round
      const s = new THREE.Mesh(stem, stemBrown);
      s.position.y = 0.26;
      s.rotation.z = 0.18;
      const l = new THREE.Mesh(leaf, green);
      l.scale.set(1.5, 0.45, 0.8);
      l.position.set(0.13, 0.27, 0);
      l.rotation.z = -0.5;
      g.add(body, s, l);
      return g;
    };
    const orangeFruit = () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(orangeBody, orange);
      const s = new THREE.Mesh(stem, stemBrown);
      s.scale.setScalar(0.6);
      s.position.y = 0.25;
      // A pair of leaves splayed at the stem — the classic orange give-away.
      for (const dir of [-1, 1]) {
        const l = new THREE.Mesh(leaf, green);
        l.scale.set(1.4, 0.4, 0.7);
        l.position.set(dir * 0.11, 0.26, 0);
        l.rotation.z = dir * -0.55;
        g.add(l);
      }
      g.add(body, s);
      return g;
    };
    const banana = () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(bananaGeo, yellow);
      // Rotate the arc symmetric about vertical and drop it so the curve
      // straddles the group origin (it tumbles anyway — centering is what
      // matters, not which way the smile points).
      body.rotation.z = Math.PI / 2 - BANANA_ARC / 2;
      body.position.y = -BANANA_R;
      g.add(body);
      // Brown nubs cap the arc's open ends — instantly banana.
      const endX = Math.sin(BANANA_ARC / 2) * BANANA_R;
      const endY = Math.cos(BANANA_ARC / 2) * BANANA_R - BANANA_R;
      for (const x of [-endX, endX]) {
        const tip = new THREE.Mesh(bananaTip, stemBrown);
        tip.scale.setScalar(1.7); // keep the nubs proud of the fatter tube
        tip.position.set(x, endY, 0);
        g.add(tip);
      }
      g.scale.setScalar(0.9); // long fruit; keep it in family with the others
      return g;
    };
    const grapes = () => {
      const g = new THREE.Group();
      // A 3-2-1 pyramid with a back layer for volume, jittered so the
      // cluster looks bunched rather than stacked.
      const offsets: [number, number, number][] = [
        [-0.1, 0.12, 0.02],
        [0, 0.13, -0.03],
        [0.1, 0.12, 0.02],
        [-0.05, 0.0, 0.04],
        [0.06, 0.01, 0.04],
        [0.0, 0.02, -0.08],
        [0.0, -0.11, 0.0],
        [-0.08, -0.05, -0.05],
      ];
      for (const [x, y, z] of offsets) {
        const ball = new THREE.Mesh(grapeBall, purple);
        ball.position.set(x, y, z);
        g.add(ball);
      }
      const s = new THREE.Mesh(stem, stemBrown);
      s.position.y = 0.27;
      const l = new THREE.Mesh(leaf, green);
      l.scale.set(1.4, 0.4, 0.8);
      l.position.set(0.1, 0.26, 0);
      l.rotation.z = -0.6;
      g.add(s, l);
      return g;
    };
    const strawberry = () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(berryBody, berryRose); // lathe tip already points down
      // A splayed crown of little leaves around the top, plus a stem.
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + 0.4;
        const l = new THREE.Mesh(berryLeaf, green);
        // Splayed out onto the crown (the body is ~0.12 wide up here, so a
        // tighter radius buried them) and lifted to sit on top, not inside.
        l.position.set(Math.cos(a) * 0.13, 0.2, Math.sin(a) * 0.13);
        l.rotation.set(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1);
        g.add(l);
      }
      const s = new THREE.Mesh(stem, green);
      s.scale.setScalar(0.55);
      s.position.y = 0.22;
      g.add(body, s);
      return g;
    };
    this.fruitKinds = [apple, orangeFruit, banana, grapes, strawberry];

    // NOT food — household props in muted greys/browns, silhouettes nothing
    // like the fruit. Chomping one loses the round.
    const handleGeo = geo(new THREE.CylinderGeometry(0.035, 0.035, 0.44, 6));
    const hammerHeadGeo = geo(new THREE.BoxGeometry(0.3, 0.13, 0.13));
    const plateGeo = geo(new THREE.CylinderGeometry(0.28, 0.21, 0.055, 10));
    const penTipGeo = geo(new THREE.ConeGeometry(0.032, 0.09, 6));

    const darkGrey = mat(0x475569);
    const wood = mat(0xb08d57);
    const plateWhite = mat(0xe2e8f0);
    const penBlue = mat(0x3b82f6);

    const hammer = () => {
      const g = new THREE.Group();
      const handle = new THREE.Mesh(handleGeo, wood);
      const head = new THREE.Mesh(hammerHeadGeo, darkGrey);
      head.position.y = 0.24;
      g.add(handle, head);
      return g;
    };
    const plate = () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(plateGeo, plateWhite));
      return g;
    };
    const pen = () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(handleGeo, penBlue);
      body.scale.set(0.85, 0.9, 0.85);
      const tip = new THREE.Mesh(penTipGeo, darkGrey);
      tip.position.y = -0.24;
      tip.rotation.x = Math.PI;
      g.add(body, tip);
      return g;
    };
    // The soccer ball comes from the shared prop kit (Header! reuses it).
    const football = () => this.soccer.build();
    this.junkKinds = [hammer, plate, pen, football];
  }

  get outcome(): "pending" | "win" | "lose" {
    return this._outcome;
  }

  get hud(): string {
    return `${this.score} / ${QUOTA[this.level - 1]}`;
  }

  /** Release the shared GPU resources and give the playfield canvas back. */
  dispose(): void {
    this.clearItems();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.soccer.dispose();
    this.session.detachAvatar();
  }

  /** Advance one frame. Called by the director; the avatar's loop draws it. */
  update(f: FrameResult, dt: number): void {
    // Inputs: shoulder lean → slide, mouthOpen ratio. Both lightly smoothed.
    // torsoTilt's mirrored sign matches head roll (lean left = positive), and
    // screen-left is -x, hence the negation. When the shoulders aren't
    // trackable this frame, the slide just holds where it is.
    if (f.metrics.bodyTracked) {
      const kx = 1 - Math.exp(-dt / LEAN_SMOOTH_MS);
      const target = Math.max(-1, Math.min(1, -f.metrics.torsoTilt / TILT_RANGE_DEG));
      this.xNorm += (target - this.xNorm) * kx;
    }
    if (f.expression) {
      const km = 1 - Math.exp(-dt / MOUTH_SMOOTH_MS);
      this.mouth += (f.expression.mouthOpen - this.mouth) * km;
    }
    const slideX = this.xNorm * X_BOUND;
    this.avatar.setSlide(slideX);

    if (this._outcome !== "pending") return;
    const lv = this.level - 1;

    // Spawning: the drop point random-walks a bounded step at a time,
    // reversing at the edges — a sweep, not a jump; every drop rolls against
    // the level's junk chance.
    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      this.spawnIn = SPAWN_MS[lv];
      let x = this.spawnX + this.spawnDir * (STEP_MIN + Math.random() * (STEP_MAX - STEP_MIN));
      if (Math.abs(x) > X_BOUND) {
        this.spawnDir = -this.spawnDir as -1 | 1;
        x = Math.max(-X_BOUND, Math.min(X_BOUND, x)) + this.spawnDir * 0.2;
      }
      this.spawnX = x;
      const junk = Math.random() < JUNK_CHANCE[lv];
      const pool = junk ? this.junkKinds : this.fruitKinds;
      const obj = pool[Math.floor(Math.random() * pool.length)]();
      // Fall in the mouth's plane, so contact reads as "right at the lips".
      obj.position.set(x, TOP_Y, ITEM_Z);
      obj.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      this.avatar.itemsGroup.add(obj);
      this.items.push({
        obj,
        vy: FALL_VY[lv],
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 0.004,
          (Math.random() - 0.5) * 0.004,
          (Math.random() - 0.5) * 0.002,
        ),
        junk,
        eatMs: NaN,
      });
    }

    // Fall + tumble + resolve: contact with an open mouth starts the eat
    // animation (shrink into the mouth); the fruit COUNTS — score, tick,
    // quota check — only when that animation finishes and it's truly gone.
    this.items = this.items.filter((it) => {
      const m = it.obj;
      if (!Number.isNaN(it.eatMs)) {
        // Being eaten: chase the mouth and shrink away, then count + vanish.
        it.eatMs -= dt;
        const p = Math.max(0, it.eatMs / EAT_ANIM_MS);
        m.position.x += (slideX - m.position.x) * 0.35;
        m.position.y += (MOUTH_Y - m.position.y) * 0.35;
        m.scale.setScalar(p);
        if (it.eatMs <= 0) {
          this.avatar.itemsGroup.remove(m);
          this.score += 1;
          playTick(true);
          if (this.score >= QUOTA[this.level - 1]) this._outcome = "win";
          return false;
        }
        return true;
      }
      m.position.y -= it.vy * dt;
      m.rotation.x += it.spin.x * dt;
      m.rotation.y += it.spin.y * dt;
      m.rotation.z += it.spin.z * dt;
      if (
        this.mouth >= MOUTH_EAT &&
        Math.hypot(m.position.x - slideX, m.position.y - MOUTH_Y) <= EAT_R
      ) {
        if (it.junk) {
          // Bit the hammer — instant loss; the director plays the fail stinger.
          this._outcome = "lose";
        } else {
          it.eatMs = EAT_ANIM_MS;
        }
        return !it.junk;
      }
      if (m.position.y < FLOOR_Y) {
        // Missed fruit (and dodged junk) just passes by — the quota-vs-clock
        // is the pressure.
        this.avatar.itemsGroup.remove(m);
        return false;
      }
      return true;
    });
  }

  private clearItems(): void {
    for (const it of this.items) this.avatar.itemsGroup.remove(it.obj);
    this.items = [];
  }
}

export const chompDef: MicrogameDef = {
  id: "chomp",
  title: "All You Can Eat",
  prompt: { lead: "open wide and", action: "EAT" },
  hint: "lean to slide · chomp the fruit · don't eat the junk",
  create(canvas, session, level) {
    const avatar = session.attachAvatar(canvas, ChompAvatar);
    return new ChompMicrogame(avatar, session, level);
  },
};
