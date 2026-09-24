// Framework-free real-time pipeline:
//   PoseFrame -> features -> temporal buffer -> stroke event detector
//   -> (on stroke) phase segmentation -> metrics -> score -> coaching.
// Each stage is injected through an interface so it can be replaced (e.g. by
// a learned stroke classifier or a racket-aware metric model) independently.
// This class has no DOM dependencies and is fully testable with synthetic data.

import type { AppConfig, UserSettings } from '../config/config';
import type { BodyFeatures, DetectorState, ForwardSign, PoseFrame, StrokeAnalysis } from '../types';
import { PoseBuffer } from '../buffer/PoseBuffer';
import { FeatureExtractor, type FeatureExtractorLike } from '../features/FeatureExtractor';
import { HeuristicStrokeDetector, type StrokeEventDetector } from '../stroke/StrokeDetector';
import { HeuristicPhaseSegmenter, type StrokePhaseSegmenter } from '../phases/PhaseSegmenter';
import { HeuristicMetricsCalculator, type StrokeMetricsCalculator } from '../metrics/MetricsCalculator';
import { WeightedStrokeScorer, type StrokeQualityScorer } from '../scoring/StrokeScorer';
import { CoachingEngine } from '../coaching/CoachingEngine';

export interface PipelineStages {
  features: FeatureExtractorLike;
  detector: StrokeEventDetector;
  segmenter: StrokePhaseSegmenter;
  metrics: StrokeMetricsCalculator;
  scorer: StrokeQualityScorer;
  coach: CoachingEngine;
}

/** Human-readable live phase for the UI. */
export type LivePhase = 'ready' | 'preparation' | 'backswing' | 'forward swing' | 'follow-through' | 'analyzing';

export interface LiveState {
  t: number;
  poseVisible: boolean;
  detectorState: DetectorState;
  phase: LivePhase;
  wristSpeed: number | null;
  forwardSign: ForwardSign | null;
}

export interface FrameResult {
  live: LiveState;
  analysis: StrokeAnalysis | null;
  rejected: string | null;
}

export function createDefaultStages(config: AppConfig, settings: Pick<UserSettings, 'handedness' | 'netDirection'>): PipelineStages {
  return {
    features: new FeatureExtractor(config.features, settings.handedness),
    detector: new HeuristicStrokeDetector(config.detection, settings.netDirection),
    segmenter: new HeuristicPhaseSegmenter(config.segmentation),
    metrics: new HeuristicMetricsCalculator(config.metrics),
    scorer: new WeightedStrokeScorer(config.scoring),
    coach: new CoachingEngine(config.coaching, config.scoring),
  };
}

export class CoachSession {
  private readonly buffer: PoseBuffer;
  private strokeCount = 0;
  readonly analyses: StrokeAnalysis[] = [];
  /** Keep the full per-stroke list bounded for very long sessions. */
  private readonly maxAnalyses = 2000;

  constructor(
    config: AppConfig,
    readonly stages: PipelineStages,
  ) {
    this.buffer = new PoseBuffer(config.detection.bufferWindowMs);
  }

  processFrame(frame: PoseFrame): FrameResult {
    const f = this.stages.features.process(frame);
    this.buffer.push(f);
    const upd = this.stages.detector.update(f);
    let analysis: StrokeAnalysis | null = null;
    if (upd.event) analysis = this.analyze(upd.event);
    return {
      live: {
        t: f.t,
        poseVisible: f.valid,
        detectorState: upd.state,
        phase: livePhase(upd.state, f, this.stages.detector.forwardSign),
        wristSpeed: f.wristSpeed,
        forwardSign: this.stages.detector.forwardSign,
      },
      analysis,
      rejected: upd.rejected,
    };
  }

  private analyze(event: NonNullable<ReturnType<StrokeEventDetector['update']>['event']>): StrokeAnalysis | null {
    const frames = this.buffer.range(event.windowStartT, event.endT);
    const phases = this.stages.segmenter.segment(frames, event);
    if (!phases) return null;
    const metrics = this.stages.metrics.compute(frames, phases, event);
    const score = this.stages.scorer.score(metrics, frames);
    const { issues, feedback } = this.stages.coach.assess(metrics, score);
    const analysis: StrokeAnalysis = {
      index: ++this.strokeCount,
      event,
      phases,
      metrics,
      score,
      issues,
      feedback,
      feedbackDelayMs: event.endT - frames[phases.contactIndex].t,
    };
    this.analyses.push(analysis);
    if (this.analyses.length > this.maxAnalyses) this.analyses.shift();
    return analysis;
  }

  reset(): void {
    this.buffer.clear();
    this.stages.features.reset();
    this.stages.detector.reset();
    this.stages.coach.reset();
    this.analyses.length = 0;
    this.strokeCount = 0;
  }
}

function livePhase(state: DetectorState, f: BodyFeatures, fs: ForwardSign | null): LivePhase {
  switch (state) {
    case 'preparing': {
      // Wrist moving away from the net while preparing = taking it back.
      const vx = f.wristVel?.x ?? 0;
      return fs !== null && vx * fs < -0.5 ? 'backswing' : 'preparation';
    }
    case 'swinging':
      return 'forward swing';
    case 'followThrough':
      return 'follow-through';
    case 'cooldown':
      return 'analyzing';
    default:
      return 'ready';
  }
}
