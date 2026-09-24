// Catalog of coachable forehand issues (language-neutral).
// The wording of every message lives in src/i18n/<lang>.ts, keyed by issue id.
//
// Each issue is tied to one metric and one side of its ideal range (e.g.
// contact too far *behind* the ideal range = late contact). Severity is
// 1 - metricScore/100, so it follows the tunable ranges in the scoring config.
// `importance` ranks issues when several occur on the same stroke: fixing the
// contact point matters more than, say, a slightly short finish.

import type { CategoryId, MetricId } from '../types';

export const ISSUE_IDS = [
  'late-contact',
  'early-contact',
  'late-preparation',
  'small-shoulder-turn',
  'small-hip-turn',
  'no-weight-transfer',
  'leaning-back',
  'unstable-head',
  'narrow-stance',
  'cramped-arm',
  'arm-only-swing',
  'swing-hitch',
  'short-follow-through',
  'short-swing-path',
] as const;

export type IssueId = (typeof ISSUE_IDS)[number];

/** Message variants per issue: single occurrence, recurring, fixed. */
export type IssueVariant = 'now' | 'repeated' | 'improved';

export interface IssueDefinition {
  id: IssueId;
  category: CategoryId;
  metric: MetricId;
  /** Which side of the ideal range constitutes the issue. */
  side: 'below' | 'above';
  importance: number;
}

export const ISSUES: readonly IssueDefinition[] = [
  {
    id: 'late-contact',
    category: 'contact',
    metric: 'contactForwardRatio',
    side: 'below',
    importance: 1.0,
  },
  {
    id: 'early-contact',
    category: 'contact',
    metric: 'contactForwardRatio',
    side: 'above',
    importance: 0.8,
  },
  {
    id: 'late-preparation',
    category: 'preparation',
    metric: 'unitTurnLeadMs',
    side: 'below',
    importance: 0.9,
  },
  {
    id: 'small-shoulder-turn',
    category: 'rotation',
    metric: 'shoulderTurnDeg',
    side: 'below',
    importance: 0.85,
  },
  {
    id: 'small-hip-turn',
    category: 'rotation',
    metric: 'hipTurnDeg',
    side: 'below',
    importance: 0.6,
  },
  {
    id: 'no-weight-transfer',
    category: 'weightTransfer',
    metric: 'weightTransferRatio',
    side: 'below',
    importance: 0.8,
  },
  {
    id: 'leaning-back',
    category: 'balance',
    metric: 'trunkLeanDeg',
    side: 'below',
    importance: 0.75,
  },
  {
    id: 'unstable-head',
    category: 'balance',
    metric: 'headDriftRatio',
    side: 'above',
    importance: 0.65,
  },
  {
    id: 'narrow-stance',
    category: 'balance',
    metric: 'stanceWidthRatio',
    side: 'below',
    importance: 0.55,
  },
  {
    id: 'cramped-arm',
    category: 'contact',
    metric: 'elbowAngleAtContactDeg',
    side: 'below',
    importance: 0.6,
  },
  {
    id: 'arm-only-swing',
    category: 'timing',
    metric: 'shoulderTurnAtContactDeg',
    side: 'above',
    importance: 0.65,
  },
  {
    id: 'swing-hitch',
    category: 'timing',
    metric: 'transitionPauseMs',
    side: 'above',
    importance: 0.5,
  },
  {
    id: 'short-follow-through',
    category: 'followThrough',
    metric: 'followThroughHeightRatio',
    side: 'below',
    importance: 0.7,
  },
  {
    id: 'short-swing-path',
    category: 'followThrough',
    metric: 'followThroughTravelRatio',
    side: 'below',
    importance: 0.55,
  },
];

/** Order in which strengths are praised (most important first). */
export const PRAISE_ORDER: readonly CategoryId[] = [
  'contact',
  'rotation',
  'preparation',
  'weightTransfer',
  'followThrough',
  'balance',
  'timing',
];


export const ISSUE_BY_ID: ReadonlyMap<string, IssueDefinition> = new Map(ISSUES.map((i) => [i.id, i]));
