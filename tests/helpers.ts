import { createConfig, type AppConfig } from '../src/config/config';
import { CoachSession, createDefaultStages } from '../src/session/CoachSession';
import type { BodyFeatures, Handedness, NetDirection, PoseFrame, StrokeAnalysis } from '../src/types';

export interface RunResult {
  analyses: StrokeAnalysis[];
  rejected: { t: number; reason: string }[];
  states: string[];
  session: CoachSession;
}

export function runFrames(
  frames: PoseFrame[],
  opts: { handedness?: Handedness; netDirection?: NetDirection; config?: AppConfig } = {},
): RunResult {
  const config = opts.config ?? createConfig();
  const session = new CoachSession(
    config,
    createDefaultStages(config, { handedness: opts.handedness ?? 'right', netDirection: opts.netDirection ?? 'auto' }),
  );
  const analyses: StrokeAnalysis[] = [];
  const rejected: { t: number; reason: string }[] = [];
  const states: string[] = [];
  for (const f of frames) {
    const r = session.processFrame(f);
    if (states[states.length - 1] !== r.live.detectorState) states.push(r.live.detectorState);
    if (r.analysis) analyses.push(r.analysis);
    if (r.rejected) rejected.push({ t: f.timestampMs, reason: r.rejected });
  }
  return { analyses, rejected, states, session };
}

/** A BodyFeatures stub with sensible defaults, for detector unit tests. */
export function feat(t: number, over: Partial<BodyFeatures> = {}): BodyFeatures {
  return {
    t,
    valid: true,
    bodyScale: 0.2,
    hipCenter: { x: 0.9, y: 0.5 },
    shoulderCenter: { x: 0.9, y: 0.3 },
    wrist: { x: 0.5, y: -0.2 },
    wristVel: { x: 0, y: 0 },
    wristSpeed: 0,
    wristAccel: 0,
    offWrist: { x: 1.2, y: -0.6 },
    elbowAngle: 150,
    shoulderAngle: 30,
    shoulderTurn: 10,
    hipTurn: 5,
    trunkLean: 0,
    stanceWidth: 1.4,
    ankleCenter: { x: 0.9, y: 0.93 },
    head: { x: 0.93, y: 0.2 },
    facing: 0.2,
    visibility: 0.95,
    ...over,
  };
}

/** Frames with a given wrist speed profile (speed in T/s, direction sign in x). */
export function speedProfile(speeds: number[], dtMs = 33.3, sign = 1, over: Partial<BodyFeatures> = {}): BodyFeatures[] {
  return speeds.map((s, i) => feat(i * dtMs, { wristSpeed: s, wristVel: { x: sign * s, y: 0 }, ...over }));
}
