import { describe, expect, it } from 'vitest';
import { clampZoom, pickMainBackCamera, rankBackCamera, zoomPresets } from '../src/camera/lens';

describe('rear lens selection', () => {
  it('prefers the main Android rear camera over the ultra-wide', () => {
    const main = pickMainBackCamera([
      { deviceId: 'f', label: 'camera2 1, facing front' },
      { deviceId: 'uw', label: 'camera2 2, facing back' },
      { deviceId: 'm', label: 'camera2 0, facing back' },
    ]);
    expect(main?.deviceId).toBe('m');
  });

  it('avoids ultra-wide and telephoto lenses by label', () => {
    const main = pickMainBackCamera([
      { deviceId: 'uw', label: 'Back Ultra Wide Camera' },
      { deviceId: 't', label: 'Back Telephoto Camera' },
      { deviceId: 'w', label: 'Back Camera' },
    ]);
    expect(main?.deviceId).toBe('w');
  });

  it('keeps the browser choice when labels are missing or front-only', () => {
    expect(pickMainBackCamera([{ deviceId: 'a', label: '' }])).toBeNull();
    expect(pickMainBackCamera([{ deviceId: 'a', label: 'Front Camera' }])).toBeNull();
    expect(rankBackCamera('Integrated Webcam')).toBeNull();
  });
});

describe('zoom presets', () => {
  it('offers only presets inside the camera range', () => {
    expect(zoomPresets({ min: 0.5, max: 10, step: 0.1 })).toEqual([0.5, 1, 2]);
    expect(zoomPresets({ min: 1, max: 8, step: 0.1 })).toEqual([1, 2]);
    expect(zoomPresets({ min: 1, max: 1.5, step: 0.1 })).toEqual([]);
    expect(zoomPresets(null)).toEqual([]);
  });

  it('clamps and snaps to the camera step', () => {
    const range = { min: 1, max: 4, step: 0.5 };
    expect(clampZoom(0.5, range)).toBe(1);
    expect(clampZoom(2.2, range)).toBe(2);
    expect(clampZoom(9, range)).toBe(4);
    expect(clampZoom(1.3, { min: 1, max: 4, step: 0 })).toBe(1.3);
  });
});
