# Bop Arcade — WarioWare mode, 2026 edition

> Building a new microgame? Follow `docs/microgame-authoring.md` — the
> one-shot authoring guide (contract, avatar law, input patterns, judging
> lessons, checklist).

The arcade becomes a single WarioWare-style run: no game picker. Enter →
camera calibrates (mesh pulses, then goes live; music starts) → "Nod to
start" → cutscene → 10s microgame → cutscene → … Lives run out or round 5
survived → end screen.

## Run structure

- **Round** = 8 microgames drawn from a shuffled bag (no repeats until the
  bag of 12 empties, then reshuffle).
- After 8 games → **level +1** (1→5), shown ticking up in the cutscene.
- **Lives**: start 4; fail a game → −1; 0 → game over + score screen.
- **Boss slot** (BUILT): after game 8 of every round, a final boss plays
  instead of a bag draw — it GATES the level. A loss costs a life and
  replays the SAME fight; a win opens the next level, and beating the
  level-5 boss is the run's win screen. Bosses are not in the bag; they
  appear in the practice picker, get a red action word on the prompt card,
  and a diamond pip after the 8 dots on the stats card. Several boss
  candidates are being tried (`BOSSES` in the registry — currently The
  Keep; The Algorithm was cut, its dodge/tuck stack too flaky seated): the
  director draws one per round,
  varying across rounds, and the dev panel can pin the pool to one candidate.
- **Score** = games cleared (bosses count). Full run = 5×(8+1) = 45 plays.
- Catalog math: 12 games × 5 levels = 60 variants. "150" needs 30 games —
  later target, spares list below.
- OPEN QUESTION: end after round 5 (recommended, winnable session) vs
  endless at level cap until lives run out.

## Cutscene (~3s between every game)

1. **Stats card** (~1.2s): `LEVEL 2 · ROUND 2/5 · ♥♥♥`. The changed stat
   animates (level digit rolls up, lost heart pops/greys). Flash in fast,
   hold, flash out.
2. **Prompt card** (~1.2s): two-tier type — lead-in small, action word huge
   ("tilt to" / **BALANCE**), plus a tiny fake-2026-headline flavor line and
   a control hint.
3. Game fades in with a 10s countdown ring (reuse the routine ring), result
   stinger (win chime / life-lost thud + music duck), game fades out.

## Registry format

```ts
// src/minigames/registry.ts
export interface MicrogameDef {
  id: string;
  title: string;
  headline: string;                         // 2026-news flavor line
  prompt: { lead: string; action: string }; // "tilt to" + "BALANCE"
  hint: string;                             // "roll your head to keep the tray level"
  create(canvas: HTMLCanvasElement, session: TrackingSession, level: 1|2|3|4|5): Microgame;
}

export interface Microgame {
  update(f: FrameResult, dt: number): void; // the FrameSink
  readonly outcome: "pending" | "win" | "lose";
  dispose(): void;
}

export const MICROGAMES: readonly MicrogameDef[] = [ /* the 12 */ ];
```

A plain-TS `ArcadeDirector` owns the state machine
(`nod-wait → stats → prompt → playing → result → …`), bag shuffle,
lives/level/round, and emits coarse state to React (same split as
StackPlayer/PlayScreen). Games render via their own Avatar subclass
(pattern proven by ChompAvatar). Difficulty enters ONLY through
`create(..., level)`.

## The 12 games

Gesture vocabulary: yaw turn, pitch nod, roll tilt, lean (zoom), mouth
open, chin tuck, hold-still.

| # | Title | Headline (2026 flavor) | Prompt | Control / win | Level-5 twist |
|---|-------|------------------------|--------|---------------|---------------|
| 1 | All You Can Eat | Lab-grown burger cheaper than beef | open wide and **EAT** | tilt to slide, mouth to chomp falling food (= Chomp re-skinned) | faster drops, junk food to avoid |
| 2 | Fake It Till You Make It | Hologram idol group tops charts | copy the **DANCE** | mirror the dancers' 3-move sequence in rhythm; win ≥2/3 | 5 moves, faster tempo |
| 3 | Special Delivery | Ceasefire monitored by drone fleet | tilt to **STEER** | roll/yaw steers drone; drop payload on tank hatch | wind gusts, moving tank |
| 4 | Header! | World Cup final week | nod to **SCORE** | nod at the right instant to head the cross past the keeper | faster crosses, 2 goals needed |
| 5 | Balance | Leaders' banquet, one long table | tilt to **BALANCE** | head roll keeps plate stack upright on rocking floor; survive 10s | taller stack, stronger shoves |
| 6 | Jaywalker | Robotaxis outnumber drivers | lean to **DODGE** | lean to dodge robotaxis, nod to jump curbs; survive | denser traffic, double obstacles |
| 7 | AI Says | 'Assistant Act': AIs must say please | obey **AI SAYS** | do only "AI says"-prefixed commands; ≤1 mistake | faster commands, sneakier traps |
| 8 | Touchdown | Third private Moon lander this year | open to **BURN** | mouth open = thruster; land soft, don't run out of fuel | less fuel, boulder field (tilt to drift) |
| 9 | Slalom | Milan-Cortina stars go pro | carve the **SLALOM** | roll to carve through gates; miss ≤1 | tighter offset gates, ice patches |
| 10 | Space Junk | Orbit cleanup treaty | turn to **CATCH** | yaw aims the net at drifting debris; catch N | smaller faster junk, decoy satellites |
| 11 | Limbo | Debt ceiling bar keeps dropping | tuck to **LIMBO** | chin-tuck to slip under the sweeping bar (flagship health move) | lower bar, double-tuck rhythm |
| 12 | Stay Live | Anchor's 36th straight hour | hold **STEADY** | keep head level/still while the studio shakes | narrower band, jump scares |
| 13 | Green Light, Red Light | Killer doll wins daytime TV, again | shake to **RUN** | head-shakes pump a run charge; freeze when the doll turns; reach the line | longer course, shorter greens/graces |
| 14 | Prove You're Human | CAPTCHA v9 requires interpretive dance | memorize, then **MIMIC** | cards reveal a move sequence for 3s, flip down; perform from memory, two tries per card | 6-card sequence |
| ★ | Final Boss: The Algorithm | Recommendation engine achieves physical form | dodge, then **STRIKE** | boss slot after every round: tilt away from side posts, tuck under banners (judged at the player plane); when the eye opens, land the flashed gesture card inside the shrinking ring to crack a core; deplete cores to win, lose the shield pips = KO | more cores, bigger/faster volleys, shorter windows, thinner shield |
| ★ | Final Boss: The Keep | Rewilded dragons torch record number of castles | feast, then **TORCH** | boss-pool candidate, YOU are the dragon (chase cam, Drone chassis: tilt banks the turn): fly around the keep, fly into floating embers to auto-swallow them (stock up to 3 — the dragon clutches one glowing orb each + belly lights), open mouth to breathe a fireball per open — windows glow when the shot lines up; the keep mortars flaming boulders at a point leading your flight (ring + filling disc telegraph = the flight time), turn to dodge; burn its HP down to win, boulder hits = KO | more HP, faster/steadier mortars, shorter flights, bigger blasts, thinner shield |

Spares (road to 30): Stamp It (nod-stamp election ballots on a conveyor),
Sun Chaser (tilt solar panel to track the sun), Splashdown (lean capsule
into recovery ring), Penalty Save (lean to dive as keeper).

## Build order

0. Micro-tidies: move `cameraErrorMessage` out of PlayScreen.tsx into its
   own module (arcade importing from PlayScreen is a wrong-direction dep);
   move the `FrameSink` type from ArcadeScreen.tsx into src/minigames/.
1. Registry + ArcadeDirector + nod-to-start wired into ArcadeScreen (grid
   removed).
2. Cutscene chrome: stats ticker card, prompt card (two-tier type), fades,
   countdown ring.
3. Port Chomp into the registry as game #1 with 5 difficulty mappings —
   proves the loop end to end.
4. Ship remaining games in batches of ~3 (good subagent fan-out: each is an
   independent contract-shaped task; cheapest mechanics first — Limbo,
   Stay Live, Space Junk; steering games next; sequence games (AI Says,
   Fake It) last, they need a command/choreography system).
5. Game-over / win screens, score persistence.

## Existing foundations (already built, July 2026)

- One shared TrackingSession per arcade visit; games attach avatars via
  `session.attachAvatar(canvas, AvatarCtor)` / `detachAvatar()`.
- FrameSink contract + MAX_DT clamp in ArcadeScreen; ChompGameView is the
  reference game integration.
- Arcade music: `arcadeMusicPlayer` (src/audio/player.ts) over
  `ARCADE_TRACKS` (public/music/games/), starts on `ready`, stops on exit;
  MusicPlayer pill takes a `player` prop.
- Calibration: 800ms warm-up + stillness-gated sampling (CALIB_STILL_DEG);
  avatar holds rest posture until first neutral (`hasNeutral`).
- Depth + face center are expression-invariant (interocular distance,
  yaw-corrected; skull-rigid centroid) — mouth-open no longer moves the
  head. Rotation (pitch) still comes from the whole-face matrix fit.
