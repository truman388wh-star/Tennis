// End-of-session summary statistics.

import type { CategoryId, StrokeAnalysis } from '../types';
import { CATEGORY_IDS } from '../types';
import type { IssueId } from '../coaching/issues';
import { mean, slope } from '../utils/stats';

export interface SessionSummary {
  totalStrokes: number;
  averageScore: number | null;
  bestScore: number | null;
  /** Score change per stroke over the last (up to) 10 strokes. */
  recentTrend: number | null;
  trendLabel: 'improving' | 'steady' | 'declining' | 'not enough strokes';
  /** Issue id; the UI renders its localized name. */
  mostFrequentIssue: { id: IssueId; count: number } | null;
  strongestArea: { category: CategoryId; average: number } | null;
  weakestArea: { category: CategoryId; average: number } | null;
  scores: number[];
  durationMs: number | null;
}

export function summarizeSession(analyses: readonly StrokeAnalysis[], durationMs: number | null = null): SessionSummary {
  const scores = analyses.map((a) => a.score.overall);
  const recent = scores.slice(-10);
  const trend = recent.length >= 4 ? slope(recent) : null;
  const trendLabel =
    trend === null ? 'not enough strokes' : trend > 1 ? 'improving' : trend < -1 ? 'declining' : 'steady';

  const issueCounts = new Map<IssueId, number>();
  for (const a of analyses) {
    if (a.feedback.issueId && (a.feedback.kind === 'issue' || a.feedback.kind === 'repeat')) {
      issueCounts.set(a.feedback.issueId, (issueCounts.get(a.feedback.issueId) ?? 0) + 1);
    }
  }
  let mostFrequentIssue: SessionSummary['mostFrequentIssue'] = null;
  for (const [id, count] of issueCounts) {
    if (!mostFrequentIssue || count > mostFrequentIssue.count) {
      mostFrequentIssue = { id, count };
    }
  }

  const catAverages: { category: CategoryId; average: number }[] = [];
  for (const c of CATEGORY_IDS) {
    const vals = analyses.map((a) => a.score.categories[c]).filter((v): v is number => v !== null);
    const avg = mean(vals);
    if (avg !== null) catAverages.push({ category: c, average: avg });
  }
  catAverages.sort((a, b) => b.average - a.average);

  return {
    totalStrokes: analyses.length,
    averageScore: scores.length ? Math.round(mean(scores) as number) : null,
    bestScore: scores.length ? Math.max(...scores) : null,
    recentTrend: trend,
    trendLabel,
    mostFrequentIssue,
    strongestArea: catAverages[0] ?? null,
    weakestArea: catAverages.length > 1 ? catAverages[catAverages.length - 1] : null,
    scores,
    durationMs,
  };
}
