# TODO

## Before merging to main (merge = deploy to bop.ashween.com)

- [ ] Commit the working tree (routine fixes, arc segments, reminder plumbing, `server/`)
- [ ] **Restore the full routine** — `NECK_ROUTINE` in `src/game/routine.ts` is truncated
      to still → roll → roll for testing; swap `FULL_NECK_ROUTINE` back in and delete
      the temp block
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

- [ ] Local end-to-end test per `server/README.md` (schedule 5s reminder →
      `npm run trigger` in server/ → notification with tab closed)
- [ ] Wire the UI: "Remind me in 2 hours" / "Tomorrow at hh:mm" buttons —
      natural home is the completion card; call `scheduleReminder()` in the click
      handler, hide behind `remindersSupported()`
- [ ] Production smoke test after the site deploys (schedule from
      bop.ashween.com, wait out one 5-min sweep)

## Later / nice-to-have

- [ ] PWA manifest + icons → installable, and required for iOS push at all
- [ ] Notification icon: add an `icon` to `showNotification` in `public/sw.js`
      (currently shows the browser default)
- [ ] Favicon / page title / meta for the public site
- [ ] Personal homepage repo → ashween.com (root domain currently unused)
- [ ] Consider GitHub Action to auto-deploy `server/` on push once it churns
