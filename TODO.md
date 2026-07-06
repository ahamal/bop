# TODO

## Next up

- [ ] **Minigames** — WarioWare-style arcade (2026-07-05): `ArcadeScreen` owns
      ONE TrackingSession for the whole arcade — camera + models load on the
      index, calibrate once, stay live across game switches; the active game
      registers a `FrameSink` (FrameResult + dt) and attaches its own avatar
      (`session.detachAvatar()` added for the release). All future games use
      this same input contract.
      Lineup picked 2026-07-04 (fun-vs-effort ranking): Chomp
      (catch/eat, BUILT), "bop says" (Simon with gesture detection,
      cheapest next), Gorillas-style banana lob (turn-based = latency-proof,
      aiming = ROM holds), rhythm (highest ceiling; prototype input latency
      before committing). Cut: pottery wheel (precision on the weakest axis),
      flappy-nod (neck-hostile), paratrooper (outclassed by the lob).
      - [ ] Chomp tuning: YAW_RANGE_DEG / MOUTH_EAT / speeds / EAT_R on a real
        webcam run

## Before merging to main (merge = deploy to bop.ashween.com)

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
