# Authoring a bop microgame

Instructions for an agent writing a new arcade microgame in one shot. Follow
this and the game will compile, register, play, and dispose cleanly; the last
5% (detection *feel*) is tuned from playtest notes afterward — leave the
tuning constants named and grouped at the top of the file so that pass is
cheap.

**What bop is:** a webcam neck-exercise tool. The player's tracked head and
torso are the only controller. Every game must exercise a movement channel
(that's its purpose), run ~10–16 seconds, and be instantly legible: one verb,
one joke, one way to win.

Read these before writing code — they are the living exemplars:

- `src/minigames/registry.ts` — the contract (small, read all of it)
- `src/minigames/redlight/` — newest full exemplar: full-body runner avatar,
  scrolling world, movement-energy input, DOM overlay, schedule-derived goal
- `src/minigames/dance/dance.ts` — DOM overlay panel, beat judging, NPC crowd
- `src/minigames/taxi/taxi.ts` — survival shape, lane hysteresis, plane judging
- `src/minigames/chomp/chomp.ts` — quota shape, prop building, eat-on-animation
- `src/minigames/drone/drone.ts` — continuous steering, win-outro pattern
- `src/avatar/avatar.ts` + `src/avatar/AbstractAvatar.ts` — what the base
  render loop owns (you must not fight it)


## 1. The contract

A game is one folder `src/minigames/<id>/` with `<id>.ts` (the game) and
usually `avatar.ts` (its avatar subclass), exporting one `MicrogameDef`:

```ts
export const fooDef: MicrogameDef = {
  id: "foo",                       // stable slug; also the practice-page key
  title: "Punchy Name",            // 2–4 words, jokes welcome (see §8)
  headline: "Fake 2026 headline",  // satirical news line on the prompt card
  prompt: { lead: "small words", action: "VERB" },  // "shake to" / "RUN"
  hint: "one line · with · separators",             // shown on prompt + practice
  timeoutWins: true,               // ONLY for survival games; omit otherwise
  durationMs: 15_000,              // ONLY if 10s genuinely isn't enough; omit otherwise.
                                   // Also accepts (level) => ms when harder levels
                                   // (bigger quotas) should buy more time — read it
                                   // via gameDurationMs(def, level) in harness code.
  create(canvas, session, level) {
    const avatar = session.attachAvatar(canvas, FooAvatar); // returns FooAvatar
    return new FooGame(avatar, session, level, canvas.parentElement!);
  },
};
```

Register it: one import + one entry in `MICROGAMES` in
`src/minigames/registry.ts`. That's the whole integration — the arcade
director, the practice page, and the dev panel all pick it up automatically.
Also add a row to the lineup table in `docs/arcade-plan.md`.

The running instance implements `Microgame`:

```ts
interface Microgame {
  update(f: FrameResult, dt: number): void; // every frame while playing
  readonly outcome: "pending" | "win" | "lose"; // director ends the game when it leaves "pending"
  readonly hud?: string;                     // optional "2 / 5" progress chip
  dispose(): void;                           // release EVERYTHING create() claimed
}
```

Rules the director enforces around you:

- `update` gets `dt` in ms, **clamped to 100** — a background tab does not
  fast-forward your game, but never assume 16ms either. All motion must be
  `dt`-integrated. Never use wall-clock time; accumulate `this.t += dt`.
- The clock is `durationMs ?? 10_000`. Timeout = loss unless `timeoutWins`.
- The frame `outcome` leaves `"pending"`, the director disposes you and cuts
  to the result card. So: **decide, then linger.** If your win/loss has an
  animation (a fall, an explosion, a last hit flashing), keep outcome
  `"pending"` while it plays (`decidedAt` + `LINGER_MS` pattern in
  dance/redlight; capped `WIN_OUTRO_MS` in drone — the outro must still
  resolve before the clock or a last-second win times out as a loss).
- The director plays the win/fail stingers and music ducking. In-game you
  only use `playTick(false)` (soft) / `playTick(true)` (sharp) from
  `src/audio/sfx.ts` for beats, hits, warnings.
- Difficulty enters ONLY through `level` (1–5). One def, five levels — never
  two registry entries. Per-level tuning lives in arrays indexed `[level-1]`.


## 2. The avatar: the playfield IS the avatar's scene

There is no separate game renderer. You subclass `AbstractAvatar`, attach it
via `session.attachAvatar(canvas, FooAvatar)`, and build your world inside
its `scene`. The base class renders every frame on its own loop and drives
the figure from live tracking (head rotation, mouth, blinks, torso tilt).

**The one law: the base render loop writes `headPivot`, `bodyGroup`, and
`torsoGroup` transforms every frame.** Any game-owned motion (slide, jump,
lane, scale, placement) must live on PARENT groups you create; any writes to
those three groups will be overwritten next frame. Standard shape:

```ts
export class FooAvatar extends AbstractAvatar {
  // Field initializers run after super(), so the base scene graph exists.
  private slideGroup = new THREE.Group();          // game-owned placement
  readonly stageGroup = new THREE.Group();         // the game parents world meshes here

  constructor(canvas: HTMLCanvasElement) {
    super(canvas);
    this.slideGroup.scale.setScalar(0.5);
    this.slideGroup.position.y = -1.9;
    // add() reparents: the figure moves under your group, pose machinery untouched.
    this.slideGroup.add(this.headPivot, this.bodyGroup);
    this.scene.add(this.slideGroup, this.stageGroup);
  }

  /** Reframe the camera for your staging. */
  protected frameCamera(): void {
    this.camera.position.set(0, 1.5, 11);
    this.camera.lookAt(0, -1.1, -3);
  }

  /** Almost every game wants these two overrides: */
  setZoom(_zoom: number): void {}                  // leaning in must not move the figure
  setPose(pose: HeadPose): void {
    super.setPose({ ...pose, cx: 0, cy: 0 });      // drop head translation, keep rotation
  }
}
```

Why those overrides: gameplay positions (mouth on the slide, runner in its
lane) must be a pure function of game state — if chair-shifting or leaning
moved the figure, judging would be unfair. Keep rotations (they're the
character); drop translations and zoom unless they ARE the mechanic.

**Back-to-camera staging** (runner/pilot facing into the screen): rotate the
figure group `Math.PI` about y AND set `protected viewSign = -1 as const;` —
the flip negates how mirrored channels render, and viewSign compensates.
Forgetting viewSign makes left/right feel backwards. See taxi/redlight
avatars. PITCH is NOT covered by viewSign, and the y-flip visually inverts
x-rotations too — so if the figure's head is visible (a snout, a hat brim),
negate pitch in your setPose override or chin-down will read as chin-up
(the Keep dragon's lesson):
`setPose(p) { super.setPose({ ...p, pitch: -p.pitch, cx: 0, cy: 0 }); }`

**`declare` gotcha:** if your subclass assigns fields inside a method the
BASE constructor calls (e.g. `buildHead`), declare them with
`private declare foo: T;` — a plain field initializer runs after `super()`
and wipes them to `undefined`.

**Chassis to copy rather than invent** (adapt the whole avatar file):

- Bottom-slider with live mouth (Chomp) — food/catch games
- Full-body back-to-camera runner with run cycle + limbs (RedLight; Taxi
  adds jump + lanes) — locomotion games
- Vehicle with dangling figure + chase camera (Drone) — steering games
- Front-and-center figure on a stage with NPC formation (Dance) — copy-me /
  performance games


## 3. Inputs — what `FrameResult` gives you

All angles are in degrees **relative to the player's calibrated neutral**,
and horizontally **mirrored to match the selfie view**.

- `f.metrics.headYaw` / `headPitch` / `headRoll` — pitch is chin-down
  positive and NOT mirrored; yaw/roll are mirrored.
- `f.metrics.torsoTilt` — shoulder lean, mirrored. Check
  `f.metrics.bodyTracked` before trusting torso values, and HOLD your last
  smoothed value when it's false (don't snap to 0 — reacquisition steps must
  not read as movement; see redlight's `prevBodyTracked` guard).
- `f.metrics.headCloseness` / `torsoCloseness` — lean-in/out ratios (>1 =
  closer than neutral). The chin-tuck signal is closeness-based; the `states`
  layer has a proper tuck gesture — prefer it.
- `f.expression` — `mouthOpen` (0..1), eye-closed signals. May be undefined;
  smooth it (chomp/drone).
- `f.states` / `f.events` — the gesture layer: engaged states with
  enter/exit hysteresis (lookLeft/Right/Up/Down, tiltLeft/Right, tuck…) and
  their onset events. Use ONSETS for triggers (taxi's jump), STATES for
  "currently doing X".
- `f.dominant` — the single most-engaged gesture or `"neutral"` (dance
  judges moves against this).
- `f.sequenceEvents` — completed patterns: `"nod"`, `"quick:<gesture>"`.

**The mirror sign trap (most common one-shot bug):** `torsoTilt` and head
roll are positive for a lean toward screen-LEFT... but screen-left is
NEGATIVE x in the scene. Hence chomp's `-f.metrics.torsoTilt / TILT_RANGE`.
When in doubt copy the sign handling from chomp (front-facing) or taxi
(back-facing) verbatim, and say in a comment which way it maps.

Derived-input patterns (copy, don't reinvent):

- **EMA smoothing** for any raw signal: `v += (target - v) * (1 - Math.exp(-dt / TAU_MS))`.
  Raw tilt/mouth jitter; ~70–130ms taus feel right. Make smoothing
  ASYMMETRIC (fast fall) when stopping must feel instant (redlight).
- **Hysteresis quantization** for discrete positions: commit at ±ENTER,
  release below ±EXIT (taxi lanes) — never a single threshold, it chatters.
- **Movement energy** ("any motion counts"): sum |Δangle| across channels /
  dt, deadband ~25°/s for tracker jitter, saturate ~150°/s (redlight).
- **Open/rearm mouth trigger**: fire above OPEN, require close below REARM
  before the next; start UNARMED so a mouth already open at the whistle
  can't fire at t=0 (drone).


## 4. Judging — the accumulated lessons

- **Judge at one plane / one frame.** Moving hazards are judged the frame
  they cross the player's z-plane, as a pure function of game state at that
  instant (taxi). Continuous overlap tests invite double-hits and unfairness.
- **Count on completion, not contact.** Score when the eat/hit animation
  finishes, so the number changes exactly when the object visibly vanishes
  (chomp).
- **Timing windows are ± around the beat** (`|dueIn| <= JUDGE_MS`, dance),
  and misses are declared only when the window is fully past.
- **Violations must persist.** Never eliminate on one bad frame — accumulate
  violation-ms above a tolerance and fire at ~150ms; drain the accumulator
  when clean (redlight).
- **Grace is visible.** If there's a forgiveness window, animate something
  that spans exactly that window so the player can see the timer (redlight's
  doll turn IS the grace). Hidden timers feel arbitrary.
- **Decide the outcome as soon as it's mathematically settled** (enough
  hits / too few chips left), then linger (dance).

Fairness-by-construction rules:

- There is always an out (taxi never blocks all three lanes; consecutive
  escapes differ by ≤1 lane).
- Goals derive from what the session actually offers, not fixed numbers a
  bad roll can break (redlight computes its distance from the rolled light
  schedule). If you generate a random plan, compute the goal FROM the plan.
- Don't reward camping: make the play sweep the movement's range (chomp's
  spawn point random-walks across the band; taxi prefers escape lanes that
  MOVE).
- First-timer mercy at level 1: the first hazard/beat is slower or later
  (redlight stretches its first red's grace 1.25×).
- Levels should feel steep: level 1 winnable by a first-timer mid-flail,
  level 5 demanding crisp full-range movement. Tune via the arrays, not new
  mechanics (vocabulary can stay constant; tempo/grace/quota carry the curve).


## 5. World building

- Visual language: low-poly primitives, `flatShading: true`,
  `MeshStandardMaterial`, composite groups from a handful of parts.
  Silhouette carries recognition (nose for head-turn legibility, flared
  dress vs straight torso, brown nubs make the banana). Muted
  slate/tailwind-ish hexes; the player figure is the emerald family
  (`ACCENT`/`ACCENT_DEEP` from `src/avatar/abstractParts.ts`), NPCs go
  hologram-indigo (dance/redlight), hazards go to their own hue.
- **GPU hygiene:** build every shared geometry/material through a
  `ResourceBag` (`src/minigames/resources.ts`): `const { geo, mat } =
  this.bag;` then `bag.dispose()` in `dispose()`. Meshes are per-instance
  and free; geometries/materials are what leak. Multi-game props (the soccer
  ball) live in `src/minigames/props.ts` as factories.
- Scratch objects for per-frame math live at module scope (drone's
  `WAVE_AXIS`/`WAVE_Q`) — no allocation inside `update`.
- Scrolling worlds: keep the player at a fixed position and move a single
  world/field group past it; entities live at track-local coordinates inside
  that group (redlight).
- `Math.random()` freely — layouts are rolled per-run in the constructor.
  For scattered placement use rejection sampling with bounded tries (drone).


## 6. DOM overlays (2D UI inside the playfield)

Crisp text/icons want DOM, not 3D. Build elements imperatively, append to
`canvas.parentElement!` (the positioned, overflow-hidden playfield div —
pass it into the game via `create`), animate via `style.transform` per frame,
and **remove your elements in `dispose()`**. React never sees any of this.
Top-left corner is the countdown ring, bottom-left the HUD chip — keep
overlays to the right edge or top-center (dance's panel owns the right
edge; redlight's pill sits top-center).


## 7. Never do

- No React imports, no per-frame React state, no touching anything in
  `src/ui/` — the game is plain TS driven by `update()`.
- No writes to `headPivot`/`bodyGroup`/`torsoGroup` transforms (base loop
  owns them) — parent groups only.
- No caching GL state across games; every play gets a fresh keyed canvas.
- No `setTimeout`/`requestAnimationFrame`/wall-clock for gameplay — all time
  flows through `dt`.
- No sounds besides `playTick` (the director owns stingers).
- No absolute-position gameplay from head translation — rotation and
  named gestures are the input vocabulary.
- Don't forget `session.detachAvatar()` in `dispose()` — it's what tears
  down the renderer.


## 8. Tone

Titles and headlines are deadpan 2026 satire; the joke and the mechanic
should be the same thing (the doll turning IS red light; "assertive mode"
robotaxis ARE the dodge). Existing set: "All You Can Eat" / lab-grown
burgers, "Jaywalker" / assertive robotaxis, "Special Delivery" / ceasefire
drones, "Fake It Till You Make It" / hologram idols, "Green Light, Red
Light" / killer doll on daytime TV. Two-tier prompt: tiny lead-in, huge
verb. Hint: one line, `·`-separated clauses, lowercase.


## 9. Movement channels (pick the under-served one)

The point of a new game is exercising a channel. Coverage today: lean/tilt
(chomp, taxi), yaw+roll gestures (dance), continuous roll (drone),
whole-body movement energy + inhibition (redlight). Under-served, in
priority order: **chin tuck** (the flagship therapeutic move), sustained
holds/stillness, slow controlled motion (speed-capped movement), maximum
range-of-motion, pitch (look up/down), smooth cyclic motion. State in the
game's header comment which channel it exercises.


## 10. Checklist before you're done

1. Folder `src/minigames/<id>/` with `<id>.ts` + `avatar.ts`; header comment
   explains the game, the movement channel, and any judging subtleties.
2. Def exported; registered in `registry.ts`; row added to
   `docs/arcade-plan.md`.
3. All tuning constants named, grouped, commented at the top; per-level
   arrays indexed `[level-1]`, length 5.
4. Avatar: parent-group motion only; `setZoom`/`setPose` overridden;
   `viewSign` if back-to-camera; camera reframed.
5. Every geometry/material through `ResourceBag`; `dispose()` = remove DOM
   overlays + `bag.dispose()` + `detachAvatar()`.
6. Outcome: decide-then-linger; resolves before the clock; `timeoutWins`
   set if survival; `hud` if there's a countable goal.
7. Inputs smoothed; mirror signs verified against chomp/taxi; torso guarded
   by `bodyTracked`; mouth starts unarmed if used as a trigger.
8. Winnable by construction at every level: check the math (goal vs time vs
   speed) in a comment, the way redlight documents its floor.
9. No React, no wall-clock, no stray audio, no allocation in `update`.

Do NOT run the dev server, typecheck, or commit unless asked — hand the game
over for a human playtest; expect feel-tuning notes (grace, snappiness,
thresholds) as the follow-up.
