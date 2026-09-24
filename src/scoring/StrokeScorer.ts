// Converts metrics into transparent 0-100 scores.
//
// metric score:   100 inside the ideal range, linear fall-off to 0 at the
//                 hard limits (config.scoring.ranges).
// category score: weighted mean of its available metric scores.
// overall:        (1 - w) * weighted mean of available category scores
//                 (weights renormalized over measured categories)
//                 + w * weakest category score, w = weakestAreaWeight.
// confidence:     landmark visibility x fraction of metrics measured.

import type { MetricRange, ScoringConfig } from '../config/config';
import type { BodyFeatures, CategoryId, MetricId, StrokeMetrics, StrokeScore } from '../types';
import { CATEGORY_IDS } from '../types';
import { clamp } from '../utils/geometry';
import { mean } from '../utils/stats';

export interface StrokeQualityScorer {
  score(metrics: StrokeMetrics, frames: readonly BodyFeatures[]): StrokeScore;
}

/** Scores a single value against a range. Exported for tests and coaching. */
export function scoreMetric(value: number, r: MetricRange): number {
  if (value >= r.idealMin && value <= r.idealMax) return 100;
  if (value < r.idealMin) {
    if (!Number.isFinite(r.hardMin) || value <= r.hardMin) return value <= r.hardMin ? 0 : 100;
    return (100 * (value - r.hardMin)) / (r.idealMin - r.hardMin);
  }
  if (!Number.isFinite(r.hardMax) || value >= r.hardMax) return value >= r.hardMax ? 0 : 100;
  return (100 * (r.hardMax - value)) / (r.hardMax - r.idealMax);
}

export class WeightedStrokeScorer implements StrokeQualityScorer {
  constructor(private readonly cfg: ScoringConfig) {}

  score(metrics: StrokeMetrics, frames: readonly BodyFeatures[]): StrokeScore {
    const metricScores: Partial<Record<MetricId, number>> = {};
    for (const [id, range] of Object.entries(this.cfg.ranges) as [MetricId, MetricRange][]) {
      const v = metrics[id];
      if (v !== null && Number.isFinite(v)) metricScores[id] = scoreMetric(v, range);
    }

    const categories = {} as Record<CategoryId, number | null>;
    let weighted = 0;
    let weightSum = 0;
    let weakest = Number.POSITIVE_INFINITY;
    for (const cat of CATEGORY_IDS) {
      let sum = 0;
      let wsum = 0;
      for (const [id, w] of Object.entries(this.cfg.categoryMetrics[cat]) as [MetricId, number][]) {
        const s = metricScores[id];
        if (s !== undefined) {
          sum += s * w;
          wsum += w;
        }
      }
      categories[cat] = wsum > 0 ? sum / wsum : null;
      const cw = this.cfg.categoryWeights[cat];
      if (categories[cat] !== null) {
        weighted += (categories[cat] as number) * cw;
        weightSum += cw;
        weakest = Math.min(weakest, categories[cat] as number);
      }
    }

    const scoredIds = Object.keys(this.cfg.ranges);
    const coverage = scoredIds.length ? Object.keys(metricScores).length / scoredIds.length : 0;
    const vis = mean(frames.map((f) => f.visibility)) ?? 0;
    const confidence = clamp(Math.min(1, vis / this.cfg.goodVisibility) * coverage, 0, 1);

    const w = this.cfg.weakestAreaWeight;
    const overall = weightSum > 0 ? (1 - w) * (weighted / weightSum) + w * weakest : 0;
    return {
      overall: Math.round(overall),
      categories,
      metricScores,
      confidence,
    };
  }
}
