import { describe, expect, it } from 'vitest';
import { InferenceRateController } from '../src/camera/InferenceRateController';
import { createConfig, DEFAULT_CONFIG, DEFAULT_SETTINGS } from '../src/config/config';
import { loadSettings, saveSettings } from '../src/config/settings';
import { summarizeSession } from '../src/session/SessionSummary';
import { generateSession } from '../src/synthetic/forehandGenerator';
import { SyntheticPoseSource } from '../src/pose/SyntheticPoseSource';
import { runFrames } from './helpers';

describe('InferenceRateController', () => {
  it('throttles inference to the target rate independent of camera rate', () => {
    const rc = new InferenceRateController(15, 10, 60, 0.8);
    let runs = 0;
    for (let t = 0; t < 1000; t += 1000 / 60) {
      if (rc.shouldRun(t)) {
        rc.record(t, 5);
        runs++;
      }
    }
    expect(runs).toBeGreaterThanOrEqual(14);
    expect(runs).toBeLessThanOrEqual(16);
  });

  it('lowers the rate on slow devices and recovers when fast again', () => {
    const rc = new InferenceRateController(30, 12, 60, 0.8);
    for (let i = 0; i < 40; i++) rc.record(i * 40, 60); // 60 ms per inference: too slow for 30 fps
    expect(rc.currentFps).toBeLessThan(20);
    expect(rc.currentFps).toBeGreaterThanOrEqual(12);
    for (let i = 40; i < 200; i++) rc.record(i * 40, 5);
    expect(rc.currentFps).toBe(30);
  });
});

describe('session summary', () => {
  it('summarizes strokes, trend, frequent issue and strongest area', () => {
    const strokes = [
      { startMs: 500, params: { contactForward: -0.3 } },
      { startMs: 3500, params: { contactForward: -0.3 } },
      { startMs: 6500, params: { contactForward: -0.25 } },
      { startMs: 9500 },
      { startMs: 12500 },
    ];
    const { analyses } = runFrames(generateSession({ durationMs: 15_000, fps: 30, strokes }));
    const s = summarizeSession(analyses, 15_000);
    expect(s.totalStrokes).toBe(5);
    expect(s.bestScore).toBe(Math.max(...s.scores));
    expect(s.averageScore).toBeGreaterThan(0);
    expect(s.mostFrequentIssue?.id).toBe('late-contact');
    expect(s.trendLabel).toBe('improving');
    expect(s.strongestArea).not.toBeNull();
    expect(s.weakestArea?.category).toBe('contact');
  });

  it('handles an empty session', () => {
    const s = summarizeSession([]);
    expect(s).toMatchObject({ totalStrokes: 0, averageScore: null, bestScore: null, mostFrequentIssue: null });
  });
});

describe('configuration and settings', () => {
  it('createConfig deep-merges overrides without mutating defaults', () => {
    const c = createConfig({ detection: { swingSpeed: 9 } });
    expect(c.detection.swingSpeed).toBe(9);
    expect(c.detection.minPeakSpeed).toBe(DEFAULT_CONFIG.detection.minPeakSpeed);
    expect(DEFAULT_CONFIG.detection.swingSpeed).not.toBe(9);
  });

  it('keeps detection timing consistent', () => {
    const d = DEFAULT_CONFIG.detection;
    expect(d.bufferWindowMs).toBeGreaterThan(d.preContactWindowMs + d.confirmDelayMs);
    expect(d.minPeakSpeed).toBeGreaterThan(d.swingSpeed);
    expect(d.swingSpeed).toBeGreaterThan(d.prepSpeed);
  });

  it('round-trips settings and sanitizes bad values', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveSettings({ ...DEFAULT_SETTINGS, handedness: 'left', targetPoseFps: 20 }, storage);
    expect(loadSettings(storage)).toMatchObject({ handedness: 'left', targetPoseFps: 20 });
    store.set('tennis-coach.settings.v1', JSON.stringify({ handedness: 'both', targetPoseFps: 999, netDirection: 'up' }));
    expect(loadSettings(storage)).toMatchObject({ handedness: 'right', targetPoseFps: 60, netDirection: 'auto' });
    store.set('tennis-coach.settings.v1', '{not json');
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('works when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, broken)).not.toThrow();
  });
});

describe('demo pose source', () => {
  it('loops forever with increasing timestamps', () => {
    const demo = new SyntheticPoseSource('right');
    const a = demo.frameAt(100);
    const b = demo.frameAt(100_000);
    expect(b.timestampMs).toBeGreaterThan(a.timestampMs);
    expect(b.landmarks).toHaveLength(33);
  });
});
