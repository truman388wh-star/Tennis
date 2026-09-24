// Streaming forehand event detector.
//
// Signal: speed of the dominant wrist relative to the hips, in torso lengths
// per second. A forehand's forward swing is by far the fastest wrist motion
// in a rally cycle, so the stroke is anchored on that speed peak.
//
// State machine:
//   idle ──speed>prep──▶ preparing ──speed>swing──▶ swinging
//   swinging ──speed < peak*dropRatio──▶ followThrough
//   followThrough ──speed > peak──▶ swinging   (the first peak was only the
//                                                backswing; keep the faster one)
//   followThrough ──confirmDelay after peak──▶ validate ─▶ emit ─▶ cooldown
//   cooldown ──cooldownMs──▶ idle
// Waiting `confirmDelayMs` after the peak lets the follow-through be observed
// before analysis and prevents one swing from producing two events.

import type { DetectionConfig } from '../config/config';
import type { BodyFeatures, DetectorState, ForwardSign, NetDirection, StrokeEvent } from '../types';
import { ForwardDirectionEstimator } from './ForwardDirection';

export interface DetectorUpdate {
  state: DetectorState;
  event: StrokeEvent | null;
  /** Set when a swing candidate was discarded (for diagnostics). */
  rejected: string | null;
}

/** Interface so a learned detector can replace the heuristic one later. */
export interface StrokeEventDetector {
  update(f: BodyFeatures): DetectorUpdate;
  readonly state: DetectorState;
  /** Forward sign learned or configured so far (null = unknown). */
  readonly forwardSign: ForwardSign | null;
  reset(): void;
}

interface Peak {
  t: number;
  speed: number;
  vx: number;
}

export class HeuristicStrokeDetector implements StrokeEventDetector {
  private _state: DetectorState = 'idle';
  private movementStartT: number | null = null;
  private swingMs = 0;
  /** Frames of the fast part of the swing, and how many had both hands together. */
  private fastFrames = 0;
  private handsTogetherFrames = 0;
  private lastT: number | null = null;
  private lastValidT: number | null = null;
  private peak: Peak | null = null;
  private cooldownUntil = 0;
  private lastEventEndT = Number.NEGATIVE_INFINITY;
  private nextId = 1;
  private readonly direction: ForwardDirectionEstimator;

  constructor(
    private readonly cfg: DetectionConfig,
    netDirection: NetDirection = 'auto',
  ) {
    this.direction = new ForwardDirectionEstimator(netDirection, cfg.directionMinVotes, cfg.directionMinAgreement);
  }

  get state(): DetectorState {
    return this._state;
  }

  get forwardSign(): ForwardSign | null {
    return this.direction.sign;
  }

  reset(): void {
    this._state = 'idle';
    this.movementStartT = null;
    this.peak = null;
    this.lastT = null;
    this.lastValidT = null;
    this.cooldownUntil = 0;
    this.lastEventEndT = Number.NEGATIVE_INFINITY;
    this.direction.reset();
  }

  update(f: BodyFeatures): DetectorUpdate {
    const t = f.t;
    const dt = this.lastT === null ? 0 : Math.max(0, t - this.lastT);
    this.lastT = t;

    const speed = f.valid ? f.wristSpeed : null;
    if (speed === null || !f.wristVel) {
      // Missing wrist: tolerate short gaps, abandon the candidate on long ones.
      if (this.lastValidT !== null && t - this.lastValidT > this.cfg.maxTrackingGapMs && this.isActive()) {
        this.toIdle();
        return this.result(null, 'lost-tracking');
      }
      return this.result(null, null);
    }
    this.lastValidT = t;

    switch (this._state) {
      case 'cooldown':
        if (t >= this.cooldownUntil) {
          this.toIdle();
          return this.update(f); // Re-evaluate this frame from idle.
        }
        break;

      case 'idle':
        if (speed >= this.cfg.prepSpeed) {
          this.movementStartT = t;
          this._state = 'preparing';
        }
        if (speed >= this.cfg.swingSpeed) this.startSwing(f, speed);
        break;

      case 'preparing':
        if (speed >= this.cfg.swingSpeed) {
          this.startSwing(f, speed);
        } else if (this.movementStartT !== null && t - this.movementStartT > this.cfg.prepTimeoutMs) {
          this.toIdle();
        }
        break;

      case 'swinging':
        this.swingMs += dt;
        this.countHands(f);
        this.trackPeak(f, speed);
        if (this.peak && speed < this.peak.speed * this.cfg.followThroughDropRatio) {
          this._state = 'followThrough';
        }
        break;

      case 'followThrough': {
        if (this.peak && speed > this.peak.speed) {
          // Faster motion after an earlier local peak: that was the backswing.
          this._state = 'swinging';
          this.trackPeak(f, speed);
          break;
        }
        if (speed >= this.cfg.swingSpeed) {
          this.swingMs += dt;
          this.countHands(f);
        }
        if (this.peak && t - this.peak.t >= this.cfg.confirmDelayMs) {
          return this.finalize(t);
        }
        break;
      }
    }
    return this.result(null, null);
  }

  private isActive(): boolean {
    return this._state === 'preparing' || this._state === 'swinging' || this._state === 'followThrough';
  }

  private startSwing(f: BodyFeatures, speed: number): void {
    this._state = 'swinging';
    this.swingMs = 0;
    this.fastFrames = 0;
    this.handsTogetherFrames = 0;
    if (this.movementStartT === null) this.movementStartT = f.t;
    this.peak = null;
    this.countHands(f);
    this.trackPeak(f, speed);
  }

  /**
   * Two-handed swings (e.g. a two-handed backhand) keep both wrists together
   * for most of the fast part of the swing; a forehand only passes the off
   * hand briefly, so a single-frame check would be unreliable.
   */
  private countHands(f: BodyFeatures): void {
    if (!f.wrist || !f.offWrist) return;
    this.fastFrames++;
    if (Math.hypot(f.wrist.x - f.offWrist.x, f.wrist.y - f.offWrist.y) < this.cfg.twoHandedMaxDistance) {
      this.handsTogetherFrames++;
    }
  }

  private trackPeak(f: BodyFeatures, speed: number): void {
    if (this.peak && speed <= this.peak.speed) return;
    this.peak = { t: f.t, speed, vx: f.wristVel?.x ?? 0 };
  }

  private finalize(t: number): DetectorUpdate {
    const peak = this.peak;
    if (!peak) {
      this.toIdle();
      return this.result(null, 'no-peak');
    }
    let reason: string | null = null;
    const swingSign: ForwardSign = peak.vx >= 0 ? 1 : -1;
    const known = this.direction.sign;
    if (peak.speed < this.cfg.minPeakSpeed) reason = 'too-slow';
    else if (this.swingMs < this.cfg.minSwingMs) reason = 'too-short';
    else if (this.fastFrames > 0 && this.handsTogetherFrames / this.fastFrames >= this.cfg.twoHandedMinFraction)
      reason = 'two-handed';
    else if (known !== null && swingSign !== known) reason = 'wrong-direction';

    if (reason) {
      this.toIdle();
      return this.result(null, reason);
    }

    this.direction.vote(swingSign);
    // Analysis window: fixed look-back before the peak, but never overlapping
    // the previous stroke (important for rapid ball-machine feeds).
    const windowStartT = Math.max(peak.t - this.cfg.preContactWindowMs, this.lastEventEndT);
    const event: StrokeEvent = {
      id: this.nextId++,
      windowStartT: Math.min(windowStartT, peak.t),
      peakT: peak.t,
      endT: t,
      peakSpeed: peak.speed,
      swingSign,
      forwardSign: known ?? swingSign,
    };
    this.lastEventEndT = t;
    this._state = 'cooldown';
    this.cooldownUntil = t + this.cfg.cooldownMs;
    this.peak = null;
    this.movementStartT = null;
    return this.result(event, null);
  }

  private toIdle(): void {
    this._state = 'idle';
    this.movementStartT = null;
    this.peak = null;
    this.swingMs = 0;
  }

  private result(event: StrokeEvent | null, rejected: string | null): DetectorUpdate {
    return { state: this._state, event, rejected };
  }
}
