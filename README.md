# AI Tennis Coach (MVP)

A mobile web app that watches you practice forehands, for example against a ball machine, and after each stroke **speaks one short coaching cue**:

> *"Contact point was too late."* · *"Good shoulder rotation."* · *"Move your weight forward."*

You prop your phone up beside the court, press **Start** and keep hitting. The app picks out each forehand automatically, splits it into phases, measures the technique, scores it, picks the most important point to mention and says it aloud, all while it keeps recording and analyzing the next stroke. **All processing happens on the phone.** No video is uploaded.

> **Honest scope:** This is an MVP built on body-pose heuristics. It does **not** see the ball or the racket, so it *estimates* the moment of contact. Its metrics are approximations, their quality depends on the camera angle, it handles **forehands only**, and it is **not a replacement for a tennis coach**. See [Limitations](#limitations).

---

## Contents

- [Quick start](#quick-start)
- [Using it on a phone](#using-it-on-a-phone)
- [Phone placement](#phone-placement)
- [How it works](#how-it-works)
- [Scoring](#scoring)
- [Coaching feedback](#coaching-feedback)
- [Tuning](#tuning-thresholds)
- [Testing](#testing)
- [Privacy](#privacy)
- [Limitations](#limitations)
- [Extending with ML models](#extending-with-ml-models)
- [Project structure](#project-structure)

---

## Quick start

Requirements: Node.js 20+ (22 recommended), npm.

```bash
npm install
npm run dev            # http://localhost:5173
```

`npm run dev` and `npm run build` first run `scripts/setup-assets.mjs`, which:

1. copies the MediaPipe WASM runtime from `node_modules` into `public/mediapipe/wasm/`, and
2. downloads the **Pose Landmarker Lite** model (≈5.8 MB) into `public/models/`, once.

The app serves both itself, so **no CDN is contacted at runtime**. If the model download fails (for example, no network during setup), the app falls back to Google's official model URL when it runs.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm test` | Unit and scenario tests (Vitest, no browser or camera needed) |
| `npm run test:e2e` | Browser tests in headless Chromium with a fake camera (Playwright; needs `npm run build` first) |
| `npm run check` | Typecheck, lint and unit tests |
| `npm run build` | Production build in `dist/` |
| `npm run dev:phone` | Dev server on your LAN over HTTPS (for phones) |
| `npm run preview:phone` | Serves the production build on your LAN over HTTPS |

**No camera handy?** Press **"Try demo (no camera)"**. A synthetic stick-figure player hits forehands with deliberate flaws, and the whole pipeline runs, voice included. You can also **"Analyze a video file"** to run a recording through the same pipeline.

## Using it on a phone

Browsers only allow camera access on **HTTPS** (or `localhost`). Two options:

**A. Same Wi-Fi network (quickest)**

```bash
npm run dev:phone
```

Open the `https://<your-computer-ip>:5173` address it prints on the phone. The certificate is self-signed, so accept the browser warning ("Advanced → Proceed"). Then allow camera access.

**B. Static HTTPS hosting.** `npm run build` produces a static `dist/` folder, built with relative paths, that works from any HTTPS host or sub-path. The repo includes a manual GitHub Pages workflow (`.github/workflows/deploy-pages.yml`): enable Pages with source "GitHub Actions" in the repository settings, then run the workflow.

**Permissions:** camera (required). No microphone is used. Speech works without a permission, but iOS requires a tap first, which the **Start** button provides. The app keeps the screen awake with the Wake Lock API where supported. The app can also be installed as a PWA ("Add to Home Screen") and works offline after the first load.

Tested browsers: this environment could only run headless Chromium. Target browsers are current Chrome on Android and Safari on iOS 16.4 or later. See [what to test on a real phone](#manual-testing-on-a-phone).

## Phone placement

The metrics assume a **side view**:

```
            net
  ─────────────────────────
            │
            │   ← ball machine
            │
  ─────────────────────────  baseline
        🧍 player      📱 phone (4–6 m to the side, pointing along the baseline)
```

- Put the phone **beside the player, roughly level with where you hit**, so the camera looks along the baseline. The net then appears on the left or right of the image.
- **Your whole body must be visible** (head to feet) throughout the stroke, with some margin for the follow-through.
- Hip height is ideal. A tripod or a fence clip helps.
- Portrait or landscape both work. Landscape leaves more room for the swing.
- Diagonal placement works, but rotation and contact metrics get less accurate the further the camera is from a pure side view.

**Settings:**

- **Dominant hand:** right (default) or left. The analysis tracks the dominant arm.
- **Net side:** *auto* (default) learns which side of the image the net is on from your first strokes and from which way your face points. Set *left* or *right* explicitly for maximum robustness.
- **Camera:** back (default) or front.
- **Pose analysis rate:** the inference rate target (default 30 fps). The app lowers it automatically if the phone can't keep up.

## How it works

```
Camera ─▶ Pose (MediaPipe Lite) ─▶ Features ─▶ Rolling buffer ─▶ Stroke detector
                                                                       │ stroke event
       Speech ◀─ Feedback controller ◀─ Issues ◀─ Score ◀─ Metrics ◀─ Phase segmentation
         │              ▲
         │        Coaching memory (last 10 strokes)
      (async; capture and detection never pause)
```

Each stage sits behind a small interface and can be replaced on its own. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) has the details.

1. **Capture:** `getUserMedia` (rear camera). Frames are processed as they arrive and never stored.
2. **Pose estimation:** MediaPipe Pose Landmarker **Lite** runs on the phone (WebGL/GPU, with CPU fallback). Inference runs at a configurable rate, separate from the camera frame rate, and adapts to device speed.
3. **Features:** landmarks are smoothed with One Euro filters and expressed **relative to the hips, in torso lengths (T)**, so thresholds work at any camera distance. Per frame the app computes wrist position, velocity and acceleration, elbow and shoulder angles, shoulder and hip rotation, trunk lean, stance width, head position and facing direction. Landmarks with low visibility count as *missing* and are never guessed.
4. **Rolling buffer:** a 3-second ring buffer of features, so memory stays constant however long the session runs.
5. **Stroke event detection:** a state machine driven by the dominant wrist's speed:
   `idle → preparing → swinging → follow-through → (confirm) → cooldown → idle`.
   The forward swing is the fastest wrist motion of the stroke. A stroke is **confirmed 400 ms after the speed peak**, once the follow-through has been seen, and a cooldown prevents counting it twice. If a faster swing follows an earlier peak, the earlier one was only the backswing and is replaced. A candidate is rejected if it is too slow, too short, two-handed, moving against the net direction, or, before that direction is known, moving away from where the player faces (a backswing). Settings or voting across strokes supply the net direction.
6. **Phase segmentation:** the stroke window is split into **preparation → backswing → forward swing → approximate contact region → follow-through** (details in the architecture doc). *Contact is estimated* as the frame of peak forward wrist speed, ±50 ms.
7. **Metrics:** interpretable proxies, all body-normalized. See the table below.
8. **Scoring:** transparent sub-scores and an overall score from 0 to 100.
9. **Coaching:** ranks the issues, checks the coaching memory and decides what to say, and whether to say it.
10. **Speech:** the browser's `speechSynthesis`, behind a queue that never overlaps messages, lets important messages interrupt praise and drops stale ones.

**Latency:** feedback is ready about 0.4–0.5 s after the estimated contact (the confirmation delay plus a frame or two), and speech starts right away. The **Stroke details** panel shows the delay for each stroke.

### Metrics

| Metric | Meaning (proxy) | Category |
| --- | --- | --- |
| `unitTurnLeadMs` | How long before the forward swing the shoulders reached 80 % of their turn | Preparation |
| `shoulderTurnDeg`, `hipTurnDeg` | Maximum turn during preparation and backswing, estimated from **foreshortening** of the shoulder and hip lines: `asin(width / full width)` | Rotation |
| `separationDeg` | Shoulder turn minus hip turn during the backswing ("X-factor") | Rotation |
| `shoulderUnwindDeg`, `shoulderTurnAtContactDeg` | How far the shoulders unwind by contact | Rotation / Timing |
| `contactForwardRatio` | Wrist distance in front of the hips at estimated contact (T) | Contact |
| `contactHeightRatio` | Wrist height above the hips at contact (T) | Contact |
| `elbowAngleAtContactDeg` | Arm extension at contact | Contact |
| `trunkLeanDeg`, `headDriftRatio`, `stanceWidthRatio` | Trunk lean at contact, head movement relative to the hips, base width | Balance |
| `weightTransferRatio` | Forward travel of the hips from the loaded position to the finish (T) | Weight transfer |
| `forwardSwingMs`, `transitionPauseMs` | Forward swing duration, and any hitch at the backswing-to-forward transition | Timing |
| `followThroughHeightRatio`, `followThroughTravelRatio` | Finish height relative to the shoulders, and wrist path length after contact | Follow-through |

## Scoring

- **Metric score:** 100 inside the metric's *ideal range*, falling linearly to 0 at its *hard limits*.
- **Category score** (preparation, rotation, balance, weight transfer, contact point, timing, follow-through): the weighted mean of its measured metrics.
- **Overall:** `0.65 × weighted mean of categories + 0.35 × weakest category`. The weakest-area share keeps one clear flaw from being averaged away. Weights are renormalized when a category couldn't be measured.
- **Confidence:** landmark visibility × the fraction of metrics measured. Low-confidence strokes get a visibility hint ("Make sure your whole body is in the picture.") instead of coaching.

Every range and weight is in `src/config/config.ts`.

## Coaching feedback

Every stroke is analyzed and its feedback appears on screen. The **feedback controller** decides what gets spoken:

1. **Low confidence:** a visibility hint, spoken only if it keeps happening.
2. **Improvement:** if the last issue you were told about is now fixed, you hear "Better. Your contact point is earlier now.", once.
3. **Primary issue:** the highest-ranked issue by severity × importance, spoken as a short correction. The same message isn't repeated on the next stroke unless the issue is severe.
4. **Recurring issue:** at least 3 of the last 5 strokes triggers "Your contact point has been late for several strokes.", with a cooldown.
5. **No issue:** praise that rotates through your strong areas ("Good shoulder rotation.", "Good contact point.", …), spoken at most every other stroke.

The issue catalog and all the phrases live in `src/coaching/issues.ts`.

## Tuning thresholds

Everything tunable is in **`src/config/config.ts`**, documented inline. Units: T = torso lengths, T/s for speeds.

| Setting | Default | Effect |
| --- | --- | --- |
| `detection.swingSpeed` / `minPeakSpeed` | 4 / 5.5 T/s | Lower to catch softer, slower swings. Raise if shadow swings or recoveries get detected. |
| `detection.confirmDelayMs` | 400 ms | Lower gives faster feedback but a shorter observed follow-through. |
| `detection.cooldownMs` | 450 ms | Minimum gap after a stroke. Keep it below the ball machine's feed interval minus about 1 s. |
| `detection.preContactWindowMs` | 1600 ms | How far back the preparation is searched. |
| `features.minVisibility` | 0.5 | Landmark confidence cut-off. |
| `features.smoothing*` | One Euro filter parameters | Trade jitter against lag. |
| `pose.targetFps`, `minFps` | 30, 12 | Inference rate and its adaptive lower bound. |
| `scoring.ranges.*` | per metric | Ideal and hard ranges. **These are the main calibration knobs.** |
| `scoring.categoryWeights`, `weakestAreaWeight` | see file | Composition of the overall score. |
| `coaching.*` | see file | How chatty the coach is: severities, cooldowns, praise frequency. |

**Recommended calibration workflow:** record a few sessions with the phone in the standard position, run them through **"Analyze a video file"**, open **Stroke details** to read the raw metric values for strokes a coach would call good or bad, and move the ranges to match.

## Testing

```bash
npm test          # 107 unit/scenario tests, ~2 s
npm run build && npm run test:e2e   # 3 browser tests, ~20 s
```

- **Unit tests** cover geometry, One Euro smoothing, ring buffers, feature normalization (scale and translation invariance, handedness, missing landmarks), the stroke state machine, phase segmentation, every metric, scoring, issue ranking, the coaching memory and controller (repeat, cooldown, improvement, praise rotation, visibility), the speech queue, the adaptive inference rate, the session summary and settings.
- **Scenario tests** feed **synthetic pose sequences** from `src/synthetic/forehandGenerator.ts` (a kinematic stick-figure player with adjustable technique) through the whole pipeline: no stroke, one forehand, several forehands, an incomplete stroke, noisy pose, missing landmarks and occlusion, rapid 1.5 s feeds, a left-handed player with the net on the left, a slow and irregular 15 fps phone, a small off-center player, two-handed swings, and a long session (memory stays bounded). Each synthetic flaw (late contact, small turn, no weight transfer, short finish, late preparation, leaning back, cramped arm) is identified as the primary issue.
- **Browser tests** (Playwright, headless Chromium) cover: the start screen; demo mode detecting strokes and showing feedback and a summary; and **camera mode with Chromium's fake camera**, which checks that MediaPipe WASM and the model load from the app's own files, that inference runs, and that **no request leaves localhost**.

### Manual testing on a phone

These parts can't be tested without a real device and player:

- [ ] Camera starts on iOS Safari and Android Chrome; the rear camera is chosen.
- [ ] Pose tracking quality at 4–6 m in daylight; whether the dominant wrist is lost during fast swings (motion blur).
- [ ] Detection rate: forehands detected vs. hit; false triggers (walking, picking up balls, shadow swings).
- [ ] Voice plays while you keep hitting; volume is audible outdoors; the iOS ring/silent switch (it can mute browser speech).
- [ ] Feedback latency feels acceptable.
- [ ] Inference fps on a mid-range phone (shown top left); battery drain and heat over 30 minutes.
- [ ] Screen stays on (wake lock); behavior when the app is backgrounded.
- [ ] Metric ranges match what a coach sees (see the calibration workflow).

## Privacy

- Video is processed **frame by frame in the browser** and never recorded, stored or uploaded.
- There is no backend, account or analytics. The app's only network requests are for its own files (and, only if the local model is missing, Google's model file).
- Settings are stored in `localStorage` on the device. A "video file" analysis reads the file locally.

## Limitations

- **Ball contact is estimated, not detected.** Contact is taken as the moment of peak forward wrist speed, which on a real forehand falls within a few tens of milliseconds of impact. There is no ball or racket detection.
- **No racket tracking yet.** Racket face, racket head speed and swing path aren't measured. The wrist stands in for the racket.
- **Metrics are heuristic approximations** from 2D pose. Rotation angles come from foreshortening, which can't tell some opposite rotations apart and is sensitive to the camera angle. Monocular depth isn't used.
- **The camera viewpoint matters.** The metrics assume a side view along the baseline. Diagonal views reduce accuracy, and front and back views aren't supported.
- **Forehands only.** Other swings are mostly rejected (too slow, two-handed, wrong direction), but a fast one-handed backhand or a volley could be misread as a forehand.
- **Ranges are uncalibrated.** Defaults come from coaching heuristics and synthetic data, not from a dataset of labeled strokes.
- **Pose quality limits everything:** motion blur, occlusion by the body, loose clothing and low light all degrade MediaPipe Lite. Full-body visibility is required.
- **Not a replacement for a professional tennis coach.** Treat the feedback as practice prompts, not a diagnosis.

## Extending with ML models

The pipeline is a chain of interfaces in `src/session/CoachSession.ts` (`PipelineStages`), so any stage can be swapped:

| Replace | Interface | Ideas |
| --- | --- | --- |
| Pose model | `PoseEstimator` | MediaPipe Full or Heavy, RTMPose, MoveNet, or a native bridge. Must output BlazePose-order landmarks. |
| Stroke detection | `StrokeEventDetector` | A temporal CNN or transformer on the feature buffer; stroke type classification (forehand, backhand, serve, volley). |
| Phases | `StrokePhaseSegmenter` | Learned phase boundaries; ball-contact timing from audio (the sound of impact) or from a ball tracker. |
| Metrics | `StrokeMetricsCalculator` | Add racket-aware metrics (racket angle, head speed) once a racket or ball detector feeds extra per-frame fields. |
| Scoring | `StrokeQualityScorer` | A regression model trained on coach ratings, keeping the category breakdown. |
| Coaching | `CoachingDecider` | A learned or LLM-based policy for longer between-set summaries (keep the on-court cues short). |

Suggested first step: record and label real sessions, replay them through the pipeline with "Analyze a video file", and use them as regression fixtures before changing any heuristics.

## Project structure

```
src/
  app/        CoachApp: lifecycle, frame loop, wiring (no analysis logic)
  camera/     FrameSource (camera / video file), InferenceRateController
  pose/       PoseEstimator interface, MediaPipe implementation, landmarks, demo source
  features/   FeatureExtractor: smoothing, normalization, per-frame signals
  buffer/     RingBuffer, PoseBuffer (temporal window)
  stroke/     HeuristicStrokeDetector (state machine), ForwardDirectionEstimator
  phases/     HeuristicPhaseSegmenter
  metrics/    HeuristicMetricsCalculator
  scoring/    WeightedStrokeScorer
  coaching/   issue catalog, IssueEvaluator, CoachingMemory, FeedbackController, CoachingEngine
  speech/     QueuedSpeechOutput + Web Speech engine
  session/    CoachSession (the pipeline), SessionSummary
  synthetic/  forehand generator (tests and demo)
  ui/         CoachView, SkeletonOverlay, styles
  config/     config.ts (all thresholds and weights), user settings
  types/      shared types
tests/        Vitest unit and scenario tests
e2e/          Playwright browser tests
docs/         ARCHITECTURE.md
scripts/      setup-assets (WASM and model), icon rendering
public/       manifest, service worker, icons (+ generated WASM and model)
```
