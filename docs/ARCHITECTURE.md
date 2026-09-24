# Architecture

This document explains how the real-time forehand coach is put together, why it is built that way, and where to plug in better models later.

## Design goals

1. **Low latency and reliability first.** Interpretable heuristics on top of a lightweight, proven pose model. No custom-trained networks in the MVP.
2. **Continuous operation.** The player never taps the phone between strokes. Speech and analysis never stall capture.
3. **Replaceable stages.** Each stage sits behind a small interface; the analysis core has no DOM dependencies and runs identically in the browser, in Node tests and in demo mode.
4. **Honest outputs.** Metrics that can't be measured are `null`, never guessed. Contact is labelled *estimated* everywhere.
5. **On-device and private.** No server; video never leaves the browser.

## Layers

```
┌───────────────────────────── Browser (app layer) ──────────────────────────────┐
│ ui/CoachView  ui/SkeletonOverlay        app/CoachApp (lifecycle + frame loop)  │
│ camera/FrameSource  camera/InferenceRateController  pose/MediaPipePoseEstimator│
│ speech/QueuedSpeechOutput + WebSpeechEngine                                    │
└──────────────────────────────────────┬─────────────────────────────────────────┘
                                       │ PoseFrame (33 landmarks, isotropic units)
┌──────────────────────── Analysis core (pure TypeScript) ───────────────────────┐
│ session/CoachSession                                                           │
│   features/FeatureExtractor ─▶ buffer/PoseBuffer ─▶ stroke/StrokeEventDetector │
│                                     │ StrokeEvent                              │
│   phases/StrokePhaseSegmenter ─▶ metrics/StrokeMetricsCalculator               │
│   ─▶ scoring/StrokeQualityScorer ─▶ coaching/CoachingEngine                    │
│        (IssueEvaluator + FeedbackController + CoachingMemory)                  │
│ config/config.ts: every threshold, range and weight                            │
└────────────────────────────────────────────────────────────────────────────────┘
```

`CoachSession.processFrame(frame)` is the only entry point. It returns the live state (for the UI) and, when a stroke has just been confirmed, a full `StrokeAnalysis`:

```ts
interface StrokeAnalysis {
  event: StrokeEvent;        // timing of the stroke
  phases: StrokePhases;      // preparation … follow-through
  metrics: StrokeMetrics;    // numbers or null
  score: StrokeScore;        // overall, categories, per-metric, confidence
  issues: IssueAssessment[]; // ranked
  feedback: CoachingFeedback;// text, kind, priority, speak?, reason
  feedbackDelayMs: number;   // estimated contact → analysis ready
}
```

## Real-time data flow and threading

- **Frame loop:** `requestVideoFrameCallback` (fallback `requestAnimationFrame`). For each new camera frame, `InferenceRateController.shouldRun()` decides whether to run pose inference. This decouples **camera fps** from **inference fps**. If average inference time goes over 80 % of the frame budget, the rate drops by 2 fps at a time (down to `pose.minFps`) and climbs back when there is headroom.
- **Pose inference** (`detectForVideo`) is synchronous, on the main thread, on GPU (WebGL) with CPU fallback. The Lite model at 256 px input keeps it to a few milliseconds on recent phones. Moving it to a Worker with OffscreenCanvas is a future optimization; the `PoseEstimator` interface already allows that.
- **Analysis** is O(1) per frame. The per-stroke analysis runs once per confirmed stroke over at most ~2 s of features (a few dozen frames), well under a millisecond.
- **Speech** calls return immediately. `speechSynthesis` plays on its own; the queue keeps at most one pending message. Capture, inference and detection keep running while it speaks.
- **UI updates:** live status is throttled to 10 Hz and only changed text is written. Stroke panels are rebuilt once per stroke. The skeleton is drawn on a canvas each inference frame.
- **Memory:** no frames are stored. The feature buffer is a fixed ring (3 s), the coaching memory holds 10 records, and the per-session stroke list is capped at 2000.

## Coordinate system and normalization

- `PoseFrame` landmarks are **isotropic image units**: `y` is the normalized row (down is positive) and `x` is the normalized column × aspect ratio. Distances and angles are therefore undistorted.
- `FeatureExtractor` expresses positions **relative to the hip center, divided by the torso length** (mid-shoulder to mid-hip, EMA-smoothed). One unit is **1 T**. All thresholds are in T or T/s, so they don't depend on camera distance or player size (checked by tests).
- **Forward** = towards the net = `forwardSign × x`. `forwardSign` comes from settings, from majority voting over detected strokes, or (for the first stroke) from the facing cue (nose ahead of the ears).
- **Rotation from foreshortening:** with the camera looking along the baseline, a shoulder line square to the net points at the camera and looks short, while one turned 90° looks full length. `turn = asin(projectedWidth / fullWidth)`. `fullWidth` is learned as the largest observed width, bounded by anatomical priors. The turn *direction* isn't observable this way, so metrics only read it in phases where it is known (loaded position, contact).

## Stroke event detection

Signal: speed of the dominant wrist relative to the hips (T/s), smoothed by the One Euro filter before differentiation.

```
idle ──speed ≥ prepSpeed──▶ preparing ──speed ≥ swingSpeed──▶ swinging
swinging ──speed < peak × 0.6──▶ followThrough
followThrough ──speed > peak──▶ swinging          (earlier peak was the backswing)
followThrough ──peak + confirmDelayMs──▶ validate ──▶ emit ──▶ cooldown ──▶ idle
```

Validation rejects a candidate when:

| Reason | Rule |
| --- | --- |
| `too-slow` | peak < `minPeakSpeed` |
| `too-short` | time above `swingSpeed` < `minSwingMs` |
| `two-handed` | off-hand wrist within 0.35 T of the dominant wrist for ≥ 70 % of fast frames |
| `wrong-direction` | swing direction contradicts the configured or learned net side |
| `backswing` | direction not yet known and the swing moves away from where the face points |
| `lost-tracking` | wrist missing > 300 ms during a candidate |

The analysis window runs from `peak − 1600 ms` to the confirmation time, clipped so it never overlaps the previous stroke (rapid feeds).

## Phase segmentation

Given the window, forward wrist position `u = wrist.x × forwardSign` and forward velocity `v`:

| Phase boundary | Rule |
| --- | --- |
| Contact | argmax of `v` within [peak − 200 ms, peak + 100 ms]; region = ±50 ms (**estimated**) |
| Backswing end | argmin of `u` before contact (rearmost wrist position) |
| Backswing start | walk back from the backswing end while `v < −0.8 T/s` |
| Preparation start | least-turned shoulders before the backswing start |
| Follow-through end | first frame after contact with wrist speed < 1.5 T/s (or window end) |

## Scoring and coaching

- Each metric is mapped to 0–100 by an ideal/hard range. Categories are weighted means; overall = 0.65 × weighted category mean + 0.35 × weakest category.
- Each **issue** in `coaching/issues.ts` is bound to one metric and one side of its ideal range (e.g. `late-contact` = `contactForwardRatio` below range). Severity = 1 − metric score / 100; rank = severity × importance.
- `FeedbackController` chooses between visibility hint, improvement, recurring issue, single issue and praise, using `CoachingMemory` (last 10 strokes) to avoid repetition. It returns `speak: false` when a message would be redundant; the UI still shows it.
- `QueuedSpeechOutput` ensures no overlap: higher priority interrupts, otherwise the newest message waits, and stale messages (> 2.5 s) are dropped.

## Testing strategy

There is no camera in CI, so the core is tested with a **synthetic kinematic player** (`synthetic/forehandGenerator.ts`). Hermite-spline keyframes drive shoulder and hip turn, the wrist path, weight shift, lean and head sway, projected to a side view. Parameters produce known flaws, and tests assert the pipeline detects the right number of strokes and names the right primary issue, under noise, dropouts, occlusion, low fps, time jitter, left-handedness, mirrored net side and small/off-center players. Browser tests run the built app in Chromium with a fake camera to check local MediaPipe loading and the absence of external requests.

## Extension points

| Stage | Interface | Default implementation |
| --- | --- | --- |
| Pose | `PoseEstimator` | `MediaPipePoseEstimator` (Lite, local assets) |
| Per-frame features | `FeatureExtractorLike` | `FeatureExtractor` |
| Stroke events | `StrokeEventDetector` | `HeuristicStrokeDetector` |
| Phases | `StrokePhaseSegmenter` | `HeuristicPhaseSegmenter` |
| Metrics | `StrokeMetricsCalculator` | `HeuristicMetricsCalculator` |
| Scoring | `StrokeQualityScorer` | `WeightedStrokeScorer` |
| Coaching policy | `CoachingDecider` | `FeedbackController` |
| Speech | `SpeechOutput` / `SpeechEngine` | `QueuedSpeechOutput` + `WebSpeechEngine` |
| Input | `FrameSource` | `CameraSource`, `VideoFileSource` |

To add **racket or ball tracking**: run the detector next to the pose estimator, add optional per-frame fields (e.g. `racketHead`, `ball`) to `PoseFrame`/`BodyFeatures`, use the ball-racket distance minimum as the true contact in the segmenter, and add racket metrics. Existing metrics and tests keep working because the new fields are optional.

To add a **learned stroke classifier**: implement `StrokeEventDetector` over the same `BodyFeatures` stream (or wrap the heuristic detector and classify each candidate window), then pass it via `createDefaultStages()` overrides.

## Key decisions

| Decision | Why |
| --- | --- |
| Web app / PWA, vanilla TypeScript + Vite, no UI framework | Runs on any phone without app-store builds; small bundle; no virtual-DOM re-render overhead during continuous processing. |
| MediaPipe Pose Landmarker **Lite**, WASM and model served locally | Fastest official BlazePose variant with 33 full-body landmarks; local assets avoid CDN dependencies (jsDelivr is blocked in the build environment) and keep the app offline-capable. |
| Body-relative units (torso lengths) | Thresholds independent of distance and player size. |
| One Euro filter | Strong smoothing at rest, little lag during fast swings. |
| Confirm the stroke 400 ms after the wrist-speed peak | Captures the follow-through and prevents double counting, at the cost of ~0.4 s latency. |
| Side-view assumption with foreshortening-based rotation | Robust with 2D landmarks; monocular depth (`z`) from MediaPipe is too noisy for rotation. |
| Weakest-area term in the overall score | A single clear flaw should visibly lower the score. |
| Facing cue for the net direction | Stops a fast backswing on the first stroke from teaching the wrong direction (found during testing). |
