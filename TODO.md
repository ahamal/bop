# TODO

## Next up

- [ ] **Home avatar personality** — the hero avatar on the home page reads
      robotic; give it some life (idle motion, blinks, small reactions —
      something with character rather than a static rig).
- [ ] **Minigames** — add head-tracked minigames on top of the routine engine
      (candidate ideas discussed: firefly keeper, metronome garden, pottery
      wheel, owl sentry; start as a `minigame` step kind reusing StackPlayer's
      frame/snapshot pattern, canvas playfield layer, React for chrome only).

- [ ] **No-camera mode (privacy)** — home screen gets two buttons: "Begin with
      camera" and "Begin without camera". Without-camera is a guided-only run:
      no tracking, steps advance on timers, the 3D avatar *demonstrates* each
      movement instead of mimicking the player, and the recenter button is
      replaced by a pause button (nothing to recenter without tracking).

- [ ] **Music & sound** — audio for the routine: ambient/backing track plus
      cues (step complete, recenter landed, routine done). Needs a sound
      direction pass first: calm-coach vs game-y.
- [x] **Scheduling** — reminder scheduler on the completion card
      (`ReminderScheduler.tsx`): "in 2 hours" default, dropdown for other hours /
      tomorrow / up to 3 days (day choices reveal a time field), dev-only
      "in 2 minutes"; plus confetti blast + completion text.

## Before merging to main (merge = deploy to bop.ashween.com)

- [x] Commit the working tree (routine fixes, arc segments, reminder plumbing, `server/`) — `ae655a2`, pushed
- [ ] **Restore the full routine** — `NECK_ROUTINE` in `src/game/routine.ts` is truncated
      to still → look left → relax → look right for testing; swap `FULL_NECK_ROUTINE`
      back in and delete the temp block
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
