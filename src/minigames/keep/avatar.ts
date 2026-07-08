// The Keep playfield avatar: the player IS the dragon. Extends the Avatar
// base directly (not AbstractAvatar — every mesh is replaced): buildHead
// grows a horned dragon skull on headPivot sized to the rig's conventions
// (head mass at y ≈ 0.95, like the abstract head, so the base pose driving
// reads exactly as it does on the human figure), and applyFace hinges the
// lower jaw from the live mouthOpen signal: your mouth is its mouth.
// buildBody stages an upright hovering wyvern on torsoGroup — spread bat
// wings (shoulder tilt rocks them, animate() flaps them), a glowing belly
// (the game's "loaded" indicator), tucked legs, a hanging tail.
//
// Flight follows the Drone chassis: the figure rides flightGroup, the game
// owns the flight model and calls setFlight(x, z, heading, bank, y) every
// frame; the chase camera swings in behind. The base render loop keeps
// writing headPivot/bodyGroup transforms — all game-owned motion lives on
// the parent groups.

import * as THREE from "three";
import type { HeadPose } from "../../tracking/pose.ts";
import type { BodyPose } from "../../tracking/bodyTracker.ts";
import type { FaceExpression } from "../../tracking/face.ts";
import { Avatar } from "../../avatar/avatar.ts";
import { ACCENT, ACCENT_DEEP } from "../../avatar/abstractParts.ts";

/** World y of the ground plane. */
export const GROUND_Y = -2.62;
/** World y the dragon flies at (fixed altitude; the crash outro lowers it). */
export const FLY_Y = 1.1;
/** How many embers the dragon can carry (the orbit shows one orb each). */
export const MAX_AMMO = 10;

const FIGURE_SCALE = 0.5;
const JAW_MAX = 0.5; // full-gape jaw drop (radians)
const FLAP_RATE = 0.0055; // wing beat, rad/ms of phase
const FLAP_AMP = 0.3;
const BANK_MAX = 0.14; // full-turn body roll into the turn — a lean, not a knife-edge
// Attitude pivots about the BODY CENTER, not the flight-group origin: the
// origin sits at head height with the whole figure hanging below it, so a
// pitch applied there swings the body like a pendulum — "nose down" kicked
// the torso forward-under and read as the dragon reclining BACKWARD. That
// pendulum is why every pitch sign change looked reversed. pitchGroup puts
// the rotation at mid-body; with that fixed, negative x = nose down.
const PITCH_PIVOT_Y = -0.7; // mid-body in flight-group units (figure scaled 0.5)
const CRUISE_LEAN = -0.9; // level flight is near-horizontal (~52° past upright)
const DIVE_TIP = 0.45; // full dive noses over to ~77°; a full brake sits back
// to -0.45 — still leaning into flight, never upright.
// The tracked shoulder tilt rocks the torso — and the wings ride the torso,
// so at this wingspan a raw lean reads as a knife-edge roll on top of the
// flight bank. Damp the channel (consistently through calibration too).
const SHOULDER_TILT_DAMP = 0.35;
// The tail is the turn indicator: it deflects toward the side being turned
// to (rudder-style, per segment so it curves), with the idle wave shrinking
// as the deflection grows so a committed turn reads clean.
const TAIL_STEER_RAD = 0.3; // per-segment deflection at full turn rate

// Chase cameras, cycled with C or Space (racing-game style): far chase
// (whole island in view), close chase (action), high tactical (top-down for
// reading telegraph rings). All follow the same EASED heading (CAM_LAG_MS),
// so a tilt banks the dragon first and the world swings a beat later — the
// lag is what sells the turn.
const CAMERAS = [
  { back: 38, up: 19, ahead: 20, lookY: -3 }, // far chase
  { back: 15, up: 6.5, ahead: 12, lookY: -1.2 }, // close chase
  // High tactical: look target thrown well forward — what's AHEAD of the
  // dragon is what matters up here; it sits low in frame, path on screen.
  { back: 22, up: 66, ahead: 40, lookY: -40 },
] as const;
const CAM_LAG_MS = 280;

// Belly glow: dim coal when empty, hot ember when loaded (the game's "you
// can fire now" indicator lives on the body, not in UI).
const BELLY_DIM = 0x35544a;
const BELLY_HOT = 0xfb923c;

// The stocked orbs circle the dragon's chest — the more it carries, the
// wider the ring, and the orbs stay EQUIDISTANT around it at every count
// (each slot's bearing eases to its n·2π/count spot when the count changes,
// so survivors glide to the new spacing rather than jumping). Identity is
// per-slot: eating adds a slot, firing removes the newest.
const ORBIT_CENTER = { x: 0, y: -1.0, z: 0.3 }; // torso-local
const ORBIT_RATE = 0.0021; // rad/ms — a lap every ~3s
const ORBIT_R_ONE = 0.2; // a single orb hugs the clutch point
const ORBIT_R_STEP = 0.14; // extra radius per additional orb (full clutch ≈ 1.5)
const ORBIT_R_EASE_MS = 220;
const ORBIT_SPACING_EASE_MS = 260; // bearings glide to the new even spacing

// The wing membrane: a scalloped bat-wing outline in the shoulder's local
// xy plane (+x outward; the left wing mirrors it). From the chase camera the
// pair reads as the classic spread-dragon silhouette.
function wingShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(1.4, 0.9);
  s.lineTo(2.9, 1.15);
  s.lineTo(2.8, 0.1);
  s.lineTo(2.05, -0.25);
  s.lineTo(2.55, -1.0);
  s.lineTo(1.55, -0.8);
  s.lineTo(0.65, -1.15);
  s.closePath();
  return s;
}

export class DragonAvatar extends Avatar {
  // Field initializers run after super(), so the base scene graph exists.
  private flightGroup = new THREE.Group(); // game-flown position + heading
  private pitchGroup = new THREE.Group(); // pitch + bank, pivoted at mid-body
  /** The game parents the keep / embers / ground meshes here (world coords). */
  readonly worldGroup = new THREE.Group();

  // `declare` (not `!`): assigned in buildHead/buildBody, which the BASE
  // constructor calls — plain field initializers would wipe them after super().
  private declare jaw: THREE.Group;
  private declare wingL: THREE.Group;
  private declare wingR: THREE.Group;
  private declare tailSegs: THREE.Group[];
  private declare bellyMat: THREE.MeshStandardMaterial;
  private declare carryOrbs: THREE.Group[];

  private flapT = 0;
  private ammo = 0;
  private steer = 0; // shaped turn input from setFlight — drives the tail
  private camIdx = 0; // which CAMERAS preset is live (C / Space cycles)

  // C or Space cycles the camera, game-style. Bound for the avatar's life.
  private onKey = (e: KeyboardEvent): void => {
    if (e.code === "KeyC" || e.code === "Space") {
      e.preventDefault(); // Space must not scroll the page
      this.camIdx = (this.camIdx + 1) % CAMERAS.length;
    }
  };
  private orbitR = ORBIT_R_ONE; // eased orb-ring radius
  // Each slot's eased bearing on the ring (targets n·2π/count).
  private orbBearings = Array.from({ length: MAX_AMMO }, (_, n) => (n * Math.PI * 2) / MAX_AMMO);
  private camHeading = 0; // eased copy of the flight heading (the camera lag)

  // Chase view shows the dragon from behind — true handedness (see Avatar).
  protected viewSign = -1 as const;

  constructor(canvas: HTMLCanvasElement) {
    super(canvas);
    // A real sky: the base renderer is transparent (the page showed through
    // as grey above the horizon at this camera distance), so paint the
    // backdrop. The base camera's draw distance suits a head-and-shoulders
    // portrait, not a 240-unit sea — push it well past the water's edge so
    // the world reaches the horizon instead of clipping.
    this.scene.background = new THREE.Color(0xa5c7e0);
    this.camera.far = 1000;
    this.camera.updateProjectionMatrix();
    this.flightGroup.position.set(0, FLY_Y, 0);
    // The figure faces along the flight direction (flight-forward is -z, the
    // figure's default facing is +z, hence the flip); pose machinery
    // untouched by the reparent. The ride sits inside pitchGroup with the
    // pivot shifted to mid-body, so pitch/bank rotate the dragon about its
    // center of mass instead of pendulum-swinging it from the head.
    const ride = new THREE.Group();
    ride.scale.setScalar(FIGURE_SCALE);
    ride.rotation.y = Math.PI;
    ride.position.y = -PITCH_PIVOT_Y;
    ride.add(this.headPivot, this.bodyGroup);
    this.pitchGroup.position.y = PITCH_PIVOT_Y;
    this.pitchGroup.add(ride);
    this.flightGroup.add(this.pitchGroup);
    this.scene.add(this.flightGroup, this.worldGroup);
    window.addEventListener("keydown", this.onKey);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKey);
    super.dispose();
  }

  // Overridden per-frame by setFlight; this is just the pre-flight view.
  protected frameCamera(): void {
    const cam = CAMERAS[0];
    this.camera.position.set(0, FLY_Y + cam.up, cam.back);
    this.camera.lookAt(0, FLY_Y + cam.lookY, -cam.ahead);
  }

  private dragonMat(color: number, roughness = 0.55): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.1, flatShading: true });
  }

  // The head: an emerald horned skull with a hinged jaw, sized and placed
  // like the abstract head (mass at y ≈ 0.95) so the rig's motion reads
  // right. Everything hangs off headPivot — the tracked yaw/pitch/roll turn
  // the whole head.
  protected buildHead(): void {
    const hide = this.dragonMat(ACCENT_DEEP);
    const bright = this.dragonMat(ACCENT, 0.45);
    const bone = this.dragonMat(0xe7e5e4, 0.6);
    const head = new THREE.Group();

    // Skull: a faceted wedge, wide at the brow, with the snout tapering
    // forward (+z is the face direction) and a short neck stub below that
    // moves WITH the head — it visually bridges the rig's head/torso gap.
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), hide);
    skull.scale.set(0.95, 0.82, 1.05);
    skull.position.set(0, 0.98, -0.12);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.34, 0.85), bright);
    snout.position.set(0, 0.82, 0.62);
    const noseTip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.24, 0.22), bright);
    noseTip.position.set(0, 0.79, 1.06);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.5), bright);
    brow.position.set(0, 1.22, 0.22);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.4, 0.9, 8), hide);
    neck.position.set(0, 0.28, -0.18);
    neck.rotation.x = 0.18;
    head.add(skull, snout, noseTip, brow, neck);

    // Horns sweep back; small ear frills behind them; amber eyes under the
    // brow (the head's orientation cues, like the abstract nose).
    const hornGeo = new THREE.ConeGeometry(0.1, 0.7, 6);
    const frillGeo = new THREE.ConeGeometry(0.07, 0.3, 4);
    const eyeGeo = new THREE.SphereGeometry(0.08, 8, 6);
    const eyeMat = this.dragonMat(0xfbbf24, 0.3);
    for (const side of [-1, 1] as const) {
      const horn = new THREE.Mesh(hornGeo, bone);
      horn.position.set(side * 0.28, 1.32, -0.42);
      horn.rotation.x = -1.05;
      horn.rotation.z = side * 0.12;
      const frill = new THREE.Mesh(frillGeo, bright);
      frill.position.set(side * 0.52, 1.02, -0.35);
      frill.rotation.z = side * 1.25;
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(side * 0.3, 1.02, 0.42);
      head.add(horn, frill, eye);
    }

    // The jaw: pivoted at the skull's rear-bottom so it swings open
    // downward; applyFace drives it from the live mouthOpen. Fangs on both
    // plates so the gape reads at chase-camera distance.
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, 0.62, -0.05);
    const jawPlate = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.16, 1.0), hide);
    jawPlate.position.set(0, -0.1, 0.55);
    this.jaw.add(jawPlate);
    const fangGeo = new THREE.ConeGeometry(0.05, 0.16, 4);
    for (const side of [-1, 1] as const) {
      const lower = new THREE.Mesh(fangGeo, bone);
      lower.position.set(side * 0.14, 0.0, 0.98);
      this.jaw.add(lower);
      const upper = new THREE.Mesh(fangGeo, bone);
      upper.rotation.x = Math.PI;
      upper.position.set(side * 0.17, 0.6, 1.05);
      head.add(upper);
    }
    head.add(this.jaw);

    this.headPivot.add(head);
  }

  // The body: an upright hovering wyvern around the torso pivot — chest with
  // the glowing belly, spread bat wings on the shoulders (they ride
  // torsoGroup, so tracked shoulder tilt rocks the whole wingspan), tucked
  // legs, and a hanging tail that waves in animate().
  protected buildBody(): void {
    const hide = this.dragonMat(ACCENT_DEEP);
    const bright = this.dragonMat(ACCENT, 0.45);
    const membrane = new THREE.MeshStandardMaterial({
      color: ACCENT,
      roughness: 0.5,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      flatShading: true,
    });

    // Shoulders taper up toward the neck stub; the chest hangs below.
    const shoulders = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.85, 0.9, 8), hide);
    shoulders.position.y = 0.25;
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 0.7, 4, 10), hide);
    chest.position.y = -0.55;
    this.bellyMat = this.dragonMat(BELLY_DIM, 0.4);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.44, 10, 8), this.bellyMat);
    belly.position.set(0, -0.6, 0.45);
    this.torsoGroup.add(shoulders, chest, belly);

    // Wings: membrane + a spar along the leading edge, pivoted at the
    // shoulder. The membrane lives in the shoulder's xy plane — from behind,
    // the pair is the heraldic spread-dragon silhouette. The left wing is
    // the mirrored twin (scale.x = -1; DoubleSide handles the winding flip).
    const membraneGeo = new THREE.ShapeGeometry(wingShape());
    const sparGeo = new THREE.CapsuleGeometry(0.09, 1.6, 3, 6);
    const wings: THREE.Group[] = [];
    for (const side of [-1, 1] as const) {
      const wing = new THREE.Group();
      wing.position.set(side * 0.55, 0.15, -0.2);
      const fan = new THREE.Mesh(membraneGeo, membrane);
      const spar = new THREE.Mesh(sparGeo, bright);
      // Along the leading edge, (0,0) → (1.4,0.9).
      spar.position.set(0.7, 0.45, 0.01);
      spar.rotation.z = -(Math.PI / 2 - Math.atan2(0.9, 1.4));
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.26, 4), bright);
      claw.position.set(1.45, 1.0, 0.01);
      wing.add(fan, spar, claw);
      wing.scale.x = side;
      this.torsoGroup.add(wing);
      wings.push(wing);
    }
    [this.wingL, this.wingR] = wings;

    // The carried embers: bright orbs circling the chest, one per stocked
    // ember (setAmmo shows slot n for ember n — identity is per-slot, and
    // animate() flies them). Basic materials so they glow unlit — this is
    // the "dragon has orbs" signal and it must read from the far chase
    // camera (the belly glow backs it up close-in).
    const coreGeo = new THREE.SphereGeometry(0.3, 10, 8);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfb923c });
    const haloGeo = new THREE.SphereGeometry(0.48, 10, 8);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.35 });
    this.carryOrbs = [];
    for (let n = 0; n < MAX_AMMO; n++) {
      const orb = new THREE.Group();
      orb.add(new THREE.Mesh(coreGeo, coreMat), new THREE.Mesh(haloGeo, haloMat));
      orb.visible = false; // positioned on the orbit every frame by animate()
      this.torsoGroup.add(orb);
      this.carryOrbs.push(orb);
    }

    // Hind legs tucked up under the chest, talons forward.
    const legGeo = new THREE.CapsuleGeometry(0.16, 0.4, 3, 6);
    const talonGeo = new THREE.BoxGeometry(0.2, 0.12, 0.3);
    for (const side of [-1, 1] as const) {
      const leg = new THREE.Mesh(legGeo, hide);
      leg.position.set(side * 0.35, -1.15, 0.1);
      leg.rotation.x = 1.05;
      const talon = new THREE.Mesh(talonGeo, bright);
      talon.position.set(side * 0.35, -1.35, 0.32);
      this.torsoGroup.add(leg, talon);
    }

    // Tail: three shrinking segments hanging down and back, spade at the
    // tip, waved in animate().
    this.tailSegs = [];
    let parent: THREE.Object3D = this.torsoGroup;
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? -1.15 : -0.42, i === 0 ? -0.3 : -0.28);
      const r = 0.24 - i * 0.06;
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, 0.42, 3, 6), hide);
      mesh.rotation.x = 0.6; // each link angles further back as they chain
      mesh.position.set(0, -0.18, -0.12);
      seg.add(mesh);
      parent.add(seg);
      parent = seg;
      this.tailSegs.push(seg);
    }
    const spade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 4), bright);
    spade.position.set(0, -0.4, -0.35);
    spade.rotation.x = 2.2;
    parent.add(spade);
  }

  /** The jaw hinges open with the live mouth — your mouth is its mouth. */
  protected applyFace(f: FaceExpression): void {
    this.jaw.rotation.x = f.mouthOpen * JAW_MAX;
  }

  /**
   * Place the dragon on its flight and swing the chase camera in behind —
   * on a delay: the camera follows an EASED heading, so the dragon banks
   * immediately and the view catches up over CAM_LAG_MS. heading 0 = -z,
   * positive turns left (screen-left); bank01 is the turn input, -1..1;
   * y lets the crash outro drop out of the cruise altitude; pitch01 tips
   * the nose for the dive/brake (-1 pull-up … 1 full dive).
   */
  setFlight(x: number, z: number, heading: number, bank01: number, dt: number, y = FLY_Y, pitch01 = 0): void {
    this.flightGroup.position.set(x, y, z);
    this.flightGroup.rotation.y = heading;
    this.steer = bank01;
    // About the mid-body pivot, negative x = nose down (see CRUISE_LEAN):
    // the dive leans further in, the brake eases back toward upright.
    this.pitchGroup.rotation.set(CRUISE_LEAN - pitch01 * DIVE_TIP, 0, bank01 * BANK_MAX);
    // heading accumulates continuously (no ±π wrap), so a plain ease is safe.
    this.camHeading += (heading - this.camHeading) * (1 - Math.exp(-dt / CAM_LAG_MS));
    const cam = CAMERAS[this.camIdx];
    const dx = -Math.sin(this.camHeading);
    const dz = -Math.cos(this.camHeading);
    this.camera.position.set(x - dx * cam.back, y + cam.up, z - dz * cam.back);
    this.camera.lookAt(x + dx * cam.ahead, y + cam.lookY, z + dz * cam.ahead);
  }

  /** Ammo indicator: one clutched orb per stocked ember, and the belly
   * glows hot while any are held (both pulse in animate). */
  setAmmo(count: number): void {
    this.ammo = count;
    this.carryOrbs.forEach((orb, n) => (orb.visible = n < count));
  }

  /** Wing beat + tail wave + belly pulse — call every frame. */
  animate(dt: number): void {
    this.flapT += dt;
    const flap = Math.sin(this.flapT * FLAP_RATE) * FLAP_AMP;
    this.wingL.rotation.z = flap;
    this.wingR.rotation.z = -flap;
    // Tail = turn indicator: each segment deflects toward the turn (the
    // ride's y-flip makes screen-left a NEGATIVE local yaw, hence the minus)
    // and the curve deepens down the chain; the idle wave fades out as the
    // deflection grows.
    const wave = Math.sin(this.flapT * 0.003) * (1 - Math.abs(this.steer));
    for (let i = 0; i < this.tailSegs.length; i++) {
      this.tailSegs[i].rotation.y = (-this.steer * TAIL_STEER_RAD + wave * 0.18) * (i + 1);
    }
    if (this.ammo > 0) {
      const pulse = 0.75 + 0.25 * Math.sin(this.flapT * 0.012);
      this.bellyMat.color.setHex(BELLY_HOT).multiplyScalar(pulse);
      // The orb ring: radius eases toward the count's size, and each slot's
      // bearing eases toward its even n·2π/count spot — equidistant at every
      // count, no jumps when it changes.
      const targetR = ORBIT_R_ONE + ORBIT_R_STEP * (this.ammo - 1);
      this.orbitR += (targetR - this.orbitR) * (1 - Math.exp(-dt / ORBIT_R_EASE_MS));
      const kb = 1 - Math.exp(-dt / ORBIT_SPACING_EASE_MS);
      const s = 0.9 + 0.18 * Math.sin(this.flapT * 0.012);
      for (let n = 0; n < this.carryOrbs.length; n++) {
        const orb = this.carryOrbs[n];
        if (!orb.visible) continue;
        const target = (n * Math.PI * 2) / this.ammo;
        // Shortest-way ease, so a respacing never sends an orb the long way.
        const d = Math.atan2(
          Math.sin(target - this.orbBearings[n]),
          Math.cos(target - this.orbBearings[n]),
        );
        this.orbBearings[n] += d * kb;
        const a = this.flapT * ORBIT_RATE + this.orbBearings[n];
        orb.position.set(
          ORBIT_CENTER.x + Math.cos(a) * this.orbitR,
          ORBIT_CENTER.y + Math.sin(a * 2) * 0.06, // a light weave, not a flat coin
          ORBIT_CENTER.z + Math.sin(a) * this.orbitR,
        );
        orb.scale.setScalar(s);
      }
    } else {
      this.bellyMat.color.setHex(BELLY_DIM);
      this.orbitR = ORBIT_R_ONE;
    }
  }

  /** Depth is ignored — leaning in must not move the dragon. */
  setZoom(_zoom: number): void {}

  /** Shoulder tilt is damped (wings amplify it); same scaling through
   * calibration so neutral stays exactly level. */
  calibrateBody(body: BodyPose): void {
    super.calibrateBody({ ...body, shoulderTilt: body.shoulderTilt * SHOULDER_TILT_DAMP });
  }

  setBody(body: BodyPose): void {
    super.setBody({ ...body, shoulderTilt: body.shoulderTilt * SHOULDER_TILT_DAMP });
  }

  /** Keep head rotations (the turning head is live feedback) but drop
   * translation — position is flown, not shifted in the chair. Pitch is
   * NEGATED: viewSign corrects the mirrored channels (yaw/roll) for the
   * back view, but the π y-flip visually inverts x-rotations too, so
   * without this your chin-down tipped the dragon's head chin-UP. */
  setPose(pose: HeadPose): void {
    super.setPose({ ...pose, pitch: -pose.pitch, cx: 0, cy: 0 });
  }
}
