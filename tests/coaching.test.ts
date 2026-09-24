import { describe, expect, it } from 'vitest';
import { createConfig } from '../src/config/config';
import { CoachingEngine } from '../src/coaching/CoachingEngine';
import { CoachingMemory, type StrokeRecord } from '../src/coaching/CoachingMemory';
import { FeedbackController } from '../src/coaching/FeedbackController';
import { evaluateIssues } from '../src/coaching/IssueEvaluator';
import { ISSUE_BY_ID, ISSUES, PRAISE } from '../src/coaching/issues';
import { emptyMetrics } from '../src/metrics/MetricsCalculator';
import { WeightedStrokeScorer } from '../src/scoring/StrokeScorer';
import type { StrokeMetrics } from '../src/types';
import { feat } from './helpers';

const config = createConfig();
const scorer = new WeightedStrokeScorer(config.scoring);
const frames = [feat(0), feat(33)];

/** Metrics of a clean forehand (all inside ideal ranges). */
function goodMetrics(): StrokeMetrics {
  return {
    ...emptyMetrics(),
    unitTurnLeadMs: 400,
    backswingDurationMs: 500,
    shoulderTurnDeg: 80,
    hipTurnDeg: 45,
    separationDeg: 30,
    shoulderUnwindDeg: 60,
    shoulderTurnAtContactDeg: 20,
    trunkLeanDeg: 5,
    headDriftRatio: 0.1,
    stanceWidthRatio: 1.4,
    weightTransferRatio: 0.35,
    contactForwardRatio: 0.6,
    contactHeightRatio: 0.2,
    elbowAngleAtContactDeg: 150,
    forwardSwingMs: 200,
    transitionPauseMs: 0,
    peakWristSpeed: 12,
    followThroughHeightRatio: 0.4,
    followThroughTravelRatio: 2,
  };
}

const late = (): StrokeMetrics => ({ ...goodMetrics(), contactForwardRatio: -0.05 });
const lowTurn = (): StrokeMetrics => ({ ...goodMetrics(), shoulderTurnDeg: 30 });

function engine() {
  return new CoachingEngine(config.coaching, config.scoring);
}

function feed(e: CoachingEngine, m: StrokeMetrics, fr = frames) {
  return e.assess(m, scorer.score(m, fr)).feedback;
}

describe('issue catalog', () => {
  it('has short messages and valid metrics for every issue', () => {
    for (const i of ISSUES) {
      expect(i.messages.now.split(' ').length).toBeLessThanOrEqual(7);
      expect(config.scoring.ranges[i.metric]).toBeDefined();
    }
    expect(new Set(ISSUES.map((i) => i.id)).size).toBe(ISSUES.length);
  });
});

describe('evaluateIssues', () => {
  it('finds nothing for a clean stroke', () => {
    const m = goodMetrics();
    expect(evaluateIssues(m, scorer.score(m, frames), config.scoring)).toEqual([]);
  });

  it('distinguishes late from early contact by the side of the ideal range', () => {
    const m1 = late();
    expect(evaluateIssues(m1, scorer.score(m1, frames), config.scoring)[0].id).toBe('late-contact');
    const m2 = { ...goodMetrics(), contactForwardRatio: 1.7 };
    expect(evaluateIssues(m2, scorer.score(m2, frames), config.scoring)[0].id).toBe('early-contact');
  });

  it('ranks by severity x importance', () => {
    const m = { ...goodMetrics(), contactForwardRatio: -0.05, followThroughHeightRatio: -0.9 };
    const issues = evaluateIssues(m, scorer.score(m, frames), config.scoring);
    expect(issues.map((i) => i.id)).toEqual(['late-contact', 'short-follow-through']);
    expect(issues[0].rank).toBeGreaterThanOrEqual(issues[1].rank);
  });
});

describe('FeedbackController with memory', () => {
  it('gives the short correction for a new issue', () => {
    const f = feed(engine(), late());
    expect(f).toMatchObject({ kind: 'issue', issueId: 'late-contact', text: 'Contact point was too late.', speak: true });
  });

  it('praises a clean stroke', () => {
    const f = feed(engine(), goodMetrics());
    expect(f.kind).toBe('praise');
    expect(f.speak).toBe(true);
  });

  it('names a strong area when the stroke is good but not perfect', () => {
    const f = feed(engine(), { ...goodMetrics(), forwardSwingMs: 600 }); // timing down, no issue
    expect(f.kind).toBe('praise');
    expect(f.text).toBe(PRAISE.contact);
  });

  it('varies praise over consecutive good strokes', () => {
    const e = engine();
    const texts = Array.from({ length: 4 }, () => feed(e, goodMetrics()).text);
    expect(texts[0]).toBe('Good stroke.');
    expect(new Set(texts).size).toBeGreaterThan(1);
  });

  it('does not repeat the same message on consecutive strokes (unless severe)', () => {
    const e = engine();
    const mild = (): StrokeMetrics => ({ ...goodMetrics(), shoulderTurnDeg: 40 }); // severity 0.5
    expect(feed(e, mild()).speak).toBe(true);
    expect(feed(e, mild()).speak).toBe(false);
  });

  it('switches to the "several strokes" message for a recurring issue, spoken with a cooldown', () => {
    const e = engine();
    const out = Array.from({ length: 8 }, () => feed(e, lowTurn()));
    expect(out[0].kind).toBe('issue');
    expect(out[2].kind).toBe('repeat');
    expect(out[2].text).toBe(ISSUE_BY_ID.get('small-shoulder-turn')!.messages.repeated);
    expect(out[2].speak).toBe(true);
    // Not re-spoken on every following stroke.
    expect(out.slice(3, 7).filter((f) => f.speak)).toHaveLength(0);
    expect(out[7].speak).toBe(true);
  });

  it('acknowledges an improvement exactly once', () => {
    const e = engine();
    feed(e, late());
    const better = feed(e, goodMetrics());
    expect(better).toMatchObject({ kind: 'improvement', text: 'Better. Your contact point is earlier now.', speak: true });
    expect(feed(e, goodMetrics()).kind).toBe('praise');
  });

  it('throttles spoken praise', () => {
    const e = engine();
    const spoken = Array.from({ length: 6 }, () => feed(e, goodMetrics()).speak);
    expect(spoken.filter(Boolean).length).toBeLessThanOrEqual(3);
    expect(spoken[0]).toBe(true);
  });

  it('gives a visibility hint instead of coaching when confidence is low', () => {
    const e = engine();
    const poor = [feat(0, { visibility: 0.1 })];
    const first = feed(e, late(), poor);
    expect(first.kind).toBe('visibility');
    expect(first.speak).toBe(false);
    const second = feed(e, late(), poor);
    expect(second.speak).toBe(true);
    expect(second.text).toMatch(/whole body/);
  });

  it('memory is bounded and answers recency queries', () => {
    const mem = new CoachingMemory(3);
    const rec = (i: number, spoken: string | null): StrokeRecord => ({
      index: i,
      overall: 80,
      confidence: 1,
      categories: {} as StrokeRecord['categories'],
      primaryIssue: i % 2 ? 'late-contact' : null,
      severities: {},
      spoken,
      spokenKind: spoken ? 'issue' : null,
      spokenIssue: null,
    });
    [1, 2, 3, 4, 5].forEach((i) => mem.add(rec(i, i === 4 ? 'x' : null)));
    expect(mem.count).toBe(3);
    expect(mem.recent().map((r) => r.index)).toEqual([5, 4, 3]);
    expect(mem.countPrimary('late-contact', 3)).toBe(2);
    expect(mem.strokesSinceSpoken((r) => r.spoken === 'x')).toBe(2);
    expect(mem.strokesSinceSpoken((r) => r.spoken === 'y')).toBe(Infinity);
  });

  it('can be used standalone with a custom memory', () => {
    const ctrl = new FeedbackController(config.coaching);
    const m = late();
    const s = scorer.score(m, frames);
    const f = ctrl.decide(s, evaluateIssues(m, s, config.scoring), new CoachingMemory(5));
    expect(f.issueId).toBe('late-contact');
  });
});
