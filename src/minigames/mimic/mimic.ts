// Prove You're Human — microgame #6, "Mimic". A CAPTCHA memory test: a row
// of 3D cards lies on a felt table tilted toward the camera, above the
// figure, face-up for a few seconds (look left,
// tilt right, open mouth…), then each card FLIPS over, and you must perform
// the sequence from MEMORY, in order. A low-poly pointing hand slides under
// the card you're on; the correct move spins it back face-up with a tick, a
// wrong move flips the card to show what it was — frame flashing red — and
// fails the test. Recall all of them to pass. Movement channel: the full
// gesture vocabulary — all four looks, both tilts, and the mouth — plus
// working memory, the arcade's first cognitive game.
//
// The playfield IS the avatar's scene (MimicAvatar: the figure sits with
// its back to the camera facing the table, true handedness — your left is
// its left is screen-left — and its head/mouth show each move register).
// Cards and hand are real meshes in stageGroup — the flip is a rotation, not
// a CSS trick. Card faces are built from geometry, not text (3D text doesn't
// work — the Dance lesson): arrows from shaft+cone, the tilt pictogram from
// an egg tipping off a shoulder bar, the mouth as an oval ring, and a
// diamond stud for the face-down back.
//
// Judging: head moves use gesture ONSETS (f.events — the tracking layer's
// own enter thresholds + hysteresis, so a held pose can't re-fire), the
// mouth uses the smoothed expression with the open/rearm pattern, starting
// UNARMED so a mouth already open at the whistle can't fire at t=0. After
// the flip-down — and after every correct hit — a short grace window
// ignores input, so the return-to-center overshoot from the last move can't
// read as the next one. Each card allows TWO tries: the first wrong move
// flashes it red and stays on it, the second fails the test. Tuck onsets
// are outside the vocabulary and ignored.
//
// Clock math (durationMs = 26s): deal ~1.1s + study 5.7s + ready 0.8s +
// flip cascade + 6 moves at a leisurely ~2.8s each ≈ 25s — the last card
// resolves inside the clock even at level 5; faster recall wins sooner.

import * as THREE from "three";
import type { FrameResult, TrackingSession } from "../../tracking/session.ts";
import type { GestureName } from "../../tracking/gestures.ts";
import type { Level, Microgame, MicrogameDef } from "../registry.ts";
import { playTick } from "../../audio/sfx.ts";
import { ResourceBag } from "../resources.ts";
import { cardBackTexture, cardFaceTexture, type Move } from "./cardArt.ts";
import { MimicAvatar } from "./avatar.ts";

// The move vocabulary: six head gestures + the mouth (Move lives in
// cardArt.ts with the images). Tuck is deliberately excluded (it's subtle
// on a card and easy to fire accidentally).
const HEAD_MOVES: readonly Move[] = [
  "lookLeft",
  "lookRight",
  "lookUp",
  "lookDown",
  "tiltLeft",
  "tiltRight",
];
const GESTURE_MOVES = new Set<GestureName>([
  "lookLeft",
  "lookRight",
  "lookUp",
  "lookDown",
  "tiltLeft",
  "tiltRight",
]);

// Sequence length per level, indexed by level-1 — the whole difficulty
// curve. Two cards at level 1, six at the top (with two tries per card and
// scaled study time, six plays fair).
const COUNT = [2, 3, 4, 5, 6];

// Study time scales with how much there is to memorize: base + per-card,
// after the deal — one card gets ~2.5s, the full five ~5.1s.
const REVEAL_BASE_MS = 1800;
const REVEAL_PER_CARD_MS = 650;
const READY_MS = 800; // the "READY?" flash between study time and the test
// The deal: cards slide in from off the table's right edge, one per beat.
const DEAL_STAGGER_MS = 100;
const DEAL_SETTLE_MS = 500; // last card's slide comfortably lands in this
const DEAL_EASE_MS = 150;
const DURATION_MS = 26_000; // this game's clock (declared on the def)
// Input grace: ignored windows right after the flip-down and after every
// hit, so the return-to-center overshoot can't judge as the next move.
const GRACE_MS = 400;
// Mouth open/rearm thresholds on the smoothed expression signal.
const MOUTH_OPEN = 0.4;
const MOUTH_REARM = 0.2;
const MOUTH_SMOOTH_MS = 70;
const LINGER_MS = 900; // let the last flip / the red reveal land
// Two tries per card: the first wrong move flashes the card red as a
// warning and stays on it; the second wrong move fails the test.
const TRIES_PER_CARD = 2;
const WARN_FLASH_MS = 300;

// The table: the cards lie on a felt surface tilted toward the camera (a
// dealer's display), and everything — cards, hand, lifts — lives in the
// table's plane. Six cards at this spacing span ±2.36, inside the ±3
// visible at the 8:7 aspect.
// A real tabletop in front of the seated figure: BELOW head height (the
// head is ~y -1.2), laid nearly flat, so the person is looking DOWN at the
// cards on it. More tilt = more physical but more foreshortened card art.
const TABLE_TILT = -0.95; // radians; top edge tips away from the camera
const TABLE_Y = -1.05; // world y of the card row's center
const TABLE_Z = -3.1; // clear of the figure — a table across from them
const CARD_SPACING = 0.95;
const CARD_W = 0.88;
const CARD_H = 1.18;
const CARD_T = 0.05;
// The felt is a FIXED size (sized for the six-card maximum) so the table
// looks the same at every level; fewer cards just leave more green.
const FELT_W = 6.1;
const FELT_H = 3.3;
const FLIP_EASE_MS = 130; // card spin ease toward its target angle
const FLIP_STAGGER_MS = 110; // the flip-down runs card by card, a wave
const HAND_EASE_MS = 120; // hand slide toward the active card
const HAND_Y = -1.15; // table-local: just below the card row
const HAND_BOB = 0.05; // gentle idle along the felt so the hand reads alive

// Face-up rotation is 0; face-down is π. A correct hit continues to 2π —
// a full spin back to face-up, same direction, which reads as a flourish.
const DOWN = Math.PI;
const DONE = Math.PI * 2;

interface Card {
  move: Move;
  group: THREE.Group;
  body: THREE.Mesh; // the slab whose material carries the done/miss verdict
  rot: number;
  target: number;
  downAt: number; // game-time this card's flip-down fires (the cascade)
  finalX: number; // where it lands on the felt
  dealAt: number; // game-time its slide-in starts
}

class MimicGame implements Microgame {
  private _outcome: "pending" | "win" | "lose" = "pending";
  private t = 0;
  private decidedAt = NaN;
  private won = false;

  private cards: Card[] = [];
  private idx = 0; // next card to perform
  private mistakes = 0; // wrong tries on the CURRENT card; resets on advance
  private warnUntil = NaN; // the warning flash on the current card ends here
  private phase: "reveal" | "ready" | "recall" = "reveal";
  private revealEndsAt = 0; // deal + study time; the READY flash starts here
  private readyUntil = 0; // the flash ends and the test begins here
  private graceUntil = 0;

  private mouth = 0;
  private mouthArmed = false; // must close once before the first fire

  private hand: THREE.Group;
  private handX = 0;
  private table = new THREE.Group(); // the tilted felt surface; cards + hand live in its plane

  private bag = new ResourceBag();
  private slabMat: THREE.MeshStandardMaterial;
  private doneMat: THREE.MeshStandardMaterial;
  private missMat: THREE.MeshStandardMaterial;
  private banner: HTMLDivElement;

  constructor(
    private avatar: MimicAvatar,
    private session: TrackingSession,
    level: Level,
    host: HTMLElement,
  ) {
    const { geo, mat } = this.bag;

    // The sequence: no move repeats back-to-back — a double is genuinely
    // ambiguous to perform (the gesture must disengage to re-fire).
    const n = COUNT[level - 1];
    const pool: Move[] = [...HEAD_MOVES, "mouth"];
    const moves: Move[] = [];
    for (let i = 0; i < n; i++) {
      const options = pool.filter((m) => m !== moves[i - 1]);
      moves.push(options[Math.floor(Math.random() * options.length)]);
    }

    // --- The table: a felt board with a wooden rim, tilted toward the
    // camera. Everything below parents into this group, so "up off the
    // table" is simply local +z.
    this.table.rotation.x = TABLE_TILT;
    this.table.position.set(0, TABLE_Y, TABLE_Z);
    this.avatar.stageGroup.add(this.table);
    const felt = new THREE.Mesh(
      geo(new THREE.BoxGeometry(FELT_W, FELT_H, 0.08)),
      mat(0x166534, 0.9), // deep green felt
    );
    felt.position.set(0, -0.55, -(CARD_T / 2 + 0.04));
    const rim = new THREE.Mesh(
      geo(new THREE.BoxGeometry(FELT_W + 0.26, FELT_H + 0.26, 0.07)),
      mat(0x7c5a3a, 0.7), // wooden edge peeking out around the felt
    );
    rim.position.set(0, -0.55, -(CARD_T / 2 + 0.115));
    this.table.add(felt, rim);

    // --- Shared card geometry/materials. The faces are IMAGES from
    // cardArt.ts (module-cached textures — reused across plays, upgradeable
    // to real artwork in one place); the slab's material carries the
    // done/miss verdict color around the edges.
    const slabGeo = geo(new THREE.BoxGeometry(CARD_W, CARD_H, CARD_T));
    const faceGeo = geo(new THREE.PlaneGeometry(CARD_W * 0.94, CARD_H * 0.94));
    this.slabMat = mat(0x334155, 0.55);
    this.doneMat = mat(0x059669, 0.5); // emerald: passed
    this.missMat = mat(0xdc2626, 0.5); // red: failed
    const faceMat = (tex: THREE.Texture): THREE.MeshBasicMaterial =>
      this.bag.track(new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    const backMat = faceMat(cardBackTexture());

    // --- The cards: dealt in from off the table's right edge, one per
    // beat, sliding to their felt spots. Front image just off the front
    // face; the "?" back rotated π so it faces the camera when down.
    const dealFromX = FELT_W / 2 + 1.6;
    this.cards = moves.map((move, i) => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(slabGeo, this.slabMat);
      const front = new THREE.Mesh(faceGeo, faceMat(cardFaceTexture(move)));
      front.position.z = CARD_T / 2 + 0.005;
      const back = new THREE.Mesh(faceGeo, backMat);
      back.position.z = -(CARD_T / 2 + 0.005);
      back.rotation.y = Math.PI;
      group.add(body, front, back);
      const finalX = (i - (n - 1) / 2) * CARD_SPACING;
      group.position.set(dealFromX, 0, 0); // off-table; the deal slides it in
      this.table.add(group);
      return {
        move,
        group,
        body,
        rot: 0,
        target: 0,
        downAt: NaN,
        finalX,
        dealAt: i * DEAL_STAGGER_MS,
      };
    });
    // The study clock starts once the last card has landed, sized to n.
    this.revealEndsAt =
      n * DEAL_STAGGER_MS + DEAL_SETTLE_MS + REVEAL_BASE_MS + n * REVEAL_PER_CARD_MS;

    // --- The pointing hand: a fist with the INDEX finger extended — the
    // index rises from the palm's edge and the other three fingers show as
    // curled knuckle stubs beside it (a single centered finger reads as a
    // very different gesture). Emerald family, like the player figure.
    const handMat = mat(0x34d399, 0.45);
    const palmGeo = geo(new THREE.BoxGeometry(0.34, 0.26, 0.1));
    const fingerGeo = geo(new THREE.CapsuleGeometry(0.05, 0.2, 3, 6));
    const knuckleGeo = geo(new THREE.CapsuleGeometry(0.045, 0.05, 3, 6));
    const thumbGeo = geo(new THREE.CapsuleGeometry(0.045, 0.1, 3, 6));
    this.hand = new THREE.Group();
    const palm = new THREE.Mesh(palmGeo, handMat);
    // The index rises NEXT TO the thumb (an extended finger on the far side
    // of the fist reads as a pinky), thicker and taller than the curled
    // middle/ring/pinky knuckles that shrink away from it.
    const finger = new THREE.Mesh(fingerGeo, handMat);
    finger.position.set(0.1, 0.25, 0);
    // Evenly spaced from the index out (0.08 apart), the whole row shifted
    // right; the pinky's edge lands right at the palm's (half-width 0.17).
    const KNUCKLES = [
      { x: 0.02, s: 1.0 },
      { x: -0.06, s: 0.92 },
      { x: -0.14, s: 0.8 }, // the actual pinky, smallest
    ];
    KNUCKLES.forEach(({ x, s }, i) => {
      const knuckle = new THREE.Mesh(knuckleGeo, handMat);
      knuckle.scale.setScalar(s);
      knuckle.position.set(x, 0.15 - i * 0.015, 0.02);
      this.hand.add(knuckle);
    });
    const thumb = new THREE.Mesh(thumbGeo, handMat);
    thumb.position.set(0.21, 0.0, 0.02);
    thumb.rotation.z = -0.85;
    this.hand.add(palm, finger, thumb);
    this.hand.scale.setScalar(1.2); // in proportion with the bigger cards
    this.hand.position.set(0, HAND_Y, 0.09); // hovering just off the felt
    this.hand.visible = false; // appears when the test begins
    this.table.add(this.hand);

    // --- The instruction banner (DOM — crisp text wants DOM, not 3D). Sits
    // between the card row and the figure; swaps to "your turn" and fades
    // when the test begins.
    this.banner = document.createElement("div");
    this.banner.textContent = "memorize these cards";
    this.banner.style.cssText =
      "position:absolute;top:34px;left:50%;transform:translateX(-50%);" +
      "padding:5px 16px;border-radius:999px;background:rgba(15,23,42,0.72);" +
      "color:#e2e8f0;font-size:12px;font-weight:700;letter-spacing:0.12em;" +
      "text-transform:uppercase;white-space:nowrap;pointer-events:none;" +
      "transition:opacity 0.6s;";
    host.appendChild(this.banner);

    playTick(false); // the reveal starts — memorize
  }

  get outcome(): "pending" | "win" | "lose" {
    return this._outcome;
  }

  get hud(): string {
    return `${this.idx} / ${this.cards.length}`;
  }

  dispose(): void {
    this.banner.remove();
    this.bag.dispose();
    this.session.detachAvatar();
  }

  update(f: FrameResult, dt: number): void {
    this.t += dt;

    // Mouth signal: smoothed, open/rearm, starts unarmed.
    let mouthFired = false;
    if (f.expression) {
      const k = 1 - Math.exp(-dt / MOUTH_SMOOTH_MS);
      this.mouth += (f.expression.mouthOpen - this.mouth) * k;
    }
    if (this.mouth < MOUTH_REARM) this.mouthArmed = true;
    else if (this.mouth >= MOUTH_OPEN && this.mouthArmed) {
      this.mouthArmed = false;
      mouthFired = true;
    }

    this.animate(dt);

    // --- Reveal phase: study time ends with a READY flash…
    if (this.phase === "reveal") {
      if (this.t >= this.revealEndsAt) {
        this.phase = "ready";
        this.readyUntil = this.t + READY_MS;
        this.banner.textContent = "ready?";
        this.banner.style.fontSize = "15px";
        playTick(false);
      }
      return;
    }
    // --- …then the cards flip down and the test begins.
    if (this.phase === "ready") {
      if (this.t >= this.readyUntil) {
        this.phase = "recall";
        // A wave, not a slam: each card's flip fires a beat after the last.
        this.cards.forEach((c, i) => {
          c.downAt = this.t + i * FLIP_STAGGER_MS;
        });
        this.hand.visible = true;
        this.handX = this.cards[0].group.position.x;
        this.hand.position.x = this.handX;
        // Input opens once the whole cascade has run, plus the usual grace.
        this.graceUntil = this.t + this.cards.length * FLIP_STAGGER_MS + GRACE_MS;
        this.banner.textContent = "go!";
        this.banner.style.opacity = "0";
        playTick(true); // the test begins
      }
      return;
    }
    if (!Number.isNaN(this.decidedAt)) {
      // Decided: just let the flips/linger play out.
      if (this.t - this.decidedAt >= LINGER_MS) {
        this._outcome = this.won ? "win" : "lose";
      }
      return;
    }

    // --- Recall phase: judge this frame's move attempts, if any. ---
    if (this.t < this.graceUntil) return;
    const attempts: Move[] = f.events
      .filter((e) => GESTURE_MOVES.has(e.name))
      .map((e) => e.name as Move);
    if (mouthFired) attempts.push("mouth");
    if (attempts.length === 0) return;

    const expected = this.cards[this.idx];
    if (attempts.includes(expected.move)) {
      // Correct: full spin back to face-up, verdict material, advance.
      expected.target = DONE;
      expected.body.material = this.doneMat;
      this.idx += 1;
      this.mistakes = 0;
      this.warnUntil = NaN;
      this.graceUntil = this.t + GRACE_MS;
      playTick(true);
      if (this.idx >= this.cards.length) {
        this.won = true;
        this.hand.visible = false;
        this.decidedAt = this.t;
      } else {
        this.handX = this.cards[this.idx].group.position.x;
      }
    } else {
      this.mistakes += 1;
      if (this.mistakes < TRIES_PER_CARD) {
        // First wrong try: the card flashes red as a warning, stays down —
        // one more chance.
        expected.body.material = this.missMat;
        this.warnUntil = this.t + WARN_FLASH_MS;
        this.graceUntil = this.t + GRACE_MS;
        playTick(false);
      } else {
        // Out of tries: flip the card to show what it should have been,
        // framed red — failed CAPTCHA.
        expected.target = DONE;
        expected.body.material = this.missMat;
        this.hand.visible = false;
        this.decidedAt = this.t;
      }
    }
  }

  // Per-frame presentation: card spins ease toward their targets, the hand
  // slides to the active card and idles with a small bob.
  private animate(dt: number): void {
    // The first-mistake warning flash ends: back to the neutral slab.
    if (!Number.isNaN(this.warnUntil) && this.t >= this.warnUntil) {
      this.cards[this.idx].body.material = this.slabMat;
      this.warnUntil = NaN;
    }
    const kFlip = 1 - Math.exp(-dt / FLIP_EASE_MS);
    const kDeal = 1 - Math.exp(-dt / DEAL_EASE_MS);
    for (const c of this.cards) {
      // The deal: each card slides from off-table to its spot on its beat.
      if (this.t >= c.dealAt) {
        c.group.position.x += (c.finalX - c.group.position.x) * kDeal;
      }
      // The scheduled flip-down fires when its cascade slot arrives (only
      // ever upgrades 0 → DOWN; hits overwrite target with DONE directly).
      if (!Number.isNaN(c.downAt) && this.t >= c.downAt && c.target === 0) {
        c.target = DOWN;
      }
      c.rot += (c.target - c.rot) * kFlip;
      c.group.rotation.y = c.rot;
      // Mid-turn lift off the felt sells the flip (|sin| peaks at the
      // edge-on moment of every half-turn, back flat at rest).
      c.group.position.z = 0.14 * Math.abs(Math.sin(c.rot));
    }
    if (this.hand.visible) {
      const kHand = 1 - Math.exp(-dt / HAND_EASE_MS);
      this.hand.position.x += (this.handX - this.hand.position.x) * kHand;
      this.hand.position.y = HAND_Y + Math.sin(this.t / 300) * HAND_BOB;
    }
  }
}

export const mimicDef: MicrogameDef = {
  id: "mimic",
  title: "Prove You're Human",
  headline: "CAPTCHA v9 now requires interpretive dance",
  prompt: { lead: "memorize, then", action: "MIMIC" },
  hint: "study the cards · then do the moves in order",
  durationMs: DURATION_MS,
  create(canvas, session, level) {
    const avatar = session.attachAvatar(canvas, MimicAvatar);
    // The playfield div (the canvas's positioned parent) hosts the banner.
    return new MimicGame(avatar, session, level, canvas.parentElement!);
  },
};
