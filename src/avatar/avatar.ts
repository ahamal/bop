// The pose-driving avatar base: a 3D head-and-shoulders rig that mirrors the
// tracked pose. The head (face-driven) and the torso (pose-driven) are fully
// independent — there's no neck connecting them. At center they line up
// normally; after that they move on their own and visibly detach.
//
// Abstract: subclasses supply the geometry (buildBody/buildHead — see
// AbstractAvatar, the app's look); all the smoothing/celebration/render
// machinery lives here.

import * as THREE from "three";
import type { HeadPose } from "../tracking/pose.ts";
import type { BodyPose } from "../tracking/bodyTracker.ts";
import type { FaceExpression } from "../tracking/face.ts";
import { MIRROR_SIGN } from "../tracking/mirror.ts";

const DEG2RAD = Math.PI / 180;

// The torso group pivots at the shoulder line, so tilt rotates the torso about
// itself rather than swinging from the head. Sits just below the head's resting
// position so center looks normal; the two are otherwise independent.
const SHOULDER_PIVOT_Y = -1.75;
const HEAD_BASE_Y = -0.85; // head's resting height

// Normalized-image offset (0..1) → avatar units. Shared by head and torso so a
// whole-body move shifts both by the same amount (they stay coherent), while a
// head-only move shifts just the head.
const TRANSLATE_GAIN = 6;
const MAX_OFFSET = 1.6; // clamp so a lost track can't fling a part offscreen
const clampOffset = (v: number) => Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, v));

// Shoulder width is a noisy depth estimate, so the torso zoom gets its own
// treatment: rest jitter inside the deadband doesn't move the target at all,
// and real changes ease in much slower than the other channels — otherwise the
// chest visibly pulses in and out.
const TORSO_ZOOM_DEADBAND = 0.03;
const TORSO_ZOOM_K = 0.08;

// Celebration (one-shot, celebrate()): the whole figure hops and rocks for a
// few seconds — kicked off with the confetti burst / success flourish —
// easing out as it lands. The face stays fully tracked; the tracked pose
// keeps driving underneath, so control returns seamlessly.
const CELEBRATE_S = 5;
const CELEBRATE_HOPS_PER_S = 2.5;
const CELEBRATE_HOP_Y = 0.3;
const CELEBRATE_ROCK_RAD = 0.09;

export abstract class Avatar {
  private renderer: THREE.WebGLRenderer;
  // Protected so game subclasses can add scene content (e.g. Chomp's falling
  // snacks) that isn't part of the figure itself.
  protected scene = new THREE.Scene();
  protected camera: THREE.PerspectiveCamera;
  // Protected so subclasses (e.g. AbstractAvatar) can add their own geometry to
  // these groups; all the pose-driving machinery below stays shared.
  protected headPivot = new THREE.Group();
  // swayGroup translates side-to-side; torsoGroup (inside it) is what tilts.
  // The head hangs off swayGroup directly, so it follows sway but a shoulder
  // shrug (which only tilts the torso) doesn't rotate the head.
  protected bodyGroup = new THREE.Group(); // sway
  protected torsoGroup = new THREE.Group(); // tilt (shoulders + arms)
  // Carries head + body together. Identity except while celebrating, when the
  // whole figure hops/rocks — a wrapper the per-frame pose writes never touch
  // (the same parent-group trick the game avatars use).
  protected figureGroup = new THREE.Group();
  // Per-avatar handedness on the mirrored channels (yaw/roll/cx, torso
  // tilt/sway), multiplied with the app-wide MIRROR_SIGN. Front-facing
  // avatars keep 1. An avatar staged back-to-camera (rotated π about y, e.g.
  // the Traffic runner) sets -1: the flip negates how those local channels
  // appear on screen, and from behind the person's true handedness IS the
  // screen handedness, so one negation restores "lean left = screen left".
  protected viewSign: 1 | -1 = 1;
  // Resting reading captured at calibration, so neutral = centered/straight.
  private bodyNeutral = { tilt: 0, sway: 0, centerY: 0, width: 0 };
  private canvas: HTMLCanvasElement;

  // Smoothed (current) and target head rotations, radians.
  private cur = { x: 0, y: 0, z: 0 };
  private target = { x: 0, y: 0, z: 0 };
  // Smoothed (current) and target head translation in the camera frame.
  private curHead = { x: 0, y: 0 };
  private targetHead = { x: 0, y: 0 };

  // Smoothed (current) and target torso tilt (rad), sway/lift (world units).
  private curBody = { tilt: 0, sway: 0, lift: 0, zoom: 1 };
  private targetBody = { tilt: 0, sway: 0, lift: 0, zoom: 1 };

  // Depth: 1 = neutral, >1 = head leaning in. Scales the head only, so depth is
  // independent of the torso (a chin-tuck moves the head, not the body).
  private curZoom = 1;
  private targetZoom = 1;

  // Expression (mouth open, per-eye closedness), smoothed like the pose.
  private curFace: FaceExpression = { mouthOpen: 0, leftEyeClosed: 0, rightEyeClosed: 0 };
  private targetFace: FaceExpression = { mouthOpen: 0, leftEyeClosed: 0, rightEyeClosed: 0 };

  private resizeHandler = (): void => this.resize();
  private rafId = 0;
  private disposed = false;
  // Seconds into the celebration; negative = not celebrating.
  private celebrateT = -1;
  private lastFrameMs = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    // Transparent background so the avatar composites over whatever's behind it
    // (a dark frame on the dev page, the page itself on the play screen).
    this.renderer.setClearAlpha(0);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
    this.frameCamera();

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(2, 3, 4);
    this.scene.add(key);
    // Rim strong enough that facet edges keep re-lighting as the head turns —
    // with flat shading this is most of what makes rotation visible.
    const rim = new THREE.DirectionalLight(0x88aaff, 0.6);
    rim.position.set(-3, 1, -2);
    this.scene.add(rim);

    this.bodyGroup.add(this.torsoGroup);
    this.buildBody();
    this.buildHead();
    // Head and torso stay independent — no shared transform between them; the
    // head never sways or tilts with the body. Both ride figureGroup, which is
    // identity except during a celebration.
    this.figureGroup.add(this.headPivot, this.bodyGroup);
    this.scene.add(this.figureGroup);

    this.resize();
    window.addEventListener("resize", this.resizeHandler);
    this.renderLoop();
  }

  /** Stop the render loop and release GL/listeners. Call when unmounting. */
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.resizeHandler);
    this.renderer.dispose();
  }

  /** Position/aim the camera. Overridable so a subclass can reframe (e.g. show
   * more torso). */
  protected frameCamera(): void {
    this.camera.position.set(0, 0.4, 7);
    this.camera.lookAt(0, 0.2, 0);
  }

  /** Add the torso meshes to torsoGroup (positioned by the render loop at the
   * shoulder pivot) — called once from the base constructor. */
  protected abstract buildBody(): void;

  /** Add the head meshes to headPivot — called once from the base constructor. */
  protected abstract buildHead(): void;

  /** Drive the head from a tracked pose. Pose is relative to neutral. */
  setPose(pose: HeadPose): void {
    const sign = this.viewSign * MIRROR_SIGN;
    this.target.x = -pose.pitch * DEG2RAD; // pitch: vertical, not mirrored
    this.target.y = sign * pose.yaw * DEG2RAD; // yaw: handedness
    this.target.z = sign * pose.roll * DEG2RAD; // roll: handedness
    // Translate the head by its camera-frame offset from neutral. x is
    // handedness (mirror); image y is top-down so negate for up.
    this.targetHead.x = clampOffset(sign * pose.cx * TRANSLATE_GAIN);
    this.targetHead.y = clampOffset(-pose.cy * TRANSLATE_GAIN);
  }

  /** Set zoom relative to neutral (1 = neutral, >1 = closer to camera). */
  setZoom(zoom: number): void {
    this.targetZoom = Math.max(0.6, Math.min(1.8, zoom));
  }

  /** Drive the facial expression (mouth open / eyes closed, each 0..1). */
  setFace(f: FaceExpression): void {
    this.targetFace = f;
  }

  /** Play the completion celebration: a few happy hops with a side-to-side
   *  rock, easing out over CELEBRATE_S. One-shot; re-callable. */
  celebrate(): void {
    this.celebrateT = 0;
  }

  /** Render the (smoothed) expression. Base look has no expression geometry;
   * subclasses with mouth/eye meshes override this. */
  protected applyFace(_f: FaceExpression): void {}

  /** Capture the current shoulders as the resting "centered/straight" pose. */
  calibrateBody(body: BodyPose): void {
    this.bodyNeutral = {
      tilt: body.shoulderTilt,
      sway: body.sway,
      centerY: body.centerY,
      width: body.width,
    };
  }

  /** Drive the upper body from tracked shoulders, relative to neutral. */
  setBody(body: BodyPose): void {
    // Tilt: handedness, mirrored to agree with the head's roll.
    const sign = this.viewSign * MIRROR_SIGN;
    this.targetBody.tilt =
      sign * (body.shoulderTilt - this.bodyNeutral.tilt) * DEG2RAD;
    // Sway: horizontal shoulder-center offset, mirrored like the head's x so a
    // whole-body move shifts both the same direction.
    const sway = body.sway - this.bodyNeutral.sway;
    this.targetBody.sway = clampOffset(sign * sway * TRANSLATE_GAIN);
    // Lift: vertical shoulder-center offset (image y is top-down, so negate for
    // up). Raising the shoulders moves the torso up; a whole-body move tracks
    // the head because both use the same signal type and gain.
    const lift = body.centerY - this.bodyNeutral.centerY;
    this.targetBody.lift = clampOffset(-lift * TRANSLATE_GAIN);
    // Torso depth: wider shoulders than neutral → torso is closer → zoom in.
    const zoom =
      this.bodyNeutral.width > 0 && body.width > 0
        ? body.width / this.bodyNeutral.width
        : 1;
    if (Math.abs(zoom - this.targetBody.zoom) > TORSO_ZOOM_DEADBAND) {
      this.targetBody.zoom = Math.max(0.6, Math.min(1.8, zoom));
    }
  }

  private resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private renderLoop = (): void => {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.05, this.lastFrameMs ? (now - this.lastFrameMs) / 1000 : 0);
    this.lastFrameMs = now;
    // Smooth toward target for a less jittery feel.
    const k = 0.35;
    this.cur.x += (this.target.x - this.cur.x) * k;
    this.cur.y += (this.target.y - this.cur.y) * k;
    this.cur.z += (this.target.z - this.cur.z) * k;
    this.headPivot.rotation.set(this.cur.x, this.cur.y, this.cur.z);

    // Head translation in the camera frame (independent of the torso).
    this.curHead.x += (this.targetHead.x - this.curHead.x) * k;
    this.curHead.y += (this.targetHead.y - this.curHead.y) * k;
    this.headPivot.position.x = this.curHead.x;
    this.headPivot.position.y = HEAD_BASE_Y + this.curHead.y;

    // Body tilt + sway + lift.
    this.curBody.tilt += (this.targetBody.tilt - this.curBody.tilt) * k;
    this.curBody.sway += (this.targetBody.sway - this.curBody.sway) * k;
    this.curBody.lift += (this.targetBody.lift - this.curBody.lift) * k;
    this.curBody.zoom += (this.targetBody.zoom - this.curBody.zoom) * TORSO_ZOOM_K;
    this.torsoGroup.rotation.z = this.curBody.tilt; // tilt: torso only
    this.bodyGroup.position.x = this.curBody.sway; // sway: torso only (not head)
    // Lift raises/lowers the torso following the shoulders in the camera frame.
    this.torsoGroup.position.y = SHOULDER_PIVOT_Y + this.curBody.lift;
    // Torso depth scales the torso only, independent of the head's depth.
    this.torsoGroup.scale.setScalar(this.curBody.zoom);

    // Depth scales the head only (camera stays fixed), so the torso doesn't
    // grow when the head leans in.
    this.curZoom += (this.targetZoom - this.curZoom) * k;
    this.headPivot.scale.setScalar(this.curZoom);

    // Celebration: hop + rock the whole figure, easing out; the pose writes
    // above keep landing on head/body, so tracking resumes seamlessly.
    if (this.celebrateT >= 0) {
      this.celebrateT += dt;
      if (this.celebrateT >= CELEBRATE_S) {
        this.celebrateT = -1;
        this.figureGroup.position.y = 0;
        this.figureGroup.rotation.z = 0;
      } else {
        const decay = 1 - this.celebrateT / CELEBRATE_S;
        const phase = Math.PI * CELEBRATE_HOPS_PER_S * this.celebrateT;
        this.figureGroup.position.y = Math.abs(Math.sin(phase)) * CELEBRATE_HOP_Y * decay;
        this.figureGroup.rotation.z = Math.sin(phase) * CELEBRATE_ROCK_RAD * decay;
      }
    }

    // Expression: same smoothing so blinks don't strobe the geometry.
    this.curFace.mouthOpen += (this.targetFace.mouthOpen - this.curFace.mouthOpen) * k;
    this.curFace.leftEyeClosed += (this.targetFace.leftEyeClosed - this.curFace.leftEyeClosed) * k;
    this.curFace.rightEyeClosed += (this.targetFace.rightEyeClosed - this.curFace.rightEyeClosed) * k;
    this.applyFace(this.curFace);

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.renderLoop);
  };
}
