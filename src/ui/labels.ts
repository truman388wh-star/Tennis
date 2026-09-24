// Language-neutral display metadata. The visible names come from src/i18n.

import type { MetricId } from '../types';
import type { Messages } from '../i18n';

/** Metrics shown in "Stroke details", in display order, with their unit. */
export const SHOWN_METRICS: readonly [MetricId & keyof Messages['metrics'], keyof Messages['units']][] = [
  ['shoulderTurnDeg', 'deg'],
  ['hipTurnDeg', 'deg'],
  ['separationDeg', 'deg'],
  ['unitTurnLeadMs', 'ms'],
  ['contactForwardRatio', 'torso'],
  ['contactHeightRatio', 'torso'],
  ['elbowAngleAtContactDeg', 'deg'],
  ['weightTransferRatio', 'torso'],
  ['trunkLeanDeg', 'deg'],
  ['headDriftRatio', 'torso'],
  ['forwardSwingMs', 'ms'],
  ['followThroughHeightRatio', 'torso'],
  ['peakWristSpeed', 'speed'],
];
