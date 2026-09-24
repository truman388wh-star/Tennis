// Catalog of coachable forehand issues and praise phrases.
//
// Each issue is tied to one metric and one side of its ideal range (e.g.
// contact too far *behind* the ideal range = late contact). Severity is
// 1 - metricScore/100, so it follows the tunable ranges in the scoring config.
// `importance` ranks issues when several occur on the same stroke: fixing the
// contact point matters more than, say, a slightly short finish.

import type { CategoryId, MetricId } from '../types';

export interface IssueDefinition {
  id: string;
  category: CategoryId;
  metric: MetricId;
  /** Which side of the ideal range constitutes the issue. */
  side: 'below' | 'above';
  importance: number;
  messages: {
    /** Said for a single occurrence. Must be very short. */
    now: string;
    /** Said when the issue keeps recurring. */
    repeated: string;
    /** Said when a recently mentioned issue has been fixed. */
    improved: string;
  };
}

export const ISSUES: readonly IssueDefinition[] = [
  {
    id: 'late-contact',
    category: 'contact',
    metric: 'contactForwardRatio',
    side: 'below',
    importance: 1.0,
    messages: {
      now: 'Contact point was too late.',
      repeated: 'Your contact point has been late for several strokes.',
      improved: 'Better. Your contact point is earlier now.',
    },
  },
  {
    id: 'early-contact',
    category: 'contact',
    metric: 'contactForwardRatio',
    side: 'above',
    importance: 0.8,
    messages: {
      now: 'You reached too far in front.',
      repeated: 'You keep reaching too far forward. Let the ball come in.',
      improved: 'Better contact distance.',
    },
  },
  {
    id: 'late-preparation',
    category: 'preparation',
    metric: 'unitTurnLeadMs',
    side: 'below',
    importance: 0.9,
    messages: {
      now: 'Turn your shoulders earlier.',
      repeated: 'Preparation has been late. Turn as soon as the ball leaves the machine.',
      improved: 'Better. Earlier preparation.',
    },
  },
  {
    id: 'small-shoulder-turn',
    category: 'rotation',
    metric: 'shoulderTurnDeg',
    side: 'below',
    importance: 0.85,
    messages: {
      now: 'Rotate your shoulders more.',
      repeated: 'Keep working on a bigger shoulder turn.',
      improved: 'Better shoulder turn.',
    },
  },
  {
    id: 'small-hip-turn',
    category: 'rotation',
    metric: 'hipTurnDeg',
    side: 'below',
    importance: 0.6,
    messages: {
      now: 'Turn your hips more.',
      repeated: 'Use your hips. Load them on the backswing.',
      improved: 'Better hip turn.',
    },
  },
  {
    id: 'no-weight-transfer',
    category: 'weightTransfer',
    metric: 'weightTransferRatio',
    side: 'below',
    importance: 0.8,
    messages: {
      now: 'Move your weight forward.',
      repeated: 'Keep stepping into the ball.',
      improved: 'Better weight transfer.',
    },
  },
  {
    id: 'leaning-back',
    category: 'balance',
    metric: 'trunkLeanDeg',
    side: 'below',
    importance: 0.75,
    messages: {
      now: 'Stay more balanced.',
      repeated: 'You keep leaning back. Stay over your feet.',
      improved: 'Better balance.',
    },
  },
  {
    id: 'unstable-head',
    category: 'balance',
    metric: 'headDriftRatio',
    side: 'above',
    importance: 0.65,
    messages: {
      now: 'Keep your head still.',
      repeated: 'Your head keeps moving. Stay steady through contact.',
      improved: 'Steadier head. Good.',
    },
  },
  {
    id: 'narrow-stance',
    category: 'balance',
    metric: 'stanceWidthRatio',
    side: 'below',
    importance: 0.55,
    messages: {
      now: 'Widen your stance.',
      repeated: 'Your stance keeps being narrow. Get a wider base.',
      improved: 'Better base.',
    },
  },
  {
    id: 'cramped-arm',
    category: 'contact',
    metric: 'elbowAngleAtContactDeg',
    side: 'below',
    importance: 0.6,
    messages: {
      now: 'Give yourself more space.',
      repeated: 'You keep getting cramped. Move away from the ball.',
      improved: 'Better spacing.',
    },
  },
  {
    id: 'arm-only-swing',
    category: 'timing',
    metric: 'shoulderTurnAtContactDeg',
    side: 'above',
    importance: 0.65,
    messages: {
      now: 'Rotate through the ball.',
      repeated: 'Your arm is swinging alone. Let the body rotate.',
      improved: 'Better rotation through contact.',
    },
  },
  {
    id: 'swing-hitch',
    category: 'timing',
    metric: 'transitionPauseMs',
    side: 'above',
    importance: 0.5,
    messages: {
      now: 'Keep the swing smooth.',
      repeated: 'There is a pause in your swing. Keep it flowing.',
      improved: 'Smoother swing.',
    },
  },
  {
    id: 'short-follow-through',
    category: 'followThrough',
    metric: 'followThroughHeightRatio',
    side: 'below',
    importance: 0.7,
    messages: {
      now: 'Finish the follow-through.',
      repeated: 'Keep finishing over your shoulder.',
      improved: 'Better follow-through.',
    },
  },
  {
    id: 'short-swing-path',
    category: 'followThrough',
    metric: 'followThroughTravelRatio',
    side: 'below',
    importance: 0.55,
    messages: {
      now: 'Swing through the ball.',
      repeated: 'Your swing keeps stopping early. Swing through.',
      improved: 'Better extension through the ball.',
    },
  },
];

export const PRAISE: Record<CategoryId, string> = {
  preparation: 'Good early preparation.',
  rotation: 'Good shoulder rotation.',
  balance: 'Nice balance.',
  weightTransfer: 'Good weight transfer.',
  contact: 'Good contact point.',
  timing: 'Nice smooth swing.',
  followThrough: 'Good follow-through.',
};

export const GOOD_STROKE = 'Good stroke.';
export const LOW_VISIBILITY = "Couldn't see that one clearly.";
export const LOW_VISIBILITY_REPEATED = 'Make sure your whole body is in the picture.';

export const ISSUE_BY_ID: ReadonlyMap<string, IssueDefinition> = new Map(ISSUES.map((i) => [i.id, i]));
