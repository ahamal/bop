// Inline SVG art for the science page: the head-angle load diagram (Hansraj
// 2014 figures) and small movement glyphs for the exercises list. Everything is
// drawn with theme utility classes (fill-accent, stroke-text, …) so it follows
// the light/dark palette for free.

import type { ReactNode } from "react";

const DEG = Math.PI / 180;

// Hansraj's modelled cervical loads by flexion angle.
const FIGURES = [
  { deg: 0, lb: 12, kg: 5 },
  { deg: 15, lb: 27, kg: 12 },
  { deg: 30, lb: 40, kg: 18 },
  { deg: 45, lb: 49, kg: 22 },
  { deg: 60, lb: 60, kg: 27 },
] as const;

// One profile figure: shoulders fixed, neck+head group rotated forward around
// the neck base (the local origin), a load arrow pressing down on the head —
// longer and heavier as the angle grows.
function Figure({ deg, lb, kg, x }: { deg: number; lb: number; kg: number; x: number }) {
  // Head center in figure coords once the neck group is rotated.
  const hx = 30 * Math.sin(deg * DEG);
  const hy = -30 * Math.cos(deg * DEG);
  const headTop = hy - 18;
  const len = 12 + (lb - 12) * 0.72;
  const sw = 2 + ((lb - 12) / 48) * 2.5;
  const tipY = headTop - 5;

  return (
    <g transform={`translate(${x}, 116)`}>
      {/* Shoulders in profile: rounded back (left), chest forward (right) so the
          head sits over the chest, not centered on a symmetric blob. */}
      <path
        d="M -26 20 Q -28 0 -12 -4 L 10 -4 Q 30 -4 34 20 Z"
        className="fill-muted"
        fillOpacity={0.3}
      />
      {/* Neck + head, tilted forward as one piece */}
      <g transform={`rotate(${deg})`}>
        <rect x={-6.5} y={-20} width={13} height={22} rx={6} className="fill-accent" fillOpacity={0.65} />
        {/* Egg-shaped head, a touch taller than wide */}
        <ellipse cx={0} cy={-30} rx={14.5} ry={16.5} className="fill-accent" />
        {/* Nose — profile bump: bridge sloping down-forward to a sharp tip that
            points down-out (not straight ahead), flat underside back to the face. */}
        <path
          d="M 12.4 -35 C 14.8 -33.8 16.6 -31.2 17.4 -28.2 L 12 -27.2 Z"
          className="fill-accent"
        />
        {/* Eye */}
        <circle cx={7} cy={-33} r={1.8} className="fill-black" fillOpacity={0.35} />
        {/* Mouth — a short dash below the nose, tucked in from the face edge */}
        <rect x={8} y={-23.5} width={5.5} height={1.7} rx={0.85} className="fill-black" fillOpacity={0.35} />
      </g>
      {/* Load arrow pressing down on the head */}
      <line
        x1={hx}
        y1={tipY - len}
        x2={hx}
        y2={tipY - 5}
        className="stroke-text"
        strokeOpacity={0.65}
        strokeWidth={sw}
        strokeLinecap="round"
      />
      <path
        d={`M ${hx - 4.5} ${tipY - 6} L ${hx + 4.5} ${tipY - 6} L ${hx} ${tipY} Z`}
        className="fill-text"
        fillOpacity={0.65}
      />
      {/* Labels */}
      <text x={0} y={44} textAnchor="middle" className="fill-text text-[14px] font-bold">
        {deg}°
      </text>
      <text x={0} y={60} textAnchor="middle" className="fill-muted text-[11px]">
        {lb} lb · {kg} kg
      </text>
    </g>
  );
}

export function TechNeckDiagram() {
  return (
    <svg
      viewBox="0 0 560 184"
      role="img"
      aria-label="Effective load on the cervical spine at increasing head-tilt angles: 12 pounds upright, rising to 60 pounds at 60 degrees of flexion"
      className="w-full"
    >
      {FIGURES.map((f, i) => (
        <Figure key={f.deg} {...f} x={56 + i * 112} />
      ))}
    </svg>
  );
}

// --- Movement glyphs -------------------------------------------------------
// Tiny 32×32 icons for the exercises list: an outlined head (currentColor, so
// they inherit the text color) with an accent arrow showing the motion.

const HEAD = "stroke-current fill-none";
const ARROW = "stroke-accent fill-none";

function Glyph({ label, children }: { label: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label={label}
      className="h-9 w-9 shrink-0 text-muted"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** Arrowhead: tip at (x, y), pointing along angle `a` (degrees, 0 = right). */
function Tip({ x, y, a, s = 1 }: { x: number; y: number; a: number; s?: number }) {
  return (
    <path
      d="M 0 0 L -5.5 2.8 L -5.5 -2.8 Z"
      transform={`translate(${x} ${y}) rotate(${a}) scale(${s})`}
      className="fill-accent"
      stroke="none"
    />
  );
}

/** Shoulders seen from the front. */
function ShouldersFront() {
  return <path d="M 6 29 Q 8 22 16 22 Q 24 22 26 29" className={HEAD} />;
}

/** Shoulders in profile (facing right): rounded back, chest forward. */
function ShouldersProfile() {
  return <path d="M 8 29 Q 9 22 15 21.5 L 20 21.5 Q 27 22.5 29 29" className={HEAD} />;
}

/** Chin tuck: profile head over shoulders, arrow pushing straight back. */
export function GlyphTuck() {
  return (
    <Glyph label="Chin tuck">
      <ShouldersProfile />
      <circle cx={15} cy={12} r={6} className={HEAD} />
      <circle cx={18} cy={10.5} r={1.2} className="fill-current" stroke="none" />
      <line x1={31} y1={12} x2={27} y2={12} className={ARROW} />
      <Tip x={24} y={12} a={180} />
    </Glyph>
  );
}

/** Side tilt: front figure, head tipped toward the shoulder, arc over the top. */
export function GlyphTilt() {
  return (
    <Glyph label="Side tilt">
      <ShouldersFront />
      <g transform="rotate(20 16 19)">
        <circle cx={16} cy={12} r={6} className={HEAD} />
        <circle cx={13.5} cy={11.5} r={1.1} className="fill-current" stroke="none" />
        <circle cx={18.5} cy={11.5} r={1.1} className="fill-current" stroke="none" />
      </g>
      <path d="M 7 7 A 10 10 0 0 1 19 3.8" className={ARROW} />
      <Tip x={22} y={5} a={30} />
    </Glyph>
  );
}

/** Rotation: front shoulders, head turned to profile, swoosh past the chin. */
export function GlyphRotate() {
  return (
    <Glyph label="Rotation">
      <ShouldersFront />
      <circle cx={16} cy={12} r={6} className={HEAD} />
      <circle cx={19.5} cy={10.5} r={1.2} className="fill-current" stroke="none" />
      <path d="M 5 14.5 Q 16 21.5 24 15.5" className={ARROW} />
      <Tip x={26} y={13.5} a={-35} />
    </Glyph>
  );
}

/** Flexion/extension: profile figure, double-headed arc tracing the nod. */
export function GlyphNod() {
  return (
    <Glyph label="Flexion and extension">
      <ShouldersProfile />
      <circle cx={13} cy={12} r={6} className={HEAD} />
      <circle cx={16.5} cy={10.5} r={1.2} className="fill-current" stroke="none" />
      <path d="M 24 4 A 9.5 9.5 0 0 1 24 20" className={ARROW} />
      <Tip x={23} y={3.5} a={-150} s={0.8} />
      <Tip x={23} y={20.5} a={150} s={0.8} />
    </Glyph>
  );
}

/** Neck roll: front figure with a circular arrow looping around the head. */
export function GlyphRoll() {
  return (
    <Glyph label="Neck roll">
      <ShouldersFront />
      <circle cx={16} cy={13} r={5.5} className={HEAD} />
      <circle cx={13.8} cy={12.5} r={1.1} className="fill-current" stroke="none" />
      <circle cx={18.2} cy={12.5} r={1.1} className="fill-current" stroke="none" />
      <path d="M 20.9 20.9 A 9.75 9.75 0 1 1 20.9 4.6" className={ARROW} />
      <Tip x={22} y={5.5} a={30} />
    </Glyph>
  );
}
