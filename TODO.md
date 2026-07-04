# TODO

## Next up

- [ ] **Home avatar personality** — the hero reads robotic because its idle is
      pure fixed-period sinusoids. Agreed plan (2026-07-04), in payoff order:
      1. Blinks: move the closed-eye dash meshes from `AbstractAvatar` into
         `abstractParts.ts` so the hero can use them; blink every 2–6s
         (randomized), ~120ms, occasional double-blink.
      2. Replace the exact-2s nod with a randomized idle-action picker (every
         4–10s: nod / side glance / small tilt / posture shift) with
         asymmetric easing (fast out, slow settle, slight overshoot).
      3. Signature move: slow ear-to-shoulder neck stretch (~every 20s, both
         sides) — mascot demos the product.
      4. Pointer awareness: lazy head-turn toward cursor near the avatar or
         hovering Begin; dead zone so it "notices" rather than tracks.
      Skip: constant cursor-following, yawns, extra geometry (fins/crown
      experiment was tried and reverted — personality via timing, not parts).
- [ ] **Minigames** — add head-tracked minigames on top of the routine engine
      (candidate ideas discussed: firefly keeper, metronome garden, pottery
      wheel, owl sentry; start as a `minigame` step kind reusing StackPlayer's
      frame/snapshot pattern, canvas playfield layer, React for chrome only).

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
- [ ] Favicon / page title / meta for the public site
- [ ] Personal homepage → ashween.com: placeholder scaffolded at
      `~/Desktop/work/ashween.com` (git-initialized, uncommitted) — create the
      GitHub repo, push, connect to Pages (no build step, output `/`), attach
      `ashween.com` + `www`
- [ ] Consider GitHub Action to auto-deploy `server/` on push once it churns
