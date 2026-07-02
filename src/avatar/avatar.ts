// A simple 3D head-and-shoulders that mirrors the tracked pose. The head
// (face-driven) and the torso (pose-driven) are fully independent — there's no
// neck connecting them. At center they line up normally; after that they move
// on their own and visibly detach.

import * as THREE from "three";
import type { HeadPose } from "../tracking/pose.ts";
import type { BodyPose } from "../tracking/bodyTracker.ts";
import { MIRROR_SIGN } from "../tracking/mirror.ts";

const DEG2RAD = Math.PI / 180;

const SKIN = 0xe0b89c;
const HAIR = 0x4a4f5e;
const SHIRT = 0x50dca0;

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

export class Avatar {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  // Protected so subclasses (e.g. AbstractAvatar) can add their own geometry to
  // these groups; all the pose-driving machinery below stays shared.
  protected headPivot = new THREE.Group();
  // swayGroup translates side-to-side; torsoGroup (inside it) is what tilts.
  // The head hangs off swayGroup directly, so it follows sway but a shoulder
  // shrug (which only tilts the torso) doesn't rotate the head.
  protected bodyGroup = new THREE.Group(); // sway
  protected torsoGroup = new THREE.Group(); // tilt (shoulders + arms)
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

  private resizeHandler = (): void => this.resize();
  private rafId = 0;
  private disposed = false;

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

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 0.4, 7);
    this.camera.lookAt(0, 0.2, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(2, 3, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.4);
    rim.position.set(-3, 1, -2);
    this.scene.add(rim);

    this.bodyGroup.add(this.torsoGroup);
    this.buildBody();
    this.buildHead();
    // Head and torso are independent — added to the scene separately, no shared
    // transform. The head never sways or tilts with the body.
    this.scene.add(this.headPivot);
    this.scene.add(this.bodyGroup);

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

  protected buildBody(): void {
    const shirt = new THREE.MeshStandardMaterial({ color: SHIRT, roughness: 0.7 });

    // Pivot the torso at the shoulder line; meshes are positioned relative to it
    // so tilt rotates the torso about itself.
    this.torsoGroup.position.y = SHOULDER_PIVOT_Y;

    // Shoulders: a wide horizontal capsule, centered on the pivot.
    const shoulders = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.55, 1.9, 8, 16),
      shirt,
    );
    shoulders.rotation.z = Math.PI / 2;
    this.torsoGroup.add(shoulders);

    // Chest fill below the shoulders.
    const chest = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.1, 1.1, 24),
      shirt,
    );
    chest.position.y = -0.45;
    this.torsoGroup.add(chest);

    // Head pivot sits just above the shoulders at rest; it's independent.
    this.headPivot.position.set(0, -0.85, 0);
  }

  protected buildHead(): void {
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.85 });
    const hair = new THREE.MeshStandardMaterial({ color: HAIR, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f27 });

    // Head sits above the pivot.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.9, 32, 32), skin);
    head.scale.set(0.92, 1.08, 0.95);
    head.position.y = 0.95;
    this.headPivot.add(head);

    // Hair: a cap over the top/back only, stopping above the forehead.
    const hairMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.93, 32, 32, 0, Math.PI * 2, 0, Math.PI * 0.38),
      hair,
    );
    hairMesh.scale.set(0.98, 1.1, 1.04);
    hairMesh.position.y = 1.0;
    hairMesh.position.z = -0.12;
    this.headPivot.add(hairMesh);

    // Nose — points +Z so head orientation is obvious.
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 16), skin);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.9, 0.92);
    this.headPivot.add(nose);

    // Eyes.
    for (const dx of [-0.32, 0.32]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 16), dark);
      eye.position.set(dx, 1.05, 0.78);
      this.headPivot.add(eye);
    }

    // Ears.
    for (const dx of [-0.88, 0.88]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), skin);
      ear.scale.set(0.6, 1, 0.7);
      ear.position.set(dx, 0.9, 0);
      this.headPivot.add(ear);
    }
  }

  /** Drive the head from a tracked pose. Pose is relative to neutral. */
  setPose(pose: HeadPose): void {
    this.target.x = -pose.pitch * DEG2RAD; // pitch: vertical, not mirrored
    this.target.y = MIRROR_SIGN * pose.yaw * DEG2RAD; // yaw: handedness
    this.target.z = MIRROR_SIGN * pose.roll * DEG2RAD; // roll: handedness
    // Translate the head by its camera-frame offset from neutral. x is
    // handedness (mirror); image y is top-down so negate for up.
    this.targetHead.x = clampOffset(MIRROR_SIGN * pose.cx * TRANSLATE_GAIN);
    this.targetHead.y = clampOffset(-pose.cy * TRANSLATE_GAIN);
  }

  /** Set zoom relative to neutral (1 = neutral, >1 = closer to camera). */
  setZoom(zoom: number): void {
    this.targetZoom = Math.max(0.6, Math.min(1.8, zoom));
  }

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
    this.targetBody.tilt =
      MIRROR_SIGN * (body.shoulderTilt - this.bodyNeutral.tilt) * DEG2RAD;
    // Sway: horizontal shoulder-center offset, mirrored like the head's x so a
    // whole-body move shifts both the same direction.
    const sway = body.sway - this.bodyNeutral.sway;
    this.targetBody.sway = clampOffset(MIRROR_SIGN * sway * TRANSLATE_GAIN);
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
    this.targetBody.zoom = Math.max(0.6, Math.min(1.8, zoom));
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
    this.curBody.zoom += (this.targetBody.zoom - this.curBody.zoom) * k;
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

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.renderLoop);
  };
}
