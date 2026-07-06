# TODO

## Next up

- [x] **Home avatar personality** — implemented (2026-07-04) as an `IdleBrain`
      (`src/avatar/idleBrain.ts`, plain TS) layered over the hero's base sway:
      the character is an energetic person doing neck exercises — actions run
      in REPS (double nod, glance L-R, tilt both sides, posture shift) with
      smooth bell-shaped easing (easeInOutCubic, no overshoot), a new set
      1.2–3.2s after the last ends; deep ear-to-shoulder stretch (both sides,
      one set) every ~16–26s; pointer awareness (attend radius 1.6
      canvas-widths, 0.09 dead zone, ~0.3s turn constant, loses interest after
      2s of stillness; suppresses new actions while attending). Reduced-motion
      disables the brain. Tuning lesson: energy must come from cadence and
      full movements, never sudden onset — fast-attack + overshoot easing read
      as menacing twitches, and slow easing read as sluggish; both reverted. Skipped by
      design: constant cursor-following, yawns, extra geometry; blinks were
      built then removed (eye dashes flashing on the featureless hero read
      wrong) — `buildEyeDashes()` stays in `abstractParts.ts` for the play
      avatar's closed-eye look.
- [ ] Hero personality tuning pass: eyeball action frequency/amplitudes and the
      pointer attend feel in the dev server; tune constants in `idleBrain.ts`
- [ ] **Minigames** — WarioWare-style arcade (2026-07-05): `ArcadeScreen` owns
      ONE TrackingSession for the whole arcade — camera + models load on the
      index, calibrate once, stay live across game switches; the active game
      registers a `FrameSink` (FrameResult + dt) and attaches its own avatar
      (`session.detachAvatar()` added for the release). All future games use
      this same input contract.
      Lineup picked 2026-07-04 (fun-vs-effort ranking): Chomp
      (catch/eat, BUILT — see below), "bop says" (Simon with gesture detection,
      cheapest next), Gorillas-style banana lob (turn-based = latency-proof,
      aiming = ROM holds), rhythm (highest ceiling; prototype input latency
      before committing). Cut: pottery wheel (precision on the weakest axis),
      flappy-nod (neck-hostile), paratrooper (outclassed by the lob).
      - [x] Chomp v2: playfield is the real 3D scene — `ChompAvatar`
        (AbstractAvatar in a slide group, mouth mirrors the player) + faceted
        low-poly 3D snacks tumbling in the same scene (`chomp.ts` owns state +
        snack meshes; avatar's loop renders). Recenter button on the screen.
        v1's 2D-canvas face was boring — the 3D mascot IS the draw. Tune
        YAW_RANGE_DEG / MOUTH_EAT / speeds / EAT_R on a real webcam run.

- [ ] **No-camera mode (privacy)** — home screen gets two buttons: "Begin with
      camera" and "Begin without camera". Without-camera is a guided-only run:
      no tracking, steps advance on timers, the 3D avatar *demonstrates* each
      movement instead of mimicking the player, and the recenter button is
      replaced by a pause button (nothing to recenter without tracking).

- [x] **Music & sound** — 13 Pixabay tracks in `public/music` (~78 MB, ships
      with deploys), shuffled queue, plain-TS engine (`src/audio/player.ts`,
      50% volume default), pill UI bottom-right that appears with the
      camera→mesh slide; autoplay on slide, stop on exit. Synth SFX
      (`src/audio/sfx.ts`, non-tonal noise taps): per-second hold ticks
      (brighter last 3s), card-done tap, confetti celebration (foomp +
      stereo crackle + glitter tail) with a music duck (-70% amplitude, 1.2s).
- [ ] Sound polish: tick/tap levels against louder tracks; recenter-landed cue
      still missing; `public/ambient-demo.html` (generative Web Audio sketch)
      kept for reference — delete or move somewhere before public launch.
- [x] **Set pips on repeated cards** — chin tuck cards show per-rep dots +
      "n of m" (generic: any repeated hold step gets it automatically).
- [x] **Face expression on the avatar** — mouth-open / per-eye-closed ratios
      from face landmarks (`src/tracking/face.ts`, pure geometry, no extra
      model pass; also on `FrameResult.expression`); abstract avatar shows a
      mouth that scales open + translucent closed-eye dashes.
- [x] **Scheduling** — reminder scheduler on the completion card
      (`ReminderScheduler.tsx`): "in 2 hours" default, dropdown for other hours /
      tomorrow / up to 3 days (day choices reveal a time field), dev-only
      "in 2 minutes"; plus confetti blast + completion text.

## Before merging to main (merge = deploy to bop.ashween.com)

- [x] Commit the working tree (routine fixes, arc segments, reminder plumbing, `server/`) — `ae655a2`, pushed
- [x] **Restore the full routine** — `NECK_ROUTINE` is the full set again
      (5 tuck sets); temp `TEST_ROUTINE` block deleted (2026-07-04)
- [ ] Sanity pass of the whole flow start-to-finish once at full length

## Detection tuning (verify against the live dev readout)

- [ ] Chin tuck with the new signal (head-Z only + torso stillness guard):
      check a real tuck's peak on the "Tuck depth" meter — `enter 0.018` may need
      adjusting now that the torso term no longer contributes
- [ ] `torsoBand 0.04`: watch "Shoulder depth" during honest tucks; widen if the
      veto trips on breathing/sway
- [ ] Roll arc feel: `ARC_MIN_MAG 0.25`, `ARC_END_TOL 50`, `ARC_SMOOTH_MS 250` —
      confirm passes complete comfortably at the camera's angle
- [ ] Roll direction: chevrons were removed (dot-only) — confirm the sweep
      direction still reads; if not, revisit a direction cue

## Reminders (backend is deployed: bop-api.ashween.com)

- [x] Local end-to-end test: scheduled from the app UI → sweep → notification
      shown (2026-07-03). Note: wrangler must be run with `--config wrangler.toml`
      (now pinned in server scripts) or it picks up the root wrangler.jsonc.
- [x] Wire the UI: `ReminderScheduler` on the completion card — calls
      `scheduleReminder()`, hidden behind `remindersSupported()`
- [ ] Production smoke test after the site deploys (schedule from
      bop.ashween.com, wait out one 5-min sweep)

## Later / nice-to-have

- [ ] PWA manifest + icons → installable, and required for iOS push at all
- [ ] Notification icon: add an `icon` to `showNotification` in `public/sw.js`
      (currently shows the browser default)
- [ ] Favicon for the public site (title "bop" + meta description — "Guided
      neck exercises, tracked by your webcam." — are in index.html; OpenGraph
      tags still missing if link previews matter)
- [ ] Personal homepage → ashween.com: placeholder scaffolded at
      `~/Desktop/work/ashween.com` (git-initialized, uncommitted) — create the
      GitHub repo, push, connect to Pages (no build step, output `/`), attach
      `ashween.com` + `www`
- [ ] Consider GitHub Action to auto-deploy `server/` on push once it churns
