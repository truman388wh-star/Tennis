# Privacy

**Camera video stays on your device.** The app is a set of static files served by GitHub Pages. It has no backend, no accounts, no analytics and no tracking. Pose analysis runs entirely in your browser.

## What happens to the camera image

1. The browser's camera stream (`getUserMedia`) is attached to a `<video>` element on the page.
2. For each analyzed frame, MediaPipe Pose Landmarker (WebAssembly, running in the page) reads the pixels **in memory** and returns 33 body landmark coordinates.
3. The landmarks are smoothed and turned into per-stroke metrics, scores and a short coaching sentence, all in page memory. The last ~3 seconds of landmarks are kept in a ring buffer, and results for the current session are kept in memory until the page is closed.

The app never records, saves or exports pixels: no `MediaRecorder`, no canvas-to-image export, no photos. The skeleton overlay is drawn on a canvas and never read back. A video you pick with "Analyze a video file" is played from a local `blob:` URL, which is released when you press Stop.

## What is stored on the device

| Storage | Contents |
| --- | --- |
| `localStorage` (`tennis-coach.settings.v1`) | Your settings only: dominant hand, net side, voice on/off, analysis rate, front/back camera |
| Service worker cache | Copies of the app's static files (HTML, JS, CSS, MediaPipe WASM, pose model, icons) for offline use |
| Memory (lost when the tab closes) | Landmarks of the last ~3 s, stroke results and the session summary |

Nothing is written to IndexedDB, sessionStorage or cookies. There is no training history across sessions.

## What is sent over the network

Only `GET` requests for the app's own static files from the site's origin (`https://truman388wh-star.github.io/Tennis/…`). Like any website, GitHub, as the host, receives standard request information when those files are downloaded (IP address, browser user agent). No camera data, pose data, metrics, scores or coaching text is ever sent.

This is enforced in two independent layers:

1. **Network guard** (`src/privacy/networkGuard.ts`): installed before the pose model loads. It rejects `fetch`, `XMLHttpRequest`, `navigator.sendBeacon` and `WebSocket` calls to any other origin.
2. **Content-Security-Policy** (production build, `vite.config.ts`): `connect-src 'self'` and `default-src 'self'`, so the browser itself refuses connections to other hosts, for all code on the page including libraries.

### Third-party telemetry: MediaPipe

`@mediapipe/tasks-vision` (v1.0.1) contains a usage logger that, by default, POSTs statistics to `https://odml.pa.googleapis.com/v1/log` every 60 seconds and when the task closes. These are the task type, running mode, OS family, SDK version, and model-load and inference-latency figures. It does not include images or landmarks. **This app blocks that request** with both layers above, and MediaPipe then disables its logger. A browser test (`e2e/privacy.spec.ts`) runs the camera past the 60-second interval and fails if any request leaves the origin. With the protections removed, it catches the MediaPipe request.

### Voice feedback

Speech uses the browser's speech synthesis with **on-device voices only** (`localService === true`). Some browsers, notably desktop Chrome's "Google …" voices, synthesize speech on a server, which would send the coaching text off the device. The app never selects those voices. If only such voices are available, feedback is shown on screen and not spoken.

## What is in the repository and CI

- The repository contains source code, tests, docs and two app icons. It contains no user images, videos or training data.
- The GitHub Actions deployment uploads only the built static site (`dist/`). The browser tests in CI use Chromium's built-in fake camera (a synthetic test pattern). Screenshots, videos and traces are turned off, and no test output is uploaded.

## Verifying

- `npm test` includes the URL policy, speech voice selection, and a check that the config contains no remote URLs.
- `npm run build && npm run test:e2e` runs `e2e/privacy.spec.ts`: no cross-origin, non-GET or body-carrying requests during a camera session (including past MediaPipe's telemetry interval), only static files requested, no training data in browser storage, and the guard blocks fetch, XHR, beacon and WebSocket calls.
- The Pages deployment workflow runs the same browser tests against the live site after every deploy.
