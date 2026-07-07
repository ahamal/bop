// Card face artwork for Mimic — each move's image drawn once onto an
// offscreen canvas and served as a cached THREE texture. This is the single
// place the card images live: to upgrade the art later, swap a draw
// function for a loaded image (TextureLoader) and nothing else changes.
// Textures are module-cached for the app's lifetime (seven tiny canvases) —
// games dispose their materials, not these.
//
// The designs reuse the established icon language: arrow glyphs for looks,
// the egg-tipping-off-a-shoulder-bar pictogram for tilts (arrows read as
// "move"/"spin" for tilts — the Dance lesson), an open-mouth oval ring. All
// drawn in the player's mirror view: "look left" points screen-left.

import * as THREE from "three";

export type Move =
  | "lookLeft"
  | "lookRight"
  | "lookUp"
  | "lookDown"
  | "tiltLeft"
  | "tiltRight"
  | "mouth";

// Canvas resolution; the card front is ~3:4.
const W = 256;
const H = 352;
const BG = "#0f172a";
const LOOK_COLOR = "#22d3ee";
const TILT_COLOR = "#c084fc";
const MOUTH_COLOR = "#fbbf24";
const LABEL_COLOR = "#e2e8f0";

const LABEL: Record<Move, string> = {
  lookLeft: "look left",
  lookRight: "look right",
  lookUp: "look up",
  lookDown: "look down",
  tiltLeft: "tilt left",
  tiltRight: "tilt right",
  mouth: "open wide",
};

const cache = new Map<string, THREE.CanvasTexture>();

function makeCanvas(): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  // The card ground: a rounded slate face.
  ctx.beginPath();
  ctx.roundRect(6, 6, W - 12, H - 12, 26);
  ctx.fillStyle = BG;
  ctx.fill();
  return ctx;
}

function toTexture(ctx: CanvasRenderingContext2D): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4; // the table is tilted; keep the art crisp at a slant
  return tex;
}

// A fat arrow pointing up, centered on (0,0) — callers rotate the context.
function drawArrow(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -62); // tip
  ctx.lineTo(44, -8);
  ctx.lineTo(18, -8);
  ctx.lineTo(18, 58);
  ctx.lineTo(-18, 58);
  ctx.lineTo(-18, -8);
  ctx.lineTo(-44, -8);
  ctx.closePath();
  ctx.fill();
}

// The tilt pictogram: a shoulder bar with an egg head tipping from it.
function drawTilt(ctx: CanvasRenderingContext2D, side: -1 | 1): void {
  ctx.fillStyle = TILT_COLOR;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.roundRect(-62, 44, 124, 16, 8); // shoulders
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.translate(0, 44); // hinge at the neck
  // Canvas rotation is clockwise-positive; negative tips toward screen-left.
  ctx.rotate(side * 0.55);
  ctx.beginPath();
  ctx.ellipse(0, -42, 26, 34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// The open mouth: a whole face gaping (a bare oval ring read as Dance's
// "center" chip) — amber head, dot eyes, big dark mouth with a teeth band.
function drawMouth(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = MOUTH_COLOR;
  ctx.beginPath();
  ctx.arc(0, 0, 64, 0, Math.PI * 2); // the head
  ctx.fill();
  ctx.fillStyle = BG;
  for (const ex of [-24, 24]) {
    ctx.beginPath();
    ctx.arc(ex, -22, 8, 0, Math.PI * 2); // eyes
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(0, 22, 24, 28, 0, 0, Math.PI * 2); // the gaping mouth
  ctx.fill();
  ctx.fillStyle = "#f8fafc";
  ctx.beginPath();
  ctx.roundRect(-16, -2, 32, 9, 4); // teeth band across the top of the mouth
  ctx.fill();
}

/** The face-up image for one move (cached — do not dispose). */
export function cardFaceTexture(move: Move): THREE.CanvasTexture {
  const hit = cache.get(move);
  if (hit) return hit;

  const ctx = makeCanvas();
  ctx.save();
  ctx.translate(W / 2, H / 2 - 28); // icon sits above the label band
  if (move === "mouth") {
    drawMouth(ctx);
  } else if (move === "tiltLeft" || move === "tiltRight") {
    drawTilt(ctx, move === "tiltLeft" ? -1 : 1);
  } else {
    const rot: Partial<Record<Move, number>> = {
      lookUp: 0,
      lookDown: Math.PI,
      lookLeft: -Math.PI / 2, // canvas clockwise-positive: -90° points left
      lookRight: Math.PI / 2,
    };
    ctx.rotate(rot[move]!);
    drawArrow(ctx, LOOK_COLOR);
  }
  ctx.restore();

  ctx.fillStyle = LABEL_COLOR;
  ctx.font = "700 30px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(LABEL[move].toUpperCase(), W / 2, H - 46);

  const tex = toTexture(ctx);
  cache.set(move, tex);
  return tex;
}

/** The face-down back — a "?" over a diamond (cached — do not dispose). */
export function cardBackTexture(): THREE.CanvasTexture {
  const hit = cache.get("back");
  if (hit) return hit;

  const ctx = makeCanvas();
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(Math.PI / 4);
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 10;
  ctx.strokeRect(-58, -58, 116, 116); // the diamond
  ctx.restore();
  ctx.fillStyle = "#94a3b8";
  ctx.font = "800 96px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("?", W / 2, H / 2 + 6);

  const tex = toTexture(ctx);
  cache.set("back", tex);
  return tex;
}
