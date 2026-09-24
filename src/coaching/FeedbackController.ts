// Decides what to say after each stroke.
//
// Every stroke is analyzed and gets a displayed message, but only useful
// messages are *spoken*: the player hears at most one short sentence per
// stroke, and repetitive or low-value messages are suppressed.
//
// Decision order:
//   1. Low measurement confidence -> visibility hint (spoken only if recurring).
//   2. A recently spoken issue is now fixed -> "Better. ..." (always spoken,
//      unless a severe new issue needs attention).
//   3. Primary issue:
//        recurring (>= repeatCount in the last repeatWindow strokes) ->
//          "... for several strokes" (spoken at most every repeatCooldownStrokes)
//        otherwise -> short correction (not re-spoken if the same message
//          was spoken within sameMessageCooldownStrokes, unless severe).
//   4. No notable issue -> praise the strongest category / "Good stroke."
//      (spoken at most every praiseEveryStrokes strokes).

import type { CoachingConfig } from '../config/config';
import type { CategoryId, CoachingFeedback, IssueAssessment, StrokeScore } from '../types';
import { CATEGORY_IDS } from '../types';
import type { CoachingMemory } from './CoachingMemory';
import { GOOD_STROKE, ISSUE_BY_ID, LOW_VISIBILITY, LOW_VISIBILITY_REPEATED, PRAISE } from './issues';

export const PRIORITY = { praise: 1, issue: 2, improvement: 2, severe: 3 } as const;

export interface CoachingDecider {
  decide(score: StrokeScore, issues: IssueAssessment[], memory: CoachingMemory): CoachingFeedback;
}

export class FeedbackController implements CoachingDecider {
  constructor(private readonly cfg: CoachingConfig) {}

  decide(score: StrokeScore, issues: IssueAssessment[], memory: CoachingMemory): CoachingFeedback {
    const cfg = this.cfg;

    if (score.confidence < cfg.minConfidence) {
      const recentLow = memory.recent(2).filter((r) => r.confidence < cfg.minConfidence).length;
      const recurring = recentLow >= 1;
      const alreadySaid = memory.strokesSinceSpoken((r) => r.spokenKind === 'visibility') <= cfg.repeatCooldownStrokes;
      return {
        text: recurring ? LOW_VISIBILITY_REPEATED : LOW_VISIBILITY,
        kind: 'visibility',
        issueId: null,
        priority: PRIORITY.issue,
        speak: recurring && !alreadySaid,
        reason: `confidence ${score.confidence.toFixed(2)} below ${cfg.minConfidence}`,
      };
    }

    const relevant = issues.filter((i) => i.severity >= cfg.minIssueSeverity);
    const primary = relevant[0] ?? null;
    const severe = primary !== null && primary.severity >= cfg.highSeverity;

    // 2. Improvement on an issue we recently told the player about.
    if (!severe) {
      const improved = this.findImprovement(issues, memory);
      if (improved) {
        const def = ISSUE_BY_ID.get(improved)!;
        return {
          text: def.messages.improved,
          kind: 'improvement',
          issueId: improved,
          priority: PRIORITY.improvement,
          speak: true,
          reason: `previously spoken issue ${improved} is now below resolved severity`,
        };
      }
    }

    // 3. Primary issue.
    if (primary) {
      const def = ISSUE_BY_ID.get(primary.id)!;
      const previousCount = memory.countPrimary(primary.id, cfg.repeatWindow - 1);
      const recurring = previousCount + 1 >= cfg.repeatCount;
      if (recurring) {
        const sinceRepeat = memory.strokesSinceSpoken((r) => r.spokenKind === 'repeat' && r.spokenIssue === primary.id);
        const speak = sinceRepeat > cfg.repeatCooldownStrokes;
        return {
          text: def.messages.repeated,
          kind: 'repeat',
          issueId: primary.id,
          priority: severe ? PRIORITY.severe : PRIORITY.issue,
          speak,
          reason: `${primary.id} in ${previousCount + 1} of last ${cfg.repeatWindow} strokes` +
            (speak ? '' : ' (recently said, not repeated)'),
        };
      }
      const sinceSame = memory.strokesSinceSpoken((r) => r.spoken === def.messages.now);
      const speak = severe || sinceSame > cfg.sameMessageCooldownStrokes;
      return {
        text: def.messages.now,
        kind: 'issue',
        issueId: primary.id,
        priority: severe ? PRIORITY.severe : PRIORITY.issue,
        speak,
        reason: `primary issue ${primary.id} severity ${primary.severity.toFixed(2)}` + (speak ? '' : ' (just said)'),
      };
    }

    // 4. Praise.
    const best = bestCategory(score);
    const text =
      best && (score.categories[best] ?? 0) >= cfg.praiseCategoryMinScore && score.overall < 95
        ? PRAISE[best]
        : GOOD_STROKE;
    const praiseWorthy = score.overall >= cfg.praiseMinScore;
    const speak = praiseWorthy && memory.strokesSinceAnySpoken() >= cfg.praiseEveryStrokes;
    return {
      text: praiseWorthy ? text : modestStrokeMessage(score.overall),
      kind: 'praise',
      issueId: null,
      priority: PRIORITY.praise,
      speak,
      reason: praiseWorthy ? `no notable issue, strongest area ${best}` : 'no notable issue but score is modest',
    };
  }

  /** An issue spoken in the last few strokes that is now (nearly) absent. */
  private findImprovement(issues: IssueAssessment[], memory: CoachingMemory): string | null {
    const recent = memory.recent(this.cfg.improvementLookback);
    for (const r of recent) {
      if (!r.spokenIssue || (r.spokenKind !== 'issue' && r.spokenKind !== 'repeat')) continue;
      const now = issues.find((i) => i.id === r.spokenIssue)?.severity ?? 0;
      const before = r.severities[r.spokenIssue] ?? 0;
      if (now < this.cfg.resolvedSeverity && before >= this.cfg.minIssueSeverity) return r.spokenIssue;
      return null; // Only the most recently spoken issue is checked.
    }
    return null;
  }
}

function bestCategory(score: StrokeScore): CategoryId | null {
  let best: CategoryId | null = null;
  for (const c of CATEGORY_IDS) {
    const v = score.categories[c];
    if (v !== null && (best === null || v > (score.categories[best] ?? -1))) best = c;
  }
  return best;
}

function modestStrokeMessage(overall: number): string {
  return overall >= 60 ? GOOD_STROKE : 'Okay. Keep going.';
}
