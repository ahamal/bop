// The microgame countdown ring — one sweep = one game clock, ticking down in
// whole seconds (the transition smooths the per-second steps into a linear
// sweep). Shared by the arcade (accent, red in the last seconds) and practice
// (black, thicker).

const SIZE = 64;

export function CountdownRing({
  timeLeft,
  totalMs,
  variant = "arcade",
}: {
  /** Whole seconds remaining. */
  timeLeft: number;
  /** The game's full clock, ms — the ring is full at totalMs, empty at 0. */
  totalMs: number;
  variant?: "arcade" | "practice";
}) {
  // Practice sits over arbitrary game scenes, so it gets a frosted dark
  // backing disc and a white ring — legible on any background. The arcade
  // variant keeps the bare accent ring the cutscene chrome was built around.
  const practice = variant === "practice";
  const strokeWidth = practice ? 7 : 5;
  const r = SIZE / 2 - strokeWidth - (practice ? 4 : 1);
  const c = 2 * Math.PI * r;
  const stroke = timeLeft <= 3 ? "stroke-red-400" : practice ? "stroke-white" : "stroke-accent";
  const track = practice ? "stroke-white/20" : "stroke-black/10 dark:stroke-white/10";

  return (
    <div className="relative h-14 w-14">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full -rotate-90">
        {practice && <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2} className="fill-black/50" />}
        <circle cx={SIZE / 2} cy={SIZE / 2} r={r} fill="none" strokeWidth={strokeWidth} className={track} />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={r}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="butt"
          className={stroke}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - (timeLeft * 1000) / totalMs)}
          style={{ transition: "stroke-dashoffset 1s linear" }}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums ${
          practice ? "text-white" : "text-text"
        }`}
      >
        {timeLeft}
      </span>
    </div>
  );
}
