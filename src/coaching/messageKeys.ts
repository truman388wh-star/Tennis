// Language-neutral identifiers for every coaching message. The coaching
// engine only produces these keys; src/i18n turns them into Chinese or
// English text when the feedback is shown or spoken. Keeping decisions and
// memory in keys means switching language never changes coaching behavior.

import type { CategoryId } from '../types';
import type { IssueId, IssueVariant } from './issues';

export type CoachingMessageKey =
  | { type: 'issue'; issue: IssueId; variant: IssueVariant }
  | { type: 'praise'; category: CategoryId }
  | { type: 'goodStroke' }
  | { type: 'okStroke' }
  | { type: 'visibility'; repeated: boolean };

/** Stable string form, used by the coaching memory to compare messages. */
export function messageId(key: CoachingMessageKey): string {
  switch (key.type) {
    case 'issue':
      return `issue.${key.issue}.${key.variant}`;
    case 'praise':
      return `praise.${key.category}`;
    case 'visibility':
      return key.repeated ? 'visibility.repeated' : 'visibility';
    default:
      return key.type;
  }
}
