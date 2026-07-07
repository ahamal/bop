// The play screen (#play): the guided neck routine. Staging is the shared
// SessionLobby (same as the arcade, for consistency): the mesh avatar pulses
// while the camera/models load, then "Nod to start" — a nod (or the Start
// button) begins the routine. Once started, the lobby swaps for the gameplay
// stage: the same mesh avatar (reattached to the stage canvas) above a reel of
// step cards driven by the plain-TS StackPlayer.
//
// Per-frame work (routine progress, timer ring, arc segments) is imperative
// through refs; only discrete step/done changes go through state.

import { useEffect, useRef, useState } from "react";
import { Button } from "./Button.tsx";
import { ReminderScheduler } from "./ReminderScheduler.tsx";
import { SessionLobby, SessionShell, useTrackingSession } from "./SessionScreen.tsx";
import { musicPlayer } from "../audio/player.ts";
import { playCelebrate, playDone, playTick } from "../audio/sfx.ts";
import type { FrameResult } from "../tracking/session.ts";
import type { Avatar } from "../avatar/avatar.ts";
import { AbstractAvatar } from "../avatar/AbstractAvatar.ts";
import { StackPlayer } from "../game/stackPlayer.ts";
import { NECK_ROUTINE } from "../game/routine.ts";

// Timer ring geometry + how many discrete ticks it steps through (clock-like).
const RING_R = 26;
const RING_SIZE = 64;
const RING_C = 2 * Math.PI * RING_R;
const RING_TICKS = 20;
// Roll semicircle: ends at (8,8) and (92,8), radius 42, chest at the bottom
// (50,50), split into ARC_SEGS segments that fill in sweep order as the pass
// progresses — a completion meter, not a live head-position marker.
const ARC_SEGS = 5;
const ARC_SEG_SPAN = 180 / ARC_SEGS;
const ARC_SEG_PAD = 4; // deg trimmed from each side of a segment (the gaps)
const arcX = (deg: number) => 50 + 42 * Math.cos((deg * Math.PI) / 180);
const arcY = (deg: number) => 8 + 42 * Math.sin((deg * Math.PI) / 180);
// Arc path from a0 to a1 along the circle; sweep 0 = decreasing angle (left →
// right through the chest), sweep 1 = increasing (the return direction).
const arcSeg = (a0: number, a1: number, sweep: 0 | 1) =>
  `M ${arcX(a0)} ${arcY(a0)} A 42 42 0 0 ${sweep} ${arcX(a1)} ${arcY(a1)}`;
// Reel: the active card is big; the next card is smaller and expands to big when
// it becomes active. Exactly two cards show (active + next). All rem.
const ACTIVE_H = 9.25; // active card height (fits label + set pips + timer ring)
const NEXT_H = 4.5; // upcoming card height
const CARD_GAP = 1; // gap between cards (also room for the shadow)
const CARD_STEP = ACTIVE_H + CARD_GAP; // reel advances one of these per step
const REEL_PAD = 1; // viewport padding so the outer shadows aren't clipped
const REEL_H = 2 * REEL_PAD + ACTIVE_H + CARD_GAP + NEXT_H; // exact 2-card height

// Rep bookkeeping for repeated movement cards (the chin tucks): REP_OF[i] is
// this card's 1-based rep number among identical steps, REP_TOTAL[i] how many
// there are in the routine — so a card can show "which set am I on".
const repKey = (s: (typeof NECK_ROUTINE)[number]) =>
  s.kind === "hold" ? `${s.state}:${s.label}` : null;
const REP_TOTAL = new Map<string, number>();
const REP_OF = NECK_ROUTINE.map((s) => {
  const k = repKey(s);
  if (!k) return 0;
  const n = (REP_TOTAL.get(k) ?? 0) + 1;
  REP_TOTAL.set(k, n);
  return n;
});
const repTotalAt = (i: number): number => {
  const k = repKey(NECK_ROUTINE[i]);
  return k ? (REP_TOTAL.get(k) ?? 0) : 0;
};

export function PlayScreen({ onExit }: { onExit: () => void }) {
  // The routine has begun (via a nod, or the Start button) → lobby swaps for
  // the gameplay stage.
  const [started, setStarted] = useState(false);
  // Which step is active + whether we're done (discrete state; the reel slides to
  // this index, and the timer ring on the active card updates via refs).
  const [hud, setHud] = useState<{ index: number; done: boolean }>({ index: -1, done: false });

  const stageRef = useRef<HTMLCanvasElement>(null);
  const stageAvatarRef = useRef<Avatar | null>(null);
  const startedRef = useRef(false);

  // The routine player + per-frame HUD refs (timer ring updated imperatively).
  const playerRef = useRef<StackPlayer | null>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const detailRef = useRef<HTMLSpanElement>(null);
  // Roll-card refs: one fill path per segment, toggled as progress passes them,
  // plus the dot marking the leading edge of what's finished.
  const arcSegRefs = useRef<(SVGPathElement | null)[]>([]);
  const arcDotRef = useRef<SVGCircleElement>(null);
  const hudIndex = useRef(-1);
  const hudDone = useRef(false);
  // Progress-tick bookkeeping: last credited whole second (holds) / last filled
  // arc segment (rolls) already ticked for the current card.
  const lastTickSec = useRef(0);
  const lastArcTick = useRef(0);
  // Between "player asked to recenter" and "recenter landed" (onCalibrated).
  const recenterPending = useRef(false);

  const screen = useTrackingSession({
    music: musicPlayer,
    onFrame: (f, dt) => {
      // Waiting: a real nod (neutral → brief look-down → neutral) begins the
      // routine. Nods can't fire while calibrating, so ready is implicit.
      if (!startedRef.current) {
        if (f.sequenceEvents.some((e) => e.name === "nod")) beginGame();
        return;
      }
      runGame(f, dt);
    },
    onCalibrated: (isRecenter) => {
      // A per-exercise recenter (the "hold still" gate) just landed → start it.
      if (isRecenter && recenterPending.current) {
        recenterPending.current = false;
        playerRef.current?.recentered();
      }
    },
  });
  const { session } = screen;

  // Once started the lobby (and its canvas) is gone — attach the same mesh
  // avatar to the gameplay stage. The session survives the swap.
  useEffect(() => {
    if (!started || !session || !stageRef.current) return;
    stageAvatarRef.current = session.attachAvatar(stageRef.current, AbstractAvatar);
    return () => {
      stageAvatarRef.current = null;
      session.detachAvatar();
    };
  }, [started, session]);

  // Dev-only: Space completes the current card instantly (mash to reach the
  // completion screen). Ignored when a control has focus, so Space still
  // "clicks" a focused button instead of double-acting.
  useEffect(() => {
    if (!import.meta.env.DEV || !started) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement | null;
      if (t && t.closest("button, input, select, textarea")) return;
      e.preventDefault(); // don't scroll the page
      playerRef.current?.skip();
      lastTickSec.current = 0;
      lastArcTick.current = 0;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started]);

  // Begin the routine — from a nod or the Start button.
  const beginGame = (): void => {
    if (startedRef.current) return;
    startedRef.current = true;
    restartGame();
    setStarted(true);
  };

  // Fresh player + HUD bookkeeping — used at first begin and by "Again".
  const restartGame = (): void => {
    playerRef.current = new StackPlayer(NECK_ROUTINE);
    hudIndex.current = -1;
    hudDone.current = false;
    recenterPending.current = false;
    lastTickSec.current = 0;
    lastArcTick.current = 0;
    setHud({ index: -1, done: false });
  };

  // Advance the routine each frame while playing: the timer ring updates via a
  // ref (ticking, not smooth), discrete exercise/phase/done changes via state.
  const runGame = (f: FrameResult, dt: number): void => {
    const player = playerRef.current;
    if (!player) return;
    const snap = player.update(f, dt);

    // The player asks to recenter once it's been still; do it, then confirm.
    // (It re-asks after a timeout if the recenter never lands, so honor every
    // request — recentering twice is harmless.)
    if (snap.requestRecenter) {
      recenterPending.current = true;
      // Settle mode: the relax card wants a genuinely still head behind the
      // new neutral (buttons use the default instant mode instead).
      session?.recenter("settle");
    }

    // Ring: quantize to ticks so it steps around like a clock, not a smooth fill.
    if (ringRef.current) {
      const stepped = Math.round(snap.progress * RING_TICKS) / RING_TICKS;
      ringRef.current.style.strokeDashoffset = `${RING_C * (1 - stepped)}`;
    }
    // Roll card: fill the segments the pass has gotten through; the dot eases
    // to the boundary of the last filled segment (progress, not head position).
    const rollStep = NECK_ROUTINE[snap.index];
    // Hold cards: a quiet tick each time a whole second of hold time is
    // credited — audible "it's registering" feedback for positions where the
    // ring is out of view. Brighter on the last 3s; the final second is the
    // done tap's job, not a tick.
    if (rollStep?.kind === "hold") {
      const sec = Math.floor((snap.progress * rollStep.holdMs) / 1000 + 1e-4);
      if (sec > lastTickSec.current) {
        lastTickSec.current = sec;
        const totalSec = rollStep.holdMs / 1000;
        if (sec < totalSec) playTick(totalSec - sec <= 3);
      }
    }
    if (rollStep?.kind === "roll") {
      const filled = Math.floor(snap.progress * ARC_SEGS + 1e-4);
      // Same feedback for rolls, but spatial: tick as each arc segment fills
      // (the last segment completes the card → done tap instead).
      if (filled > lastArcTick.current) {
        lastArcTick.current = filled;
        if (filled < ARC_SEGS) playTick(false);
      }
      arcSegRefs.current.forEach((el, i) => {
        if (el) el.style.opacity = i < filled ? "1" : "0";
      });
      if (arcDotRef.current) {
        const frac = filled / ARC_SEGS;
        const deg = rollStep.dir === 1 ? 180 * (1 - frac) : 180 * frac;
        arcDotRef.current.style.transform = `translate(${arcX(deg)}px, ${arcY(deg)}px)`;
      }
    }
    if (detailRef.current) detailRef.current.textContent = snap.detail;
    if (snap.index !== hudIndex.current || snap.done !== hudDone.current) {
      // Any card finishing (movement, relax, still) → "done" tap; the final
      // one → the confetti crackle instead. The old-index guard skips restarts.
      if (hudIndex.current >= 0) {
        if (snap.done && !hudDone.current) {
          playCelebrate();
          stageAvatarRef.current?.celebrate();
          musicPlayer.duck();
        }
        else if (snap.index > hudIndex.current) playDone();
      }
      hudIndex.current = snap.index;
      hudDone.current = snap.done;
      lastTickSec.current = 0;
      lastArcTick.current = 0;
      setHud({ index: snap.index, done: snap.done });
    }
  };

  // Manual recenter. Mid-exercise it moves the neutral baseline, so progress
  // earned against the old one is void — restart the current card.
  const recenter = (): void => {
    playerRef.current?.resetCurrent();
    lastTickSec.current = 0;
    lastArcTick.current = 0;
    session?.recenter();
  };

  return (
    <SessionShell onExit={onExit} screen={screen} music={musicPlayer} celebrate={hud.done}>
      {!started ? (
        <SessionLobby
          title="4-Minute Neck Routine"
          subtitle="guided neck mobility"
          screen={screen}
          onStart={beginGame}
          onExit={onExit}
        />
      ) : (
        <>
          {/* Stage: the mesh avatar, same figure as the lobby. */}
          <div className="relative flex aspect-[4/3] w-full max-w-md items-center justify-center">
            <canvas
              ref={stageRef}
              className="pointer-events-none absolute inset-0 h-full w-full"
            />
          </div>

          {/* Game HUD: a reel of step cards. The active card is centered; finished
              cards slide up and off, upcoming ones peek below (dimmed). The reel
              is a fixed-height clipping viewport (that's what makes the slide
              work), so the completion state lives OUTSIDE it — free to grow
              (error line, time field) without clipping. */}
          {!hud.done && (
          <div className="relative w-full max-w-md" style={{ height: `${REEL_H}rem` }}>
            <div className="absolute inset-0 overflow-hidden">
              <div
                className="flex w-full flex-col items-center transition-transform duration-500 ease-out"
                // Bring the active card's top to REEL_PAD; finished cards scroll off.
                style={{ transform: `translateY(${REEL_PAD - Math.max(0, hud.index) * CARD_STEP}rem)` }}
              >
                {NECK_ROUTINE.map((step, i) => {
                  const active = i === hud.index;
                  const past = i < hud.index; // finished — fades out at full size
                  const big = active || past;
                  return (
                    <div
                      key={i}
                      className="flex w-full items-start justify-center"
                      style={{ height: `${CARD_STEP}rem` }}
                    >
                      <div
                        style={{ height: `${big ? ACTIVE_H : NEXT_H}rem` }}
                        className={`flex w-full max-w-xs flex-col items-center justify-center gap-2 rounded-2xl bg-panel px-6 py-5 shadow-lg ring-1 ring-black/5 transition-all duration-500 dark:ring-white/10 ${
                          past ? "opacity-0" : active ? "opacity-100" : "opacity-40"
                        }`}
                      >
                        <p className={`text-center ${active ? "text-base font-medium text-text" : "text-sm text-muted"}`}>
                          {step.label}
                        </p>
                        {/* Set progress for repeated cards (chin tucks): one pip
                            per rep — done solid, current hollow + pulsing — with
                            the count alongside. */}
                        {active && repTotalAt(i) > 1 && (
                          <div
                            className="flex items-center gap-1.5"
                            aria-label={`Set ${REP_OF[i]} of ${repTotalAt(i)}`}
                          >
                            {Array.from({ length: repTotalAt(i) }, (_, d) => (
                              <span
                                key={d}
                                className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
                                  d < REP_OF[i] - 1
                                    ? "bg-accent"
                                    : d === REP_OF[i] - 1
                                      ? "animate-pulse ring-1 ring-inset ring-accent"
                                      : "bg-black/10 dark:bg-white/10"
                                }`}
                              />
                            ))}
                            <span className="ml-1 text-[0.65rem] tabular-nums text-muted">
                              {REP_OF[i]} of {repTotalAt(i)}
                            </span>
                          </div>
                        )}
                        {active && step.kind === "roll" && (
                          <svg viewBox="0 0 100 58" className="flex-none" style={{ width: 76, height: 44 }}>
                            {Array.from({ length: ARC_SEGS }, (_, si) => {
                              // Segments in sweep order from the pass's start end.
                              const [a0, a1] =
                                step.dir === 1
                                  ? [180 - si * ARC_SEG_SPAN - ARC_SEG_PAD, 180 - (si + 1) * ARC_SEG_SPAN + ARC_SEG_PAD]
                                  : [si * ARC_SEG_SPAN + ARC_SEG_PAD, (si + 1) * ARC_SEG_SPAN - ARC_SEG_PAD];
                              const d = arcSeg(a0, a1, step.dir === 1 ? 0 : 1);
                              return (
                                <g key={si}>
                                  <path
                                    d={d}
                                    fill="none"
                                    strokeWidth="6"
                                    strokeLinecap="round"
                                    className="stroke-black/10 dark:stroke-white/10"
                                  />
                                  <path
                                    ref={(el) => {
                                      arcSegRefs.current[si] = el;
                                    }}
                                    d={d}
                                    fill="none"
                                    strokeWidth="6"
                                    strokeLinecap="round"
                                    className="stroke-text transition-opacity duration-300"
                                    style={{ opacity: 0 }}
                                  />
                                </g>
                              );
                            })}
                            {/* Progress dot: sits at the leading edge of what's
                                finished, easing along the arc as segments fill. */}
                            <circle
                              ref={arcDotRef}
                              r="5"
                              className="fill-accent transition-transform duration-300 ease-out"
                              style={{ transform: `translate(${arcX(step.dir === 1 ? 180 : 0)}px, 8px)` }}
                            />
                          </svg>
                        )}
                        {active && step.kind !== "roll" && (
                          <div className="relative flex-none" style={{ height: RING_SIZE, width: RING_SIZE }}>
                            <svg viewBox="0 0 64 64" className="-rotate-90" style={{ height: RING_SIZE, width: RING_SIZE }}>
                              <circle cx="32" cy="32" r={RING_R} fill="none" strokeWidth="5" className="stroke-black/10 dark:stroke-white/10" />
                              <circle
                                ref={ringRef}
                                cx="32"
                                cy="32"
                                r={RING_R}
                                fill="none"
                                strokeWidth="5"
                                strokeLinecap="round"
                                className="stroke-text"
                                strokeDasharray={RING_C}
                                strokeDashoffset={RING_C}
                              />
                            </svg>
                            <span
                              ref={detailRef}
                              className="absolute inset-0 flex items-center justify-center text-sm tabular-nums text-muted"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          )}

          {/* Completion — replaces the reel in normal flow: natural height, so
              the reminder row is free to grow (error line, time field) without
              clipping; min-height matches the reel so the swap doesn't jump. */}
          {hud.done && (
            <div
              className="flex w-full max-w-md animate-[fade-in_0.7s_ease] flex-col items-center gap-4 pt-2"
              style={{ minHeight: `${REEL_H}rem` }}
            >
              <div className="mb-2 text-center">
                <p className="text-2xl font-semibold text-text">Congratulations!</p>
                <p className="mt-1 text-sm text-muted">Routine complete</p>
              </div>
              <ReminderScheduler />
              <Button onClick={onExit} className="mt-1">
                Go back home
              </Button>
            </div>
          )}

          {/* Recenter — below the cards during play (gone once the routine is done). */}
          {!hud.done && (
            <Button onClick={recenter} className="bg-panel shadow">
              Recenter
            </Button>
          )}
        </>
      )}
    </SessionShell>
  );
}
