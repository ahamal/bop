# bop

Browser, webcam-based head-tracking — the foundation for a daily 5–10 min
head-movement rhythm game (chin tucks, look left/right).

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173, click **Start camera**, allow webcam access. Hold
still for ~1.5s while it calibrates your neutral pose, then move your head.

## What's here

- `src/tracker.ts` — wraps MediaPipe FaceLandmarker, yields head pose per frame.
- `src/pose.ts` — extracts yaw/pitch/roll + depth from the facial transform
  matrix (depth is the Z translation alone, so sideways motion isn't read as a
  lean).
- `src/bodyTracker.ts` — MediaPipe PoseLandmarker (lite) for shoulders (tilt,
  sway, width). The torso is the reference that distinguishes a chin tuck (head
  retracts relative to a still torso) from a whole-body lean.
- `src/metrics.ts` — raw scored signals (head/torso angles, head-vs-torso depth)
  relative to neutral, mirror-corrected so everything shares one handedness.
- `src/gestures.ts` — turns the metric stream into **states** across four axes:
  yaw (`lookLeft`/`lookRight`), pitch (`lookUp`/`lookDown`), roll/lateral flexion
  (`tiltLeft`/`tiltRight`), and depth (`tuck`). Each engages with enter/exit
  hysteresis, tracks how long it's held, and emits a one-shot event on engage.
  Tuck additionally filters its signal and waits out a short dwell.
- `src/filter.ts` — One-Euro filter (low-latency adaptive smoothing) for the
  jittery depth signal.
- `src/calibration.ts` — averages the resting pose over the hold-still window so
  neutral isn't a single noisy frame (critical for the tight tuck threshold).
- `src/panel.ts` — the live indicator panel: center-origin **Metrics** meters +
  **States** cards (lit dot + hold timer), built data-driven so rows stay uniform.
- `src/main.ts` — webcam + render loop + calibration + onset (chip) log.

## Tuning

- All gesture thresholds live in `CONFIGS` in `src/gestures.ts` — `enter`/`exit`
  per direction (degrees for angles; depth ratio for tuck), plus tuck's
  `requiresBody` / `dwellMs` / `filtered` / cross-axis `guards`. Each config's
  `signal` returns "positive = engaged"; flip its sign if an axis reads reversed.
  Tuck-filter responsiveness is the `OneEuroFilter(...)` args. The `Tuck depth`
  meter shows the filtered value the threshold compares against.
- Calibration window + sample floor: `CALIB_MS` / `RECENTER_MS` /
  `CALIB_MIN_SAMPLES` in `src/main.ts`. Click **Recenter** to re-average neutral.
- Handedness lives in one place: flip `MIRROR` in `src/mirror.ts` for the whole
  app, or a single `signal` sign in `CONFIGS` for one axis. Body tracking is
  always on (tuck needs the torso reference).

The MediaPipe wasm + model load from CDN for now; vendor into `/public` later
for offline use.

## License

The source code is [MIT licensed](LICENSE).

Bundled media are **not** covered by that license and remain under their own
terms: the music in `public/music` is from [Pixabay](https://pixabay.com/music/)
(Pixabay Content License) and the success sound in `public/sfx` is from
freesound.org. See the in-app Credits page for details.
