// All DOM updates for the main screen. The controller calls these methods;
// the view never reaches into the pipeline. Live-state updates are cheap and
// only touch text that changed; per-stroke updates rebuild small sections.
//
// Localization: every visible string comes from the active i18n resources.
// The view keeps what it shows as state (or as small `t => text` renderers),
// so a language switch re-renders everything immediately without a reload.

import type { UserSettings } from '../config/config';
import { coachingText, fmt, getMessages, LANGUAGES, type I18n, type Language, type Messages } from '../i18n';
import type { LiveState } from '../session/CoachSession';
import type { SessionSummary } from '../session/SessionSummary';
import type { CoachingFeedback, StrokeAnalysis } from '../types';
import { CATEGORY_IDS } from '../types';
import { byId, h, scoreClass, setText } from './dom';
import { SHOWN_METRICS } from './labels';

export type StatusKind = 'idle' | 'loading' | 'live' | 'demo' | 'file' | 'error';

/** Renders a piece of text in the current language. */
export type Text = (t: Messages) => string;

/** What happened to the spoken version of a stroke's feedback. */
export type SpeechOutcome = 'spoken' | 'notSpoken' | 'noVoice';

export interface ViewHandlers {
  onStartStop(): void;
  onVoiceToggle(): void;
  onDemo(): void;
  onFile(file: File): void;
  onSettingsChanged(settings: UserSettings): void;
  onLanguageChanged(lang: Language): void;
  onVoiceTest(): void;
  onZoom(level: number): void;
}

interface LiveView {
  live: LiveState | null;
  fps: number;
  inferenceMs: number | null;
}

export class CoachView {
  readonly video = byId<HTMLVideoElement>('video');
  readonly canvas = byId<HTMLCanvasElement>('overlay');
  private readonly stage = byId('stage');
  private readonly zoom = byId('zoom');
  private readonly status = byId('status');
  private readonly phase = byId('phase');
  private readonly perf = byId('perf');
  private readonly feedback = byId('feedback');
  private readonly feedbackText = byId('feedback-text');
  private readonly feedbackMeta = byId('feedback-meta');
  private readonly intro = byId('intro');
  private readonly introSteps = byId('intro-steps');
  private readonly scoreValue = byId('score-value');
  private readonly strokeCount = byId('stroke-count');
  private readonly subscores = byId('subscores');
  private readonly history = byId('history');
  private readonly metrics = byId('metrics');
  private readonly startBtn = byId<HTMLButtonElement>('start');
  private readonly voiceBtn = byId<HTMLButtonElement>('voice');
  private readonly demoBtn = byId<HTMLButtonElement>('demo');
  private readonly fileInput = byId<HTMLInputElement>('file');
  private readonly notice = byId('notice');
  private readonly error = byId('error');
  private readonly settingsDialog = byId<HTMLDialogElement>('settings');
  private readonly summaryDialog = byId<HTMLDialogElement>('summary');
  private readonly summaryContent = byId('summary-content');
  private readonly languageSelect = byId<HTMLSelectElement>('set-language');

  // Displayed state, re-rendered on language change.
  private running = false;
  private voiceOn: boolean;
  private statusKind: StatusKind = 'idle';
  private statusText: Text = (t) => t.status.notStarted;
  private liveView: LiveView = { live: null, fps: 0, inferenceMs: null };
  private last: { analysis: StrokeAnalysis; recent: readonly StrokeAnalysis[]; speech: SpeechOutcome } | null = null;
  private summary: SessionSummary | null = null;
  private noticeText: Text | null = null;
  private errorText: Text | null = null;

  constructor(
    private settings: UserSettings,
    private readonly i18n: I18n,
    private readonly handlers: ViewHandlers,
    private readonly historySize: number,
  ) {
    this.voiceOn = settings.voiceEnabled;
    this.startBtn.addEventListener('click', () => handlers.onStartStop());
    this.voiceBtn.addEventListener('click', () => handlers.onVoiceToggle());
    this.demoBtn.addEventListener('click', () => handlers.onDemo());
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file) handlers.onFile(file);
      this.fileInput.value = '';
    });
    byId('settings-btn').addEventListener('click', () => this.openSettings());
    byId('voice-test').addEventListener('click', () => handlers.onVoiceTest());
    this.bindSettings();
    i18n.subscribe(() => this.render());
    this.render();
  }

  private get t(): Messages {
    return this.i18n.t;
  }

  // ---- Full (re)render in the current language ------------------------------

  render(): void {
    const t = this.t;
    document.documentElement.lang = this.i18n.lang;
    document.title = t.meta.title;

    // Static text bound in index.html via data-i18n attributes.
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
      setText(el, lookup(t, el.dataset.i18n!));
    }
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-rich]')) {
      el.replaceChildren(...richText(lookup(t, el.dataset.i18nRich!)));
    }
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
      el.title = lookup(t, el.dataset.i18nTitle!);
    }
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
      el.setAttribute('aria-label', lookup(t, el.dataset.i18nAria!));
    }
    this.introSteps.replaceChildren(...t.intro.steps.map((step) => h('li', {}, ...richText(step))));
    this.history.dataset.empty = t.score.historyEmpty;

    // Language selector: endonyms, so each option is readable in any UI language.
    if (this.languageSelect.options.length !== LANGUAGES.length) {
      this.languageSelect.replaceChildren(
        ...LANGUAGES.map((l) => h('option', { value: l }, getMessages(l).meta.languageName)),
      );
    }
    this.languageSelect.value = this.i18n.lang;

    setText(this.startBtn, this.running ? t.buttons.stop : t.buttons.start);
    setText(this.voiceBtn, this.voiceOn ? t.buttons.voiceOn : t.buttons.voiceOff);
    this.renderStatus();
    this.renderLive();
    this.renderStroke();
    this.renderMessage(this.notice, this.noticeText);
    this.renderMessage(this.error, this.errorText);
    if (this.summary) this.renderSummary(this.summary);
  }

  // ---- Session state ------------------------------------------------------

  setRunning(running: boolean, kind: StatusKind): void {
    this.running = running;
    this.startBtn.dataset.running = String(running);
    setText(this.startBtn, running ? this.t.buttons.stop : this.t.buttons.start);
    this.demoBtn.disabled = running;
    this.fileInput.disabled = running;
    this.intro.hidden = running;
    this.phase.hidden = !running;
    this.perf.hidden = !running;
    if (running) {
      this.setStatus(kind, kind === 'demo' ? (t) => t.status.demo : kind === 'file' ? (t) => t.status.file : (t) => t.status.live);
    } else {
      this.setStatus('idle', (t) => t.status.stopped);
    }
  }

  setBusy(busy: boolean, message?: Text): void {
    this.startBtn.disabled = busy;
    if (busy && message) this.setStatus('loading', message);
  }

  setStatus(kind: StatusKind, text: Text): void {
    this.statusKind = kind;
    this.statusText = text;
    this.renderStatus();
  }

  private renderStatus(): void {
    this.status.dataset.kind = this.statusKind;
    setText(this.status, this.statusText(this.t));
  }

  setMirrored(mirrored: boolean): void {
    this.video.classList.toggle('mirrored', mirrored);
  }

  /** Live camera fills the stage (object-fit: cover); files and demo are letterboxed. */
  setCover(cover: boolean): void {
    this.stage.classList.toggle('cover', cover);
  }

  /** Shows real camera zoom presets; hidden when the camera has no zoom. */
  setZoomLevels(levels: readonly number[], current: number | null): void {
    if (this.zoom.childElementCount !== levels.length || levels.some((z, i) => (this.zoom.children[i] as HTMLElement).dataset.zoom !== String(z))) {
      this.zoom.replaceChildren(
        ...levels.map((z) => {
          const b = h('button', { type: 'button' }, `${z}×`);
          b.dataset.zoom = String(z);
          b.addEventListener('click', () => this.handlers.onZoom(z));
          return b;
        }),
      );
    }
    this.zoom.hidden = levels.length === 0;
    this.setActiveZoom(current);
  }

  setActiveZoom(current: number | null): void {
    // Highlight the preset nearest to the camera's actual zoom.
    let nearest: HTMLElement | null = null;
    let best = Infinity;
    for (const b of this.zoom.children as HTMLCollectionOf<HTMLElement>) {
      const d = current === null ? Infinity : Math.abs(Number(b.dataset.zoom) - current);
      if (d < best) {
        best = d;
        nearest = b;
      }
    }
    for (const b of this.zoom.children as HTMLCollectionOf<HTMLElement>) {
      b.setAttribute('aria-pressed', String(b === nearest && best < 0.25));
    }
  }

  showError(text: Text | null): void {
    this.errorText = text;
    this.renderMessage(this.error, text);
  }

  showNotice(text: Text | null): void {
    this.noticeText = text;
    this.renderMessage(this.notice, text);
  }

  private renderMessage(el: HTMLElement, text: Text | null): void {
    el.hidden = !text;
    setText(el, text ? text(this.t) : '');
  }

  setVoice(on: boolean): void {
    this.voiceOn = on;
    this.voiceBtn.setAttribute('aria-pressed', String(on));
    setText(this.voiceBtn, on ? this.t.buttons.voiceOn : this.t.buttons.voiceOff);
  }

  // ---- Live updates (called ~10x per second) --------------------------------

  updateLive(live: LiveState | null, fps: number, inferenceMs: number | null): void {
    this.liveView = { live, fps, inferenceMs };
    this.renderLive();
  }

  private renderLive(): void {
    const t = this.t;
    const { live, fps, inferenceMs } = this.liveView;
    if (!live) {
      setText(this.phase, t.live.noPlayer);
      this.phase.dataset.active = 'false';
    } else {
      const active = live.detectorState !== 'idle';
      setText(this.phase, live.poseVisible ? t.phases[live.phase] : t.live.bodyNotVisible);
      this.phase.dataset.active = String(active && live.poseVisible);
    }
    setText(
      this.perf,
      fmt(t.live.fps, { fps: Math.round(fps) }) +
        (inferenceMs !== null ? ` · ${fmt(t.live.inference, { ms: Math.round(inferenceMs) })}` : ''),
    );
  }

  // ---- Per-stroke updates ---------------------------------------------------

  showStroke(a: StrokeAnalysis, recent: readonly StrokeAnalysis[], speech: SpeechOutcome): void {
    this.last = { analysis: a, recent, speech };
    this.renderStroke();
    this.feedback.classList.remove('flash');
    void this.feedback.offsetWidth; // Restart the animation.
    this.feedback.classList.add('flash');
  }

  resetStrokes(): void {
    this.last = null;
    this.summary = null;
    this.renderStroke();
  }

  /** Localized text of a stroke's coaching feedback. */
  localizedFeedback(f: CoachingFeedback): string {
    return coachingText(f.message, this.i18n.lang);
  }

  private renderStroke(): void {
    const t = this.t;
    const a = this.last?.analysis ?? null;
    this.renderSubscores(a);
    if (!a || !this.last) {
      this.scoreValue.className = 'score-value na';
      setText(this.scoreValue, '–');
      setText(this.strokeCount, '');
      this.history.replaceChildren();
      this.metrics.replaceChildren();
      this.feedback.hidden = true;
      return;
    }
    const score = a.score.overall;
    this.scoreValue.className = `score-value ${scoreClass(score)}`;
    setText(this.scoreValue, String(score));
    setText(this.strokeCount, fmt(t.score.strokeNumber, { n: a.index }));
    this.renderHistory(this.last.recent);
    this.renderMetrics(a);

    this.feedback.hidden = false;
    this.feedback.dataset.kind = a.feedback.kind;
    setText(this.feedbackText, this.localizedFeedback(a.feedback));
    const speech = this.last.speech;
    setText(
      this.feedbackMeta,
      fmt(t.score.feedbackMeta, { n: a.index, score }) +
        (speech === 'noVoice' ? t.score.noVoice : speech === 'notSpoken' ? t.score.notSpoken : ''),
    );
  }

  private renderSubscores(a: StrokeAnalysis | null): void {
    const t = this.t;
    this.subscores.replaceChildren(
      ...CATEGORY_IDS.map((c) => {
        const v = a?.score.categories[c] ?? null;
        const pct = v === null ? 0 : Math.round(v);
        return h(
          'div',
          { class: `sub ${scoreClass(v)}` },
          h('span', { class: 'name' }, t.categories[c]),
          h('span', { class: 'bar' }, h('i', { style: `width:${pct}%` })),
          h('span', { class: 'val' }, v === null ? '–' : String(pct)),
        );
      }),
    );
  }

  private renderHistory(recent: readonly StrokeAnalysis[]): void {
    const t = this.t;
    const items = recent.slice(-this.historySize).reverse();
    this.history.replaceChildren(
      ...items.map((a) =>
        h('div', { class: `chip ${scoreClass(a.score.overall)}`, title: this.localizedFeedback(a.feedback) },
          String(a.score.overall), h('small', {}, fmt(t.score.chip, { n: a.index }))),
      ),
    );
  }

  private renderMetrics(a: StrokeAnalysis): void {
    const t = this.t;
    const rows: Node[] = [];
    for (const [id, unit] of SHOWN_METRICS) {
      const v = a.metrics[id];
      rows.push(h('dt', {}, t.metrics[id]), h('dd', {}, v === null ? '–' : `${formatNumber(v)}${t.units[unit]}`));
    }
    rows.push(
      h('dt', {}, t.details.feedbackDelay),
      h('dd', {}, `${Math.round(a.feedbackDelayMs)}${t.units.ms}`),
      h('dt', {}, t.details.confidence),
      h('dd', {}, `${Math.round(a.score.confidence * 100)}%`),
      h('dt', {}, t.details.why),
      h('dd', {}, reasonText(t, a)),
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
    this.languageSelect.addEventListener('change', () => {
      const lang = this.languageSelect.value as Language;
      if ((LANGUAGES as readonly string[]).includes(lang)) this.handlers.onLanguageChanged(lang);
    });
  }

  private openSettings(): void {
    byId<HTMLSelectElement>('set-hand').value = this.settings.handedness;
    byId<HTMLSelectElement>('set-net').value = this.settings.netDirection;
    byId<HTMLSelectElement>('set-camera').value = this.settings.cameraFacing;
    byId<HTMLInputElement>('set-fps').value = String(this.settings.targetPoseFps);
    setText(byId('set-fps-out'), String(this.settings.targetPoseFps));
    this.languageSelect.value = this.i18n.lang;
    this.settingsDialog.showModal();
  }

  showSummary(s: SessionSummary): void {
    this.summary = s;
    this.renderSummary(s);
    if (!this.summaryDialog.open) this.summaryDialog.showModal();
  }

  private renderSummary(s: SessionSummary): void {
    const t = this.t;
    const stat = (value: string, label: string, wide = false) =>
      h('div', { class: wide ? 'stat wide' : 'stat' }, h('b', {}, value), h('span', {}, label));
    const area = (x: SessionSummary['strongestArea']) =>
      x ? `${t.categories[x.category]} (${Math.round(x.average)})` : '–';
    const content: Node[] = [];
    if (s.totalStrokes === 0) {
      content.push(h('p', {}, t.summary.noStrokes));
    } else {
      const trendWord =
        s.trendLabel === 'improving'
          ? t.summary.trendImproving
          : s.trendLabel === 'declining'
            ? t.summary.trendDeclining
            : t.summary.trendSteady;
      const trend =
        s.trendLabel === 'not enough strokes' || s.recentTrend === null
          ? '–'
          : `${trendWord} ${fmt(t.summary.perStroke, { value: `${s.recentTrend > 0 ? '+' : ''}${s.recentTrend.toFixed(1)}` })}`;
      const issue = s.mostFrequentIssue
        ? `${t.coaching.issues[s.mostFrequentIssue.id].now} (${fmt(t.summary.times, { n: s.mostFrequentIssue.count })})`
        : t.summary.none;
      content.push(
        h('div', { class: 'summary-grid' },
          stat(String(s.totalStrokes), t.summary.forehands),
          stat(String(s.averageScore ?? '–'), t.summary.average),
          stat(String(s.bestScore ?? '–'), t.summary.best),
          stat(trend, t.summary.trend),
          stat(issue, t.summary.mostFrequentIssue, true),
          stat(area(s.strongestArea), t.summary.strongest, true),
          stat(area(s.weakestArea), t.summary.weakest, true),
        ),
        sparkline(s.scores, fmt(t.summary.sparkLabel, { scores: s.scores.join(', ') })),
      );
    }
    this.summaryContent.replaceChildren(...content);
  }
}

/** Resolves a dotted resource path such as "buttons.start". */
function lookup(t: Messages, path: string): string {
  let cur: unknown = t;
  for (const part of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[part];
  return typeof cur === 'string' ? cur : path;
}

/** Minimal safe markup for resource strings: **bold** and *emphasis* only. */
function richText(text: string): Node[] {
  const out: Node[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
    out.push(m[1] !== undefined ? h('strong', {}, m[1]) : h('em', {}, m[2]));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

/** Localized explanation of why this feedback was chosen. */
function reasonText(t: Messages, a: StrokeAnalysis): string {
  const f = a.feedback;
  switch (f.kind) {
    case 'visibility':
      return fmt(t.reasons.visibility, { pct: Math.round(a.score.confidence * 100) });
    case 'improvement':
      return t.reasons.improvement;
    case 'repeat':
      return fmt(t.reasons.repeat, { count: f.occurrences ?? '?', window: f.window ?? '?' });
    case 'issue':
      return fmt(t.reasons.issue, { severity: (f.severity ?? 0).toFixed(2) });
    default:
      return f.message.type === 'okStroke' ? t.reasons.modest : t.reasons.praise;
  }
}

function sparkline(scores: readonly number[], label: string): Node {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', '0 0 100 40');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
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

function formatNumber(v: number): string {
  return Math.abs(v) >= 10 ? String(Math.round(v)) : v.toFixed(2);
}
