// Pose estimation interface. Implementations can be swapped (MediaPipe
// Lite/Full/Heavy, MoveNet, a native bridge, a synthetic source for demos)
// without touching the analysis pipeline.

import type { PoseFrame } from '../types';

export interface PoseEstimator {
  readonly name: string;
  init(): Promise<void>;
  /** Returns the pose in the given frame, or null if no person was found. */
  estimate(video: HTMLVideoElement, timestampMs: number): PoseFrame | null;
  close(): void;
}
