// Lens selection and zoom helpers for phones with several rear cameras.
//
// `facingMode: environment` lets the browser pick *any* rear camera, and on
// some Android phones that is the ultra-wide (0.5x) lens, which makes the
// player tiny. Device labels are the only portable hint about which lens is
// which (they are available once camera permission has been granted), e.g.
//   Android Chrome: "camera2 0, facing back", "camera2 2, facing back"
//   iOS Safari:     "Back Camera", "Back Ultra Wide Camera", "Back Telephoto Camera"
// These helpers are pure so they can be unit-tested without a camera.

export interface CameraInfo {
  deviceId: string;
  label: string;
}

const ULTRA_WIDE = /ultra|0\.5|\buw\b|dual wide|triple/i;
const TELEPHOTO = /tele|zoom/i;
const BACK = /back|rear|environment|后置|背面/i;
const FRONT = /front|user|前置/i;

/** Higher is better for a rear "main" (1x wide) camera; null if not a rear camera. */
export function rankBackCamera(label: string): number | null {
  if (!label || FRONT.test(label) || !BACK.test(label)) return null;
  let score = 0;
  if (ULTRA_WIDE.test(label)) score -= 100;
  if (TELEPHOTO.test(label)) score -= 50;
  // Android numbers its cameras; the primary rear camera is almost always the lowest id.
  const id = /camera2?\s*(\d+)/i.exec(label);
  if (id) score -= Number(id[1]);
  return score;
}

/**
 * Picks the rear camera most likely to be the main 1x lens. Returns null when
 * labels give no usable information (then the browser's own choice is kept).
 */
export function pickMainBackCamera(devices: readonly CameraInfo[]): CameraInfo | null {
  let best: CameraInfo | null = null;
  let bestScore = -Infinity;
  for (const d of devices) {
    const score = rankBackCamera(d.label);
    if (score === null) continue;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

export interface ZoomRange {
  min: number;
  max: number;
  step: number;
}

export const ZOOM_PRESETS = [0.5, 1, 2] as const;

/** Preset zoom levels the camera can actually reach (empty when zoom is unusable). */
export function zoomPresets(range: ZoomRange | null): number[] {
  if (!range || !(range.max > range.min)) return [];
  const levels = ZOOM_PRESETS.filter((z) => z >= range.min - 1e-3 && z <= range.max + 1e-3);
  return levels.length >= 2 ? levels : [];
}

/** Clamps a zoom value into the camera's range, snapped to its step. */
export function clampZoom(value: number, range: ZoomRange): number {
  const v = Math.min(range.max, Math.max(range.min, value));
  if (!(range.step > 0)) return v;
  const snapped = range.min + Math.round((v - range.min) / range.step) * range.step;
  return Math.min(range.max, Math.max(range.min, Number(snapped.toFixed(4))));
}
