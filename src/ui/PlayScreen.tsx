// The play screen (#play): the staging area before the game. It fades in (a
// crossfade with the home's fade-out) and walks through a calm onboarding:
//   idle → the camera starts automatically on mount (arriving here is the
//          intent to play); errors fall back to an overlay with "Try again".
//   live → the camera shows with the face dots while you get comfortable. Once
//          the head holds still for a couple seconds, a slider auto-slides 0→1,
//          driving a STAGED crossfade:
//            0.00–0.33  the camera video fades out; the dots stay.
//            0.33–1.00  the dots fade and the tracking mesh is revealed.
//          The mesh is the tracking avatar (driven by the head), so once it's in
//          view you control it. At full-mesh: "Nod your head to begin." — a nod
//          (a downward look) arms the Start game button. The slider is grabbable
//          to override the auto-slide.
// Per-frame work (overlay drawing, stillness, nod) is imperative through refs;
// only the slider value (a bounded UI animation), phase, and nod-armed use state.

import { useEffect, useRef, useState } from "react";
import * as Switch from "@radix-ui/react-switch";
import { VideoCameraIcon, ExclamationTriangleIcon, ArrowLeftIcon } from "@heroicons/react/24/outline";
import { SettingsMenu } from "./SettingsMenu.tsx";
import { Button } from "./Button.tsx";
import { ConfettiBurst } from "./ConfettiBurst.tsx";
import { ReminderScheduler } from "./ReminderScheduler.tsx";
import { MusicPlayer } from "./MusicPlayer.tsx";
import { musicPlayer } from "../audio/player.ts";
import { playCelebrate, playDone, playTick } from "../audio/sfx.ts";
import { TrackingSession, type FrameResult } from "../tracking/session.ts";
import { AbstractAvatar } from "../avatar/AbstractAvatar.ts";
import { StackPlayer } from "../game/stackPlayer.ts";
import { NECK_ROUTINE } from "../game/routine.ts";

const FACE_COLOR = "rgba(52, 211, 153, 0.8)";
const SHOULDER_LINE = "rgba(255, 180, 80, 0.9)";
const SHOULDER_DOT = "rgba(255, 140, 40, 0.95)";

// Stillness gate → auto-slide. Per-frame head-angle change (deg) below
// STILL_THRESH is "still"; HOLD_MS of it triggers the slide, which runs SLIDE_MS.
const STILL_THRESH = 1.4;
const HOLD_MS = 1000;
const SLIDE_MS = 1000;
// The crossfade split: camera fades over [0, SPLIT]; dots→mesh over [SPLIT, 1].
const SPLIT = 0.33;
// Cap per-frame elapsed time so a background-tab gap can't jump a hold timer.
const MAX_DT = 100;

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

type Phase = "idle" | "live";

export function PlayScreen({ onExit }: { onExit: () => void }) {
  const [shown, setShown] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  // Crossfade position: 0 = all camera, 1 = all mesh.
  const [morph, setMorph] = useState(0);
  // The switch state (off = camera, on = mesh).
  const [on, setOn] = useState(false);
  // The game has begun (via a nod, or the Begin button) → staging chrome clears.
  const [started, setStarted] = useState(false);
  // Which step is active + whether we're done (discrete state; the reel slides to
  // this index, and the timer ring on the active card updates via refs).
  const [hud, setHud] = useState<{ index: number; done: boolean }>({ index: -1, done: false });
  // Set when the camera fails to start (permission denied, no device, etc.).
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const avatarRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<TrackingSession | null>(null);

  // Stillness bookkeeping + the auto-slide animation handle.
  const prevAngles = useRef<{ yaw: number; pitch: number; roll: number } | null>(null);
  const lastTs = useRef(0);
  const stillMs = useRef(0);
  const sliding = useRef(false);
  const animId = useRef(0);
  const morphRef = useRef(0); // mirrors morph for the animator (state is stale in rAF)
  // Set between "held still long enough" and "recenter finished" — the slide
  // starts when the recenter's neutral capture lands (onCalibrated).
  const pendingSlide = useRef(false);
  // Nod detection is armed only once the mesh is fully in view; the game begins
  // on the first nod (guarded so it only happens once).
  const nodArmed = useRef(false);
  const startedRef = useRef(false);
  // Music autoplays when the camera→mesh slide first heads to the mesh — once;
  // pausing stays paused.
  const musicStarted = useRef(false);

  // The routine player + per-frame HUD refs (timer ring updated imperatively).
  const playerRef = useRef<StackPlayer | null>(null);
  const lastPlayTs = useRef(0);
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

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Tear down the session (and camera) + any running slide when we leave; the
  // music belongs to the session, so it stops (pauses) with it.
  useEffect(
    () => () => {
      cancelAnimationFrame(animId.current);
      sessionRef.current?.stop();
      musicPlayer.stop();
    },
    [],
  );

  // The camera starts on its own — arriving here is already the intent to play
  // (a failure falls back to the error overlay's "Try again").
  useEffect(() => {
    startCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ease morph toward a target (0 = camera, 1 = mesh) over SLIDE_MS, scaled by
  // the distance so a partial move doesn't take the full time.
  const slideTo = (target: number): void => {
    // Sliding to the mesh is the moment the session really starts — kick off
    // the music (once; a later manual pause stays paused).
    if (target === 1 && !musicStarted.current) {
      musicStarted.current = true;
      musicPlayer.play();
    }
    cancelAnimationFrame(animId.current);
    const from = morphRef.current;
    const dur = Math.max(1, SLIDE_MS * Math.abs(target - from));
    const t0 = performance.now();
    const tick = (now: number): void => {
      const p = Math.min(1, (now - t0) / dur);
      const v = from + (target - from) * p;
      morphRef.current = v;
      setMorph(v);
      if (v >= 1) nodArmed.current = true;
      if (p < 1) animId.current = requestAnimationFrame(tick);
    };
    animId.current = requestAnimationFrame(tick);
  };

  // Toggle the switch: flip the state and crossfade to it.
  const toggle = (v: boolean): void => {
    pendingSlide.current = false;
    sliding.current = true;
    setOn(v);
    slideTo(v ? 1 : 0);
  };

  // Accumulate held-still time; kick off the auto-slide once it clears HOLD_MS.
  const trackStillness = (f: FrameResult): void => {
    if (sliding.current) return;
    if (f.calibrating) {
      stillMs.current = 0;
      prevAngles.current = null;
      lastTs.current = 0;
      return;
    }
    const now = performance.now();
    const a = {
      yaw: f.metrics.headYaw,
      pitch: f.metrics.headPitch,
      roll: f.metrics.headRoll,
    };
    const prev = prevAngles.current;
    if (prev && lastTs.current) {
      const dt = now - lastTs.current;
      const move =
        Math.abs(a.yaw - prev.yaw) +
        Math.abs(a.pitch - prev.pitch) +
        Math.abs(a.roll - prev.roll);
      stillMs.current =
        move < STILL_THRESH ? stillMs.current + dt : Math.max(0, stillMs.current - dt * 2);
      if (stillMs.current >= HOLD_MS) {
        // Recenter right before the slide; startAutoSlide fires from
        // onCalibrated once the fresh neutral pose is captured.
        sliding.current = true;
        pendingSlide.current = true;
        sessionRef.current?.recenter();
      }
    }
    prevAngles.current = a;
    lastTs.current = now;
  };

  // Once meshed, a real nod (neutral → brief look-down → neutral) unlocks Begin.
  const detectNod = (f: FrameResult): void => {
    if (!nodArmed.current || startedRef.current) return;
    if (f.sequenceEvents.some((e) => e.name === "nod")) beginGame();
  };

  // Begin the game — from a nod or the Begin button. Clears the staging chrome;
  // the session keeps running so the game reads gestures from here on.
  const beginGame = (): void => {
    if (startedRef.current) return;
    startedRef.current = true;
    restartGame();
    setStarted(true);
  };

  // Fresh player + HUD bookkeeping — used at first begin and by "Again".
  const restartGame = (): void => {
    playerRef.current = new StackPlayer(NECK_ROUTINE);
    lastPlayTs.current = 0;
    hudIndex.current = -1;
    hudDone.current = false;
    recenterPending.current = false;
    lastTickSec.current = 0;
    lastArcTick.current = 0;
    setHud({ index: -1, done: false });
  };

  // Advance the routine each frame while playing: the timer ring updates via a
  // ref (ticking, not smooth), discrete exercise/phase/done changes via state.
  const runGame = (f: FrameResult): void => {
    const player = playerRef.current;
    if (!startedRef.current || !player) return;
    const now = performance.now();
    const dt = Math.min(MAX_DT, lastPlayTs.current ? now - lastPlayTs.current : 0);
    lastPlayTs.current = now;
    const snap = player.update(f, dt);

    // The player asks to recenter once it's been still; do it, then confirm.
    // (It re-asks after a timeout if the recenter never lands, so honor every
    // request — recentering twice is harmless.)
    if (snap.requestRecenter) {
      recenterPending.current = true;
      sessionRef.current?.recenter();
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

  const startCamera = async (): Promise<void> => {
    if (sessionRef.current) return;
    setError(null);
    setPhase("live");

    const video = videoRef.current!;
    const overlay = overlayRef.current!;
    const ctx = overlay.getContext("2d")!;

    const session = new TrackingSession({
      onStatus: setStatus,
      onCalibrated: (isRecenter) => {
        if (!isRecenter) return;
        // The pre-slide recenter just landed → flip the switch on and crossfade.
        if (pendingSlide.current) {
          pendingSlide.current = false;
          setOn(true);
          slideTo(1);
          return;
        }
        // A per-exercise recenter (the "hold still" gate) just landed → start it.
        if (recenterPending.current) {
          recenterPending.current = false;
          playerRef.current?.recentered();
        }
      },
      onFrame: (f) => {
        draw(ctx, overlay, video, f);
        trackStillness(f);
        detectNod(f);
        runGame(f);
      },
    });
    sessionRef.current = session;
    session.attachAvatar(avatarRef.current!, AbstractAvatar);

    try {
      await session.start(video);
    } catch (err) {
      console.error("bop start failed:", err);
      setError(cameraErrorMessage(err));
      sessionRef.current?.stop();
      sessionRef.current = null;
      setPhase("idle");
    }
  };

  // Manual recenter. Mid-exercise it moves the neutral baseline, so progress
  // earned against the old one is void — restart the current card.
  const recenter = (): void => {
    if (startedRef.current) {
      playerRef.current?.resetCurrent();
      lastTickSec.current = 0;
      lastArcTick.current = 0;
    }
    sessionRef.current?.recenter();
  };

  // Staged crossfade opacities from morph.
  const camOpacity = 1 - Math.min(morph, SPLIT) / SPLIT;
  const dotsOpacity = morph <= SPLIT ? 1 : Math.max(0, 1 - (morph - SPLIT) / (1 - SPLIT));
  const meshOpacity = morph <= SPLIT ? 0 : Math.min(1, (morph - SPLIT) / (1 - SPLIT));

  const meshed = morph >= 1;
  const prompt =
    phase !== "live" ? "" : meshed ? "Nod your head to begin." : "Sit in a comfortable position.";

  return (
    <div
      className={`relative flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-6 pb-24 text-text transition-opacity duration-500 ${
        shown ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="absolute right-4 top-4">
        <SettingsMenu />
      </div>

      {/* Back to home — the unmount effect stops the session/camera. */}
      <button
        onClick={onExit}
        aria-label="Back to home"
        className="absolute left-4 top-4 rounded-full p-2 text-muted transition hover:bg-black/5 hover:text-text dark:hover:bg-white/10"
      >
        <ArrowLeftIcon className="h-5 w-5" />
      </button>

      {/* Stage: camera box, dots overlay, and mesh are three stacked layers whose
          opacities the slider crossfades. The video stays mounted (even faded)
          as the detection source, so the session keeps driving the mesh. */}
      <div className="relative flex aspect-[4/3] w-full max-w-md items-center justify-center">
        {/* Camera box (fades out over the first third). */}
        <div className="absolute inset-0" style={{ opacity: camOpacity }}>
          <div className="relative h-full w-full overflow-hidden rounded-2xl bg-black/5 ring-1 ring-black/10 dark:bg-white/5 dark:ring-white/10">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 h-full w-full -scale-x-100 object-cover grayscale"
            />
            {phase === "idle" && !error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <VideoCameraIcon className="h-10 w-10 text-muted" />
                <span className="text-xs text-muted">Camera preview</span>
              </div>
            )}

            {error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                <ExclamationTriangleIcon className="h-10 w-10 text-red-500" />
                <span className="text-sm font-medium text-text">Camera unavailable</span>
                <span className="text-xs text-muted">{error}</span>
                <Button onClick={startCamera} className="mt-1">
                  Try again
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Face dots (stay through the first third, then fade). */}
        <canvas
          ref={overlayRef}
          className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100"
          style={{ opacity: dotsOpacity }}
        />

        {/* Tracking mesh (revealed from the split onward). */}
        <canvas
          ref={avatarRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ opacity: meshOpacity }}
        />

        {phase === "live" && status && morph < SPLIT && (
          <div className="absolute bottom-3 left-3 rounded-md bg-black/60 px-2.5 py-1 text-sm text-accent">
            {status}
          </div>
        )}
      </div>

      {/* Controls area: fixed height so the stage doesn't jump. Grows into the
          card reel once the routine starts. */}
      <div
        className="relative flex w-full max-w-md flex-col items-center gap-4 transition-[height] duration-500"
        style={{ height: started ? `${REEL_H}rem` : "9rem" }}
      >
        {phase === "live" && !started && (
          <Switch.Root
            checked={on}
            onCheckedChange={toggle}
            aria-label="Camera to avatar"
            className="relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full bg-black/15 outline-none transition focus-visible:ring-2 focus-visible:ring-accent data-[state=checked]:bg-accent dark:bg-white/15"
          >
            <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
          </Switch.Root>
        )}

        {/* Prompt + actions (reserve their rows so nothing jumps as the nod
            unlocks Start game). */}
        <p className={`text-lg font-medium text-text transition-opacity ${phase === "live" && !started ? "opacity-100" : "opacity-0"}`}>
          {prompt || " "}
        </p>
        <div
          className={`flex items-center gap-3 transition-opacity ${
            meshed && !started ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <Button onClick={recenter}>Recenter</Button>
          <Button onClick={beginGame}>Begin</Button>
        </div>

        {/* Game HUD: a reel of step cards. The active card is centered; finished
            cards slide up and off, upcoming ones peek below (dimmed). */}
        {started && (
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
              {/* Completion — no card, just the message and the reminder row;
                  invisible until the routine is done, then fades in. */}
              <div className="flex w-full items-start justify-center" style={{ height: `${CARD_STEP}rem` }}>
                {/* Top-aligned, not centered — centering in the reel-sized box
                    left a dead band between the stage and the heading. */}
                <div
                  className={`flex w-full flex-col items-center gap-4 pt-2 transition-opacity duration-700 ${
                    hud.done ? "opacity-100" : "opacity-0"
                  }`}
                >
                  <p className="text-2xl font-semibold text-text">Routine complete!</p>
                  <ReminderScheduler />
                  <Button onClick={onExit} className="mt-1">
                    Go back home
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Confetti blast over the whole screen when the routine completes;
          "Again" resets hud.done, so the next completion fires a fresh burst. */}
      {hud.done && <ConfettiBurst />}

      {/* Recenter — below the cards during play (gone once the routine is done). */}
      {started && !hud.done && (
        <Button onClick={recenter} className="bg-panel shadow">
          Recenter
        </Button>
      )}

      {/* Music pill: hidden through camera staging; fades in once detection has
          settled and the camera→mesh slide is underway. */}
      <div
        className={`absolute bottom-4 right-4 transition-opacity duration-700 ${
          morph > 0 ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <MusicPlayer />
      </div>
    </div>
  );
}

// Turn a getUserMedia / model-load failure into a short, human message.
function cameraErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Camera access was blocked. Allow it in your browser and try again.";
      case "NotFoundError":
      case "OverconstrainedError":
        return "No camera was found on this device.";
      case "NotReadableError":
        return "The camera is in use by another app.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong starting the camera.";
}

// Draw the face landmarks + shoulder line for the current frame onto the
// (mirrored) overlay canvas, matching the dev page's diagnostics look.
function draw(
  ctx: CanvasRenderingContext2D,
  overlay: HTMLCanvasElement,
  video: HTMLVideoElement,
  f: FrameResult,
): void {
  if (overlay.width !== video.videoWidth && video.videoWidth) {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
  }
  const W = overlay.width;
  const H = overlay.height;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = FACE_COLOR;
  for (const p of f.faceLandmarks) {
    ctx.beginPath();
    ctx.arc(p.x * W, p.y * H, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  const lm = f.body?.landmarks2d;
  if (lm && lm.length >= 13) {
    const [l, r] = [lm[11], lm[12]]; // shoulders
    if ((l.visibility ?? 1) >= 0.5 && (r.visibility ?? 1) >= 0.5) {
      ctx.strokeStyle = SHOULDER_LINE;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(l.x * W, l.y * H);
      ctx.lineTo(r.x * W, r.y * H);
      ctx.stroke();

      ctx.fillStyle = SHOULDER_DOT;
      for (const p of [l, r]) {
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
