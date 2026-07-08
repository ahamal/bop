// Fake It Till You Make It — microgame #2, "Dance". A hologram idol group
// rocks side to side on every beat; on instruction beats a move chip drops
// down the 2D rhythm panel on the right, and when it reaches the hit slot you
// (and the dancers — they lead, you copy) must be DOING that move: look left,
// look right, tilt left, tilt right, or back to center. Hit enough of the
// moves to pass; the run's 10s clock never gets to speak because the last
// chip resolves the round on its own.
//
// The stage is 3D in the avatar's scene (same crystal aesthetic): two rows of
// faceted backup dancers with a nose so their head turns read, all snapping
// their heads to the dropped instruction on its beat. The rhythm panel is
// deliberately NOT 3D — icons + words want crisp type, so the game builds a
// DOM overlay inside the playfield div (the canvas's parent) and animates the
// chips imperatively, style.transform per frame. That keeps the engine/React
// split intact: React never sees per-frame data, and the game removes its own
// DOM on dispose.
//
// Judging: moves read f.dominant — the single most-engaged gesture the
// tracking layer already maintains — inside a ±JUDGE_MS window around the
// chip's beat. CENTER is judged on raw head angles instead: dominant only
// returns to "neutral" after every gesture re-arms past its exit hysteresis
// (10° yaw / 6° roll — much tighter than the 21°/12° enters), so a
// half-returned head still read as the old move and center chips kept
// missing. Center = not turned and not tilted, on the two axes the game
// uses, with its own generous tolerance. It also passes while idle, which is
// intended: "return to center" is the rest between moves, not a trick.

import * as THREE from "three";
import type { FrameResult, TrackingSession } from "../../tracking/session.ts";
import type { Level, Microgame, MicrogameDef } from "../registry.ts";
import { playTick } from "../../audio/sfx.ts";
import { DanceAvatar } from "./avatar.ts";

type DanceMove = "lookLeft" | "lookRight" | "tiltLeft" | "tiltRight" | "center";

// Per-level tempo, indexed by level-1 (the run samples tiers 1/3/5). Higher
// levels beat faster, DROP a move on more of the beats (every 2nd by the top
// tier, not every 4th), and — the key pressure — the chips FALL faster
// (shorter LEAD), so there's less time to read each move as it comes in.
const BPM = [112, 126, 140, 150, 150];
const DROP_EVERY = [4, 4, 3, 3, 3];
const LEAD_MS = [1700, 1550, 1400, 1300, 1300]; // chip fall time, tightens per level

const FIRST_HIT_MS = 2200; // first chip reaches the hit slot here
const LAST_HIT_MS = 13_500; // last one, inside this game's (longer) clock
const CLOCK_MS = 15_000; // the run is longer than the standard 10s
const JUDGE_MS = 350; // ± window around the beat that counts as on-time
// "Back to center" tolerance (degrees from neutral) on the axes the moves
// use. Inside the look/tilt enter thresholds, so a centered head can't also
// be a move, but far looser than the gestures' own exit hysteresis.
const CENTER_YAW_DEG = 13;
const CENTER_ROLL_DEG = 9;
const LINGER_MS = 400; // let the last hit/miss read before resolving
const HIT_ANIM_MS = 220; // hit chips pop and fade over this long

// Formation: two rows of faceted dancers behind the player (front and center).
// Both rows stand ON the floor — their y is set so each row's feet meet the
// tile surface (the back row is smaller and deeper, so perspective alone lifts
// it up the screen; no manual height offset).
const ROWS = [
  { xs: [-2.4, -1.2, 1.2, 2.4], y: -1.92, z: -0.9, scale: 0.48 },
  { xs: [-3.0, -1.7, 0, 1.7, 3.0], y: -1.95, z: -2.3, scale: 0.42 },
];
const ROCK_RAD = 0.14; // body sway amplitude (radians), one side per beat
const BOUNCE = 0.07; // beat bounce height (world units)
const HEAD_EASE_MS = 130; // dancer head ease toward the choreography pose
// Dancers LEAD the player: they start the move this long before the chip
// reaches the slot, so they're visibly in pose as it lands and you copy them
// on the beat (still comfortably inside the ±JUDGE_MS window).
const DANCER_LEAD_MS = 650;
// Dancer head pose per move (screen-mirrored like the player: lookLeft turns
// the head toward screen-left, tiltLeft drops the ear toward screen-left).
const HEAD_YAW: Partial<Record<DanceMove, number>> = { lookLeft: -0.95, lookRight: 0.95 };
const HEAD_ROLL: Partial<Record<DanceMove, number>> = { tiltLeft: 0.5, tiltRight: -0.5 };

// The 2D panel: chip icon + instruction per move, and the accent colors.
const CHIP: Record<DanceMove, { icon: string; label: string; color: string }> = {
  lookLeft: { icon: "←", label: "look left", color: "#22d3ee" },
  lookRight: { icon: "→", label: "look right", color: "#22d3ee" },
  // Tilts don't get a glyph — arrows (straight or curved) kept reading as
  // "move" or "spin". makeChip draws a tiny head-and-shoulders pictogram with
  // the head tipped to that side instead; icon stays empty here.
  tiltLeft: { icon: "", label: "tilt left", color: "#c084fc" },
  tiltRight: { icon: "", label: "tilt right", color: "#c084fc" },
  center: { icon: "◎", label: "center", color: "#34d399" },
};
// Disco: four sweeping light colors, a mirror ball, and a flashing floor —
// all beat-driven in update(). Classic club palette (hot pink, cyan, gold,
// violet) so each orbiting light washes the faceted dancers a different hue.
const DISCO_COLORS = [0xff2d95, 0x22d3ee, 0xf5c518, 0x8b5cf6];
const PANEL_W = 92; // px
const HIT_FRAC = 0.74; // hit slot sits this far down the panel
const MISS_COLOR = "#f87171";

interface Token {
  move: DanceMove;
  beatAt: number; // game-time ms when it reaches the hit slot
  el: HTMLDivElement | null; // spawned once it's LEAD_MS out
  state: "pending" | "hit" | "miss";
  animMs: number; // remaining hit pop-and-fade animation
}

interface Dancer {
  group: THREE.Group;
  head: THREE.Group;
  baseY: number;
  dir: 1 | -1; // alternate rock phase across the row
}

class DanceGame implements Microgame {
  private _outcome: "pending" | "win" | "lose" = "pending";
  private t = 0;
  private beatMs: number;
  private holdMs: number; // how long dancers hold a move before recentering
  private tokens: Token[];
  private needed: number;
  private hits = 0;
  private lastBeat = -1;
  private decidedAt = NaN; // game time the outcome became certain

  private dancers: Dancer[] = [];
  private discoLights: THREE.PointLight[] = [];
  private ball = new THREE.Group();
  private floorTiles: THREE.MeshStandardMaterial[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private panel: HTMLDivElement;
  private slot: HTMLDivElement;

  constructor(
    private avatar: DanceAvatar,
    private session: TrackingSession,
    private level: Level,
    host: HTMLElement,
  ) {
    this.beatMs = 60_000 / BPM[level - 1];
    const interval = this.beatMs * DROP_EVERY[level - 1];
    this.holdMs = interval * 0.55;

    // The routine: instruction beats from FIRST to LAST at the level's spacing.
    // Low levels alternate move → center (look left, center, tilt right,
    // center…); level 3+ draws freely with an occasional center, never
    // repeating a move back to back. Looks and tilts from level 1 — the
    // difficulty lives in the tempo, not the vocabulary.
    const pool: DanceMove[] = ["lookLeft", "lookRight", "tiltLeft", "tiltRight"];
    const n = Math.floor((LAST_HIT_MS - FIRST_HIT_MS) / interval) + 1;
    let prev: DanceMove = "center";
    this.tokens = Array.from({ length: n }, (_, i) => {
      let move: DanceMove;
      if (level <= 2 && i % 2 === 1) {
        move = "center";
      } else if (level >= 3 && prev !== "center" && Math.random() < 0.25) {
        move = "center";
      } else {
        const options = pool.filter((m) => m !== prev);
        move = options[Math.floor(Math.random() * options.length)];
      }
      prev = move;
      return { move, beatAt: FIRST_HIT_MS + i * interval, el: null, state: "pending" as const, animMs: 0 };
    });
    this.needed = Math.ceil((n * 2) / 3);

    // --- The 3D stage: dancers (shared GPU resources tracked for dispose). ---
    const mat = (color: number): THREE.MeshStandardMaterial => {
      const m = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.5,
        metalness: 0.1,
        flatShading: true,
      });
      this.mats.push(m);
      return m;
    };
    const geo = <G extends THREE.BufferGeometry>(g: G): G => {
      this.geos.push(g);
      return g;
    };
    // The troupe alternates female/male across the formation. Same faceted
    // hologram look for everyone; the read comes from silhouette — flared
    // dress cone vs straight torso — plus a nose so the head moves are
    // legible.
    // Female: flared dress, truncated (a full cone came to a spike at the
    // neck); male: straight torso. Heads get a detail level so they read
    // round, not gem-cut.
    const dressGeo = geo(new THREE.CylinderGeometry(0.17, 0.52, 1.15, 6));
    const torsoGeo = geo(new THREE.CylinderGeometry(0.3, 0.4, 1.1, 6)); // male: straight
    const headGeo = geo(new THREE.IcosahedronGeometry(0.34, 1));
    // Same nose as the player figure (abstractParts.ts), at dancer scale: a
    // slim triangular prism whose forward vertex forms the ridge — narrower
    // at the bridge, wider at the nostrils.
    // Enough to break the silhouette on a look left/right (the small heads'
    // only yaw cue) without reading as a beak now that the player's nose is
    // small too.
    const noseGeo = geo(new THREE.CylinderGeometry(0.04, 0.078, 0.16, 3));
    const hairGeo = geo(new THREE.SphereGeometry(0.36, 7, 5));
    const tailGeo = geo(new THREE.SphereGeometry(0.12, 6, 4));
    // Shades: two round lens discs, a bridge, and arms running back to the
    // ears (one box bar just read as a blindfold).
    const lensGeo = geo(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 8));
    const bridgeGeo = geo(new THREE.BoxGeometry(0.09, 0.028, 0.028));
    const armGeo = geo(new THREE.BoxGeometry(0.028, 0.028, 0.34));
    const shadesMat = mat(0x0f172a);
    // Hologram indigo, the back row a shade dimmer, so the player stands out.
    // The nose sits just a shade under the head tone — visible, not a beak —
    // and the hair is the head's own hue, just darker.
    const rowMats = [
      { torso: mat(0x818cf8), head: mat(0xa5b4fc), nose: mat(0x939ef9), hair: mat(0x6e7ade) },
      { torso: mat(0x6672d8), head: mat(0x8a93e8), nose: mat(0x7a84dd), hair: mat(0x5a63bd) },
    ];
    ROWS.forEach((row, r) => {
      for (const x of row.xs) {
        const i = this.dancers.length;
        const female = i % 2 === 0;
        const group = new THREE.Group();
        const torso = new THREE.Mesh(female ? dressGeo : torsoGeo, rowMats[r].torso);
        torso.position.y = 0.1;
        const head = new THREE.Group();
        head.position.y = 1.05;
        const skull = new THREE.Mesh(headGeo, rowMats[r].head);
        skull.scale.set(0.94, 1.06, 0.96); // a touch oval — taller than wide
        head.add(skull);
        // Placed like the player's: ridge along the middle third of the
        // face, tilted so the tip juts out more than the bridge.
        const nose = new THREE.Mesh(noseGeo, rowMats[r].nose);
        nose.scale.set(0.8, 1, 0.75);
        nose.position.set(0, -0.05, 0.34);
        nose.rotation.x = -0.22;
        head.add(nose);
        // Hair — the head's hue, darker: a full back-swept cap + ponytail on
        // the women, a cropped cap on the men.
        const hair = new THREE.Mesh(hairGeo, rowMats[r].hair);
        if (female) {
          hair.scale.set(1.0, 0.92, 0.95);
          hair.position.set(0, 0.13, -0.11);
          const tail = new THREE.Mesh(tailGeo, rowMats[r].hair);
          tail.scale.set(1, 2.2, 1);
          tail.position.set(0, -0.1, -0.37);
          head.add(tail);
        } else {
          hair.scale.set(0.96, 0.55, 0.9);
          hair.position.set(0, 0.23, -0.06);
        }
        head.add(hair);
        // A few of them are too famous to be recognized: round shades —
        // one up front, two scattered through the back row.
        if (i === 1 || i === 4 || i === 7) {
          const shades = new THREE.Group();
          for (const side of [-1, 1]) {
            const lens = new THREE.Mesh(lensGeo, shadesMat);
            lens.rotation.x = Math.PI / 2; // disc faces forward
            lens.rotation.z = side * 0.12; // follow the skull's curve a touch
            lens.position.set(side * 0.13, 0, 0);
            shades.add(lens);
            const arm = new THREE.Mesh(armGeo, shadesMat);
            arm.position.set(side * 0.24, 0.02, -0.16);
            arm.rotation.y = side * 0.28; // hug the temples
            shades.add(arm);
          }
          const bridge = new THREE.Mesh(bridgeGeo, shadesMat);
          bridge.position.set(0, 0.02, 0.01);
          shades.add(bridge);
          shades.position.set(0, 0.07, 0.3);
          head.add(shades);
        }
        group.add(torso, head);
        group.scale.setScalar(row.scale);
        group.position.set(x, row.y, row.z);
        this.avatar.stageGroup.add(group);
        this.dancers.push({ group, head, baseY: row.y, dir: i % 2 === 0 ? 1 : -1 });
      }
    });

    // --- Disco kit: sweeping colored lights, a mirror ball, and a glowing
    // floor. All parented to stageGroup so they tear down with the avatar;
    // update() drives their orbit, spin, and beat-flash. ---
    for (const color of DISCO_COLORS) {
      const light = new THREE.PointLight(color, 0, 26, 1.4);
      this.discoLights.push(light);
      this.avatar.stageGroup.add(light);
    }

    // Mirror ball: a metallic faceted sphere on a thin cord, up over the back
    // row, catching each orbiting light as it spins.
    const ballMat = mat(0xdfe6f2);
    ballMat.metalness = 1;
    ballMat.roughness = 0.22;
    ballMat.emissive = new THREE.Color(0x5566aa);
    ballMat.emissiveIntensity = 0.25;
    const ballMesh = new THREE.Mesh(geo(new THREE.IcosahedronGeometry(0.5, 1)), ballMat);
    const cord = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.014, 0.014, 1.5, 4)), mat(0x1b2333));
    cord.position.y = 1.25;
    this.ball.add(ballMesh, cord);
    this.ball.position.set(0, 1.8, -1.6);
    this.avatar.stageGroup.add(this.ball);

    // Floor grid: emissive tiles under the troupe that flash on the beat.
    const tileGeo = geo(new THREE.BoxGeometry(2.1, 0.08, 2.1));
    for (let gx = -2; gx <= 2; gx++) {
      for (let gz = 0; gz <= 2; gz++) {
        const tm = mat(0x11162a);
        tm.emissive = new THREE.Color(0x11162a);
        tm.emissiveIntensity = 0.15;
        this.floorTiles.push(tm);
        const tile = new THREE.Mesh(tileGeo, tm);
        tile.position.set(gx * 2.24, -2.15, -0.4 - gz * 2.3);
        this.avatar.stageGroup.add(tile);
      }
    }

    // --- The 2D rhythm panel, overlaid on the playfield div. The host clips
    // (overflow hidden), so chips can spawn above the visible top. ---
    this.panel = document.createElement("div");
    this.panel.style.cssText =
      `position:absolute;top:0;bottom:0;right:10px;width:${PANEL_W}px;` +
      "pointer-events:none;background:linear-gradient(rgba(15,23,42,0.12),rgba(15,23,42,0.3));";
    this.slot = document.createElement("div");
    this.slot.style.cssText =
      `position:absolute;left:4px;right:4px;top:${HIT_FRAC * 100}%;height:52px;` +
      "transform:translateY(-50%);border:2px solid rgba(226,232,240,0.9);" +
      "border-radius:12px;will-change:opacity;";
    this.panel.appendChild(this.slot);
    host.appendChild(this.panel);
  }

  get outcome(): "pending" | "win" | "lose" {
    return this._outcome;
  }

  get hud(): string {
    return `${this.hits} / ${this.needed}`;
  }

  dispose(): void {
    this.panel.remove();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.session.detachAvatar();
  }

  update(f: FrameResult, dt: number): void {
    this.t += dt;

    // Metronome: a quiet tick every beat keeps the pulse audible over
    // whatever arcade track is playing; the hit slot pulses in sync.
    const beat = Math.floor(this.t / this.beatMs);
    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      playTick(false);
    }
    const beatFrac = (this.t % this.beatMs) / this.beatMs;
    this.slot.style.opacity = `${0.55 + 0.45 * Math.max(0, 1 - beatFrac * 4)}`;

    // The formation rocks: one sway per beat (full period two beats), a small
    // bounce on each, neighbors in opposite phase. Dancers lead the current
    // move with their heads, easing back to center after the hold.
    const sway = Math.sin((Math.PI * this.t) / this.beatMs);
    const cur = this.currentMove();
    const kHead = 1 - Math.exp(-dt / HEAD_EASE_MS);
    for (const d of this.dancers) {
      d.group.rotation.z = ROCK_RAD * sway * d.dir;
      d.group.position.y = d.baseY + BOUNCE * Math.abs(sway);
      d.head.rotation.y += ((HEAD_YAW[cur] ?? 0) - d.head.rotation.y) * kHead;
      d.head.rotation.z += ((HEAD_ROLL[cur] ?? 0) - d.head.rotation.z) * kHead;
    }

    // Disco: the colored lights orbit the floor and flare on each beat, the
    // mirror ball spins, and the floor tiles flash the beat's color. A sharp
    // attack (bright on the beat, decaying over it) gives the club its pulse.
    const beatPulse = Math.max(0, 1 - beatFrac * 3);
    const orbit = this.t / 1400;
    this.discoLights.forEach((light, i) => {
      const a = orbit + (i / this.discoLights.length) * Math.PI * 2;
      light.position.set(Math.cos(a) * 3.2, 2.4 + Math.sin(a * 1.3) * 0.6, -1 + Math.sin(a) * 1.6);
      light.intensity = 6 + 11 * beatPulse;
    });
    this.ball.rotation.y += dt * 0.0016;
    this.floorTiles.forEach((tm, i) => {
      tm.emissive.setHex(DISCO_COLORS[(beat + i) % DISCO_COLORS.length]);
      tm.emissiveIntensity = (beat + i) % 3 === 0 ? 0.12 + 0.85 * beatPulse : 0.08;
    });

    // Chips: spawn LEAD_MS out, ride the panel down (px mapped from time so
    // arrival at the slot IS the beat), judge inside the window.
    const lead = LEAD_MS[this.level - 1];
    const panelH = this.panel.clientHeight || 1;
    const hitPx = panelH * HIT_FRAC;
    const pxPerMs = (hitPx + 70) / lead; // spawn ~70px above the panel top
    for (const tok of this.tokens) {
      const dueIn = tok.beatAt - this.t;
      if (tok.state === "hit") {
        if (!tok.el) continue;
        // Pop toward the slot and fade away.
        tok.animMs -= dt;
        const p = Math.max(0, tok.animMs / HIT_ANIM_MS);
        tok.el.style.opacity = `${p}`;
        tok.el.style.transform = `translateY(${hitPx}px) translateY(-50%) scale(${1 + 0.35 * (1 - p)})`;
        if (tok.animMs <= 0) {
          tok.el.remove();
          tok.el = null;
        }
        continue;
      }
      if (tok.state === "pending" && !tok.el && dueIn <= lead) {
        tok.el = this.makeChip(tok.move);
        this.panel.appendChild(tok.el);
      }
      if (tok.el) {
        const y = hitPx - dueIn * pxPerMs;
        tok.el.style.transform = `translateY(${y}px) translateY(-50%)`;
        if (tok.state === "miss" && y > panelH + 60) {
          tok.el.remove();
          tok.el = null;
        }
      }
      if (tok.state === "pending") {
        const matches =
          tok.move === "center"
            ? Math.abs(f.metrics.headYaw) <= CENTER_YAW_DEG &&
              Math.abs(f.metrics.headRoll) <= CENTER_ROLL_DEG
            : f.dominant === tok.move;
        if (Math.abs(dueIn) <= JUDGE_MS && matches) {
          tok.state = "hit";
          tok.animMs = HIT_ANIM_MS;
          this.hits += 1;
          playTick(true);
          if (tok.el) tok.el.style.borderColor = CHIP[tok.move].color;
        } else if (-dueIn > JUDGE_MS) {
          tok.state = "miss"; // keeps falling past the slot, then vanishes
          if (tok.el) {
            tok.el.style.borderColor = MISS_COLOR;
            tok.el.style.opacity = "0.45";
          }
        }
      }
    }

    // Outcome: decided the moment it's mathematically settled (enough hits,
    // or too few chips left to reach the bar), resolved after a short linger
    // so the last flash lands — always before the director's 10s clock.
    if (this._outcome === "pending") {
      if (Number.isNaN(this.decidedAt)) {
        const pending = this.tokens.filter((tk) => tk.state === "pending").length;
        if (this.hits >= this.needed || this.hits + pending < this.needed) {
          this.decidedAt = this.t;
        }
      } else if (this.t - this.decidedAt >= LINGER_MS) {
        this._outcome = this.hits >= this.needed ? "win" : "lose";
      }
    }
  }

  // A dropping chip: big icon on top, the instruction under it.
  private makeChip(move: DanceMove): HTMLDivElement {
    const { icon, label, color } = CHIP[move];
    const el = document.createElement("div");
    el.style.cssText =
      "position:absolute;left:50%;top:0;width:76px;margin-left:-38px;" +
      "display:flex;flex-direction:column;align-items:center;gap:1px;" +
      "padding:5px 2px;border-radius:12px;border:2px solid transparent;" +
      "background:rgba(15,23,42,0.72);will-change:transform;text-align:center;";
    if (move === "tiltLeft" || move === "tiltRight") {
      el.appendChild(makeTiltIcon(move === "tiltLeft" ? -1 : 1, color));
    } else {
      const iconEl = document.createElement("span");
      iconEl.textContent = icon;
      iconEl.style.cssText = `font-size:22px;line-height:1;font-weight:700;color:${color};`;
      el.appendChild(iconEl);
    }
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    labelEl.style.cssText =
      "font-size:10px;font-weight:600;letter-spacing:0.04em;color:#e2e8f0;text-transform:uppercase;";
    el.appendChild(labelEl);
    return el;
  }

  // What the dancers are doing right now: the latest instruction whose beat
  // is landed OR imminent (they lead by DANCER_LEAD_MS — in pose right before
  // the chip enters the slot), held for a while, then back to center.
  private currentMove(): DanceMove {
    const tLead = this.t + DANCER_LEAD_MS;
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      const tok = this.tokens[i];
      if (tok.beatAt <= tLead) {
        return tLead - tok.beatAt <= this.holdMs ? tok.move : "center";
      }
    }
    return "center";
  }
}

// The tilt pictogram: an egg-shaped head tipping from a shoulder bar, hinged
// at the neck. Mirrors the player's view — tilt left tips toward screen-left.
function makeTiltIcon(side: -1 | 1, color: string): HTMLElement {
  const wrap = document.createElement("span");
  wrap.style.cssText = "position:relative;display:block;width:28px;height:22px;";
  const shoulders = document.createElement("span");
  shoulders.style.cssText =
    `position:absolute;left:2px;right:2px;bottom:0;height:4px;border-radius:2px;` +
    `background:${color};opacity:0.5;`;
  const head = document.createElement("span");
  head.style.cssText =
    "position:absolute;left:50%;bottom:5px;width:12px;height:15px;margin-left:-6px;" +
    `border-radius:50% 50% 46% 46%;background:${color};` +
    `transform:rotate(${side * 34}deg);transform-origin:50% 100%;`;
  wrap.append(shoulders, head);
  return wrap;
}

export const danceDef: MicrogameDef = {
  id: "dance",
  title: "Fake It Till You Make It",
  prompt: { lead: "copy the", action: "DANCE" },
  hint: "do the falling move when it reaches the slot · ◎ = back to center",
  durationMs: CLOCK_MS,
  create(canvas, session, level) {
    const avatar = session.attachAvatar(canvas, DanceAvatar);
    // The playfield div (the canvas's positioned parent) hosts the 2D panel.
    return new DanceGame(avatar, session, level, canvas.parentElement!);
  },
};
