// Prepares the runtime assets the app serves itself, so that nothing is
// loaded from a third-party CDN at runtime:
//   1. copies the MediaPipe WASM runtime from node_modules into public/
//   2. downloads the Pose Landmarker Lite model into public/models/ (once)
// Safe to run repeatedly. A failed model download is a warning, not an error:
// the app then falls back to the official model URL at runtime.
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe/wasm');
const modelDst = join(root, 'public/models/pose_landmarker_lite.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

if (!existsSync(wasmSrc)) {
  console.error('[setup-assets] @mediapipe/tasks-vision is not installed. Run `npm install` first.');
  process.exit(1);
}
mkdirSync(wasmDst, { recursive: true });
cpSync(wasmSrc, wasmDst, { recursive: true });
console.log('[setup-assets] MediaPipe WASM copied to public/mediapipe/wasm');

const haveModel = existsSync(modelDst) && statSync(modelDst).size > 100_000;
if (haveModel || process.env.SKIP_MODEL_DOWNLOAD) {
  console.log('[setup-assets] Pose model present (or download skipped).');
} else {
  mkdirSync(dirname(modelDst), { recursive: true });
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(modelDst, Buffer.from(await res.arrayBuffer()));
    console.log('[setup-assets] Pose model downloaded to public/models/');
  } catch (err) {
    console.warn(`[setup-assets] WARNING: could not download pose model (${err}). ` +
      'The app will try the official URL at runtime instead.');
  }
}
