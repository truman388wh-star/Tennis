// Facade over issue evaluation, feedback decisions and coaching memory.

import type { CoachingConfig, ScoringConfig } from '../config/config';
import type { CoachingFeedback, IssueAssessment, StrokeMetrics, StrokeScore } from '../types';
import { CoachingMemory } from './CoachingMemory';
import { FeedbackController, type CoachingDecider } from './FeedbackController';
import { evaluateIssues } from './IssueEvaluator';
import { messageId } from './messageKeys';

export class CoachingEngine {
  readonly memory: CoachingMemory;
  private strokeIndex = 0;

  constructor(
    private readonly coaching: CoachingConfig,
    private readonly scoring: ScoringConfig,
    private readonly decider: CoachingDecider = new FeedbackController(coaching),
  ) {
    this.memory = new CoachingMemory(coaching.memorySize);
  }

  assess(metrics: StrokeMetrics, score: StrokeScore): { issues: IssueAssessment[]; feedback: CoachingFeedback } {
    const issues = evaluateIssues(metrics, score, this.scoring);
    const feedback = this.decider.decide(score, issues, this.memory);
    const relevant = issues.filter((i) => i.severity >= this.coaching.minIssueSeverity);
    this.memory.add({
      index: ++this.strokeIndex,
      overall: score.overall,
      confidence: score.confidence,
      categories: score.categories,
      primaryIssue: score.confidence >= this.coaching.minConfidence ? (relevant[0]?.id ?? null) : null,
      severities: Object.fromEntries(issues.map((i) => [i.id, i.severity])),
      spoken: feedback.speak ? messageId(feedback.message) : null,
      spokenKind: feedback.speak ? feedback.kind : null,
      spokenIssue: feedback.speak ? feedback.issueId : null,
    });
    return { issues, feedback };
  }

  reset(): void {
    this.memory.clear();
    this.strokeIndex = 0;
  }
}
