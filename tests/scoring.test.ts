import { describe, expect, it } from 'vitest';
import { createConfig, DEFAULT_CONFIG } from '../src/config/config';
import { emptyMetrics } from '../src/metrics/MetricsCalculator';
import { scoreMetric, WeightedStrokeScorer } from '../src/scoring/StrokeScorer';
import { feat } from './helpers';

const range = { hardMin: 0, idealMin: 10, idealMax: 20, hardMax: 40 };

describe('scoreMetric', () => {
  it('is 100 inside the ideal range and falls linearly to 0 at the hard limits', () => {
    expect(scoreMetric(15, range)).toBe(100);
    expect(scoreMetric(10, range)).toBe(100);
    expect(scoreMetric(5, range)).toBe(50);
    expect(scoreMetric(0, range)).toBe(0);
    expect(scoreMetric(-5, range)).toBe(0);
    expect(scoreMetric(30, range)).toBe(50);
    expect(scoreMetric(50, range)).toBe(0);
  });

  it('supports one-sided ranges', () => {
    const r = { hardMin: 0, idealMin: 10, idealMax: Infinity, hardMax: Infinity };
    expect(scoreMetric(1e6, r)).toBe(100);
    expect(scoreMetric(5, r)).toBe(50);
  });
});

describe('WeightedStrokeScorer', () => {
  const frames = [feat(0), feat(33)];

  it('scores a perfect stroke 100', () => {
    const cfg = DEFAULT_CONFIG.scoring;
    const m = emptyMetrics();
    for (const [id, r] of Object.entries(cfg.ranges)) {
      const lo = Number.isFinite(r!.idealMin) ? r!.idealMin : r!.idealMax;
      (m as Record<string, number | null>)[id] = lo;
    }
    const s = new WeightedStrokeScorer(cfg).score(m, frames);
    expect(s.overall).toBe(100);
    expect(s.confidence).toBeCloseTo(1);
  });

  it('skips unmeasured metrics and categories and lowers confidence', () => {
    const m = emptyMetrics();
    m.contactForwardRatio = 0.5; // ideal
    const s = new WeightedStrokeScorer(DEFAULT_CONFIG.scoring).score(m, frames);
    expect(s.categories.contact).toBe(100);
    expect(s.categories.rotation).toBeNull();
    expect(s.overall).toBe(100);
    expect(s.confidence).toBeLessThan(0.2);
  });

  it('weights the weakest category in the overall score', () => {
    const m = emptyMetrics();
    m.contactForwardRatio = 0.5; // contact 100
    m.weightTransferRatio = -0.25; // weight transfer 0
    const cfg = createConfig({ scoring: { weakestAreaWeight: 0.35 } }).scoring;
    const s = new WeightedStrokeScorer(cfg).score(m, frames);
    const mean = (100 * cfg.categoryWeights.contact) / (cfg.categoryWeights.contact + cfg.categoryWeights.weightTransfer);
    expect(s.overall).toBe(Math.round(0.65 * mean + 0.35 * 0));
  });

  it('uses weights and ranges from the configuration', () => {
    const m = emptyMetrics();
    m.contactForwardRatio = 0.1;
    const strict = createConfig({ scoring: { ranges: { contactForwardRatio: { hardMin: 0, idealMin: 0.5, idealMax: 1, hardMax: 2 } } } });
    const lenient = createConfig({ scoring: { ranges: { contactForwardRatio: { hardMin: -1, idealMin: 0, idealMax: 1, hardMax: 2 } } } });
    expect(new WeightedStrokeScorer(strict.scoring).score(m, frames).overall).toBe(20);
    expect(new WeightedStrokeScorer(lenient.scoring).score(m, frames).overall).toBe(100);
  });

  it('lowers confidence when landmarks are poorly visible', () => {
    const m = emptyMetrics();
    m.contactForwardRatio = 0.5;
    const hi = new WeightedStrokeScorer(DEFAULT_CONFIG.scoring).score(m, [feat(0, { visibility: 0.95 })]);
    const lo = new WeightedStrokeScorer(DEFAULT_CONFIG.scoring).score(m, [feat(0, { visibility: 0.3 })]);
    expect(lo.confidence).toBeLessThan(hi.confidence);
  });
});
