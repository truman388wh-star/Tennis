// All DOM updates for the main screen. The controller calls these methods;
// the view never reaches into the pipeline. Live-state updates are cheap and
// only touch text that changed; per-stroke updates rebuild small sections.

import type { UserSettings } from '../config/config';
import type { LiveState } from '../session/CoachSession';
import type { SessionSummary } from '../session/SessionSummary';
import type { StrokeAnalysis } from '../types';
import { CATEGORY_IDS } from '../types';
import { byId, h, scoreClass, setText } from './dom';
import { CATEGORY_LABELS, METRIC_LABELS } from './labels';

export type StatusKind = 'idle' | 'loading' | 'live' | 'demo' | 'file' | 'error';

export interface ViewHandlers {
  onStartStop(): void;
  onVoiceToggle(): void;
  onDemo(): void;
  onFile(file: File): void;
  onSettingsChanged(settings: UserSettings): void;
}

export class CoachView {
  readonly video = byId<HTMLVideoElement>('video');
  readonly canvas = byId<HTMLCanvasElement>('overlay');
  private readonly status = byId('status');
  private readonly phase = byId('phase');
  private readonly perf = byId('perf');
  private readonly feedback = byId('feedback');
  private readonly feedbackText = byId('feedback-text');
  private readonly feedbackMeta = byId('feedback-meta');
  private readonly intro = byId('intro');
  private readonly scoreValue = byId('score-value');
  private readonly strokeCount = byId('stroke-count');
  private readonly subscores = byId('subscores');
  private readonly history = byId('history');
  private readonly metrics = byId('metrics');
  private readonly startBtn = byId<HTMLButtonElement>('start');
  private readonly voiceBtn = byId<HTMLButtonElement>('voice');
  private readonly demoBtn = byId<HTMLButtonElement>('demo');
  private readonly fileInput = byId<HTMLInputElement>('file');
  private readonly error = byId('error');
  private readonly settingsDialog = byId<HTMLDialogElement>('settings');
  private readonly summaryDialog = byId<HTMLDialogElement>('summary');
  private readonly summaryContent = byId('summary-content');

  constructor(
    private settings: UserSettings,
    private readonly handlers: ViewHandlers,
    private readonly historySize: number,
  ) {
    this.startBtn.addEventListener('click', () => handlers.onStartStop());
    this.voiceBtn.addEventListener('click', () => handlers.onVoiceToggle());
    this.demoBtn.addEventListener('click', () => handlers.onDemo());
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file) handlers.onFile(file);
      this.fileInput.value = '';
    });
    byId('settings-btn').addEventListener('click', () => this.openSettings());
    this.bindSettings();
    this.renderSubscores(null);
    this.setVoice(settings.voiceEnabled);
  }

  // ---- Session state ------------------------------------------------------

  setRunning(running: boolean, kind: StatusKind): void {
    this.startBtn.dataset.running = String(running);
    setText(this.startBtn, running ? 'Stop' : 'Start');
    this.demoBtn.disabled = running;
    this.fileInput.disabled = running;
    this.intro.hidden = running;
    this.phase.hidden = !running;
    this.perf.hidden = !running;
    if (running) {
      this.setStatus(kind, kind === 'demo' ? 'Demo' : kind === 'file' ? 'Video file' : 'Live');
    } else {
      this.setStatus('idle', 'Stopped');
    }
  }

  setBusy(busy: boolean, message?: string): void {
    this.startBtn.disabled = busy;
    if (busy && message) this.setStatus('loading', message);
  }

  setStatus(kind: StatusKind, text: string): void {
    this.status.dataset.kind = kind;
    setText(this.status, text);
  }

  setMirrored(mirrored: boolean): void {
    this.video.classList.toggle('mirrored', mirrored);
  }

  showError(message: string | null): void {
    this.error.hidden = !message;
    setText(this.error, message ?? '');
  }

  setVoice(on: boolean): void {
    this.voiceBtn.setAttribute('aria-pressed', String(on));
    setText(this.voiceBtn, on ? '🔊 Voice on' : '🔇 Voice off');
  }

  // ---- Live updates (called ~10x per second) --------------------------------

  updateLive(live: LiveState | null, fps: number, inferenceMs: number | null): void {
    if (!live) {
      setText(this.phase, 'No player detected');
      this.phase.dataset.active = 'false';
    } else {
      const active = live.detectorState !== 'idle';
      setText(this.phase, live.poseVisible ? capitalize(live.phase) : 'Body not fully visible');
      this.phase.dataset.active = String(active && live.poseVisible);
    }
    setText(this.perf, `${Math.round(fps)} fps` + (inferenceMs !== null ? ` · ${Math.round(inferenceMs)} ms` : ''));
  }

  // ---- Per-stroke updates ---------------------------------------------------

  showStroke(a: StrokeAnalysis, recent: readonly StrokeAnalysis[]): void {
    const score = a.score.overall;
    this.scoreValue.className = `score-value ${scoreClass(score)}`;
    setText(this.scoreValue, String(score));
    setText(this.strokeCount, ` · #${a.index}`);
    this.renderSubscores(a);
    this.renderHistory(recent);
    this.renderMetrics(a);

    this.feedback.hidden = false;
    this.feedback.dataset.kind = a.feedback.kind;
    setText(this.feedbackText, a.feedback.text);
    setText(
      this.feedbackMeta,
      `Stroke ${a.index} · score ${score}` + (a.feedback.speak ? '' : ' · shown only (not spoken)'),
    );
    this.feedback.classList.remove('flash');
    void this.feedback.offsetWidth; // Restart the animation.
    this.feedback.classList.add('flash');
  }

  resetStrokes(): void {
    this.scoreValue.className = 'score-value na';
    setText(this.scoreValue, '–');
    setText(this.strokeCount, '');
    this.renderSubscores(null);
    this.history.replaceChildren();
    this.metrics.replaceChildren();
    this.feedback.hidden = true;
  }

  private renderSubscores(a: StrokeAnalysis | null): void {
    this.subscores.replaceChildren(
      ...CATEGORY_IDS.map((c) => {
        const v = a?.score.categories[c] ?? null;
        const pct = v === null ? 0 : Math.round(v);
        return h(
          'div',
          { class: `sub ${scoreClass(v)}` },
          h('span', { class: 'name' }, CATEGORY_LABELS[c]),
          h('span', { class: 'bar' }, h('i', { style: `width:${pct}%` })),
          h('span', { class: 'val' }, v === null ? '–' : String(pct)),
        );
      }),
    );
  }

  private renderHistory(recent: readonly StrokeAnalysis[]): void {
    const items = recent.slice(-this.historySize).reverse();
    this.history.replaceChildren(
      ...items.map((a) =>
        h('div', { class: `chip ${scoreClass(a.score.overall)}`, title: a.feedback.text },
          String(a.score.overall), h('small', {}, `#${a.index}`)),
      ),
    );
  }

  private renderMetrics(a: StrokeAnalysis): void {
    const rows: Node[] = [];
    for (const [id, [label, unit]] of Object.entries(METRIC_LABELS) as [keyof typeof a.metrics, [string, string]][]) {
      const v = a.metrics[id];
      rows.push(h('dt', {}, label), h('dd', {}, v === null ? '–' : `${formatNumber(v)}${unit}`));
    }
    rows.push(
      h('dt', {}, 'Feedback ready after contact'),
      h('dd', {}, `${Math.round(a.feedbackDelayMs)} ms`),
      h('dt', {}, 'Measurement confidence'),
      h('dd', {}, `${Math.round(a.score.confidence * 100)}%`),
      h('dt', {}, 'Why this feedback'),
      h('dd', {}, a.feedback.reason),
    );
    this.metrics.replaceChildren(...rows);
  }

  // ---- Settings & summary ---------------------------------------------------

  private bindSettings(): void {
    const hand = byId<HTMLSelectElement>('set-hand');
    const net = byId<HTMLSelectElement>('set-net');
    const cam = byId<HTMLSelectElement>('set-camera');
    const fps = byId<HTMLInputElement>('set-fps');
    const fpsOut = byId<HTMLOutputElement>('set-fps-out');
    const emit = () => {
      this.settings = {
        ...this.settings,
        handedness: hand.value === 'left' ? 'left' : 'right',
        netDirection: net.value === 'left' || net.value === 'right' ? net.value : 'auto',
        cameraFacing: cam.value === 'user' ? 'user' : 'environment',
        targetPoseFps: Number(fps.value),
      };
      setText(fpsOut, fps.value);
      this.handlers.onSettingsChanged(this.settings);
    };
    for (const el of [hand, net, cam, fps]) el.addEventListener('change', emit);
    fps.addEventListener('input', () => setText(fpsOut, fps.value));
  }

  private openSettings(): void {
    byId<HTMLSelectElement>('set-hand').value = this.settings.handedness;
    byId<HTMLSelectElement>('set-net').value = this.settings.netDirection;
    byId<HTMLSelectElement>('set-camera').value = this.settings.cameraFacing;
    byId<HTMLInputElement>('set-fps').value = String(this.settings.targetPoseFps);
    setText(byId('set-fps-out'), String(this.settings.targetPoseFps));
    this.settingsDialog.showModal();
  }

  showSummary(s: SessionSummary): void {
    const stat = (value: string, label: string, wide = false) =>
      h('div', { class: wide ? 'stat wide' : 'stat' }, h('b', {}, value), h('span', {}, label));
    const content: Node[] = [];
    if (s.totalStrokes === 0) {
      content.push(h('p', {}, 'No forehands were detected. Check that your whole body is visible and the phone is beside you.'));
    } else {
      const trend =
        s.trendLabel === 'not enough strokes'
          ? '–'
          : `${s.trendLabel}${s.recentTrend !== null ? ` (${s.recentTrend > 0 ? '+' : ''}${s.recentTrend.toFixed(1)}/stroke)` : ''}`;
      content.push(
        h('div', { class: 'summary-grid' },
          stat(String(s.totalStrokes), 'Forehands detected'),
          stat(String(s.averageScore ?? '–'), 'Average score'),
          stat(String(s.bestScore ?? '–'), 'Best stroke'),
          stat(trend, 'Recent trend'),
          stat(s.mostFrequentIssue ? `${s.mostFrequentIssue.label} (${s.mostFrequentIssue.count}×)` : 'None', 'Most frequent issue', true),
          stat(s.strongestArea ? `${CATEGORY_LABELS[s.strongestArea.category]} (${Math.round(s.strongestArea.average)})` : '–', 'Strongest area', true),
          stat(s.weakestArea ? `${CATEGORY_LABELS[s.weakestArea.category]} (${Math.round(s.weakestArea.average)})` : '–', 'Area to work on', true),
        ),
        sparkline(s.scores),
      );
    }
    this.summaryContent.replaceChildren(...content);
    this.summaryDialog.showModal();
  }
}

function sparkline(scores: readonly number[]): Node {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', '0 0 100 40');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Stroke scores: ${scores.join(', ')}`);
  if (scores.length > 1) {
    const pts = scores.map((v, i) => `${(i / (scores.length - 1)) * 100},${38 - (v / 100) * 36}`).join(' ');
    const line = document.createElementNS(ns, 'polyline');
    line.setAttribute('points', pts);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(line);
  }
  return svg;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatNumber(v: number): string {
  return Math.abs(v) >= 10 ? String(Math.round(v)) : v.toFixed(2);
}
