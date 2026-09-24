// Ranks the technical issues present in one stroke.

import type { ScoringConfig } from '../config/config';
import type { IssueAssessment, StrokeMetrics, StrokeScore } from '../types';
import { ISSUES } from './issues';

/**
 * Returns all issues with non-zero severity, most important first.
 * Severity comes from the metric's score, but only when the value lies on the
 * issue's side of the ideal range.
 */
export function evaluateIssues(metrics: StrokeMetrics, score: StrokeScore, scoring: ScoringConfig): IssueAssessment[] {
  const out: IssueAssessment[] = [];
  for (const issue of ISSUES) {
    const value = metrics[issue.metric];
    const metricScore = score.metricScores[issue.metric];
    const range = scoring.ranges[issue.metric];
    if (value === null || metricScore === undefined || !range) continue;
    const onSide = issue.side === 'below' ? value < range.idealMin : value > range.idealMax;
    if (!onSide) continue;
    const severity = 1 - metricScore / 100;
    if (severity <= 0) continue;
    out.push({ id: issue.id, category: issue.category, severity, rank: severity * issue.importance });
  }
  return out.sort((a, b) => b.rank - a.rank);
}
