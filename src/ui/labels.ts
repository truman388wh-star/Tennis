// Display names for categories, metrics and states.

import type { CategoryId, DetectorState, MetricId } from '../types';

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  preparation: 'Preparation',
  rotation: 'Rotation',
  balance: 'Balance',
  weightTransfer: 'Weight transfer',
  contact: 'Contact point',
  timing: 'Timing',
  followThrough: 'Follow-through',
};

export const METRIC_LABELS: Partial<Record<MetricId, [string, string]>> = {
  shoulderTurnDeg: ['Shoulder turn', '°'],
  hipTurnDeg: ['Hip turn', '°'],
  separationDeg: ['Shoulder-hip separation', '°'],
  unitTurnLeadMs: ['Turn completed before swing', ' ms'],
  contactForwardRatio: ['Contact in front of hips', ' T'],
  contactHeightRatio: ['Contact height above hips', ' T'],
  elbowAngleAtContactDeg: ['Elbow angle at contact', '°'],
  weightTransferRatio: ['Hip travel forward', ' T'],
  trunkLeanDeg: ['Trunk lean (into shot)', '°'],
  headDriftRatio: ['Head movement', ' T'],
  forwardSwingMs: ['Forward swing', ' ms'],
  followThroughHeightRatio: ['Finish above shoulders', ' T'],
  peakWristSpeed: ['Peak wrist speed', ' T/s'],
};

export const STATE_LABELS: Record<DetectorState, string> = {
  idle: 'Ready',
  preparing: 'Preparing',
  swinging: 'Swing',
  followThrough: 'Follow-through',
  cooldown: 'Analyzing',
};
