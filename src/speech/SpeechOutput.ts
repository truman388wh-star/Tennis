// Text-to-speech output with a non-blocking, non-overlapping queue.
//
// Policy (players need the *latest* relevant cue, not a backlog):
//   - nothing playing          -> speak immediately
//   - playing, new priority >  -> interrupt and speak the new message
//   - playing, otherwise       -> keep only the newest message as "pending"
//   - pending older than maxQueuedAgeMs when its turn comes -> dropped
// Speech runs in the browser's speech engine; calls return immediately, so
// camera capture, pose inference and stroke detection are never paused.
//
// Privacy: only ON-DEVICE voices for the selected language are ever used.
// If none exists, nothing is spoken (the caller shows the text instead).

export type SpeakResult = 'spoken' | 'queued' | 'muted' | 'unavailable';

export interface SpeechOutput {
  speak(text: string, priority: number): SpeakResult;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  /** Switches the speech language (e.g. 'zh-CN', 'en-US'); stops current speech. */
  setLanguage(lang: string): void;
  /** Whether an on-device voice for the current language is available. */
  readonly available: boolean;
  /** Must be called from a user gesture on iOS/Safari to enable audio. */
  unlock(): void;
  cancel(): void;
}

/** Minimal engine abstraction so the queue can be tested without a browser. */
export interface SpeechEngine {
  /** Starts speaking; must call onEnd exactly once when finished or cancelled. */
  start(text: string, onEnd: () => void): void;
  stop(): void;
  /** False when no on-device voice exists for the current language. */
  canSpeak(): boolean;
  setLanguage(lang: string): void;
}

interface Item {
  text: string;
  priority: number;
  queuedAt: number;
}

export class QueuedSpeechOutput implements SpeechOutput {
  private current: Item | null = null;
  private pending: Item | null = null;
  private _muted = false;
  /** Incremented per utterance so stale onEnd callbacks are ignored. */
  private generation = 0;

  constructor(
    private readonly engine: SpeechEngine,
    private readonly maxQueuedAgeMs: number,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get muted(): boolean {
    return this._muted;
  }

  get available(): boolean {
    return this.engine.canSpeak();
  }

  get speaking(): string | null {
    return this.current?.text ?? null;
  }

  get queued(): string | null {
    return this.pending?.text ?? null;
  }

  speak(text: string, priority: number): SpeakResult {
    if (this._muted || !text) return 'muted';
    if (!this.engine.canSpeak()) return 'unavailable';
    const item = { text, priority, queuedAt: this.now() };
    if (!this.current) {
      this.play(item);
      return 'spoken';
    }
    if (priority > this.current.priority) {
      this.pending = null;
      this.play(item);
      return 'spoken';
    }
    this.pending = item;
    return 'queued';
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (muted) this.cancel();
  }

  setLanguage(lang: string): void {
    this.cancel(); // Never finish a sentence in the old language.
    this.engine.setLanguage(lang);
  }

  unlock(): void {
    // Speaking an empty utterance inside a user gesture unlocks audio on iOS.
    // Only done with an on-device voice.
    if (!this.engine.canSpeak()) return;
    try {
      this.engine.start('', () => undefined);
    } catch {
      // Ignore: speech may be unavailable.
    }
  }

  cancel(): void {
    this.pending = null;
    this.current = null;
    this.generation++;
    this.engine.stop();
  }

  private play(item: Item): void {
    const gen = ++this.generation;
    if (this.current) this.engine.stop();
    this.current = item;
    this.engine.start(item.text, () => {
      if (gen !== this.generation) return; // Superseded utterance.
      this.current = null;
      const next = this.pending;
      this.pending = null;
      if (next && this.now() - next.queuedAt <= this.maxQueuedAgeMs) this.play(next);
    });
  }
}

const CANCEL_SETTLE_MS = 60;

type VoiceLike = Pick<SpeechSynthesisVoice, 'lang' | 'localService'>;

/**
 * How well a voice's language fits the requested language (0 = unusable).
 * zh-CN accepts Mandarin voices only (zh-CN / cmn / zh-Hans preferred, then
 * zh-TW / zh-SG Mandarin); Cantonese (zh-HK, yue) is rejected.
 */
function languageFit(voiceLang: string, lang: string): number {
  const v = voiceLang.replace(/_/g, '-').toLowerCase();
  const want = lang.toLowerCase();
  if (v === want) return 3;
  if (want.startsWith('zh')) {
    if (/^(zh-hk|zh-mo|yue)/.test(v)) return 0;
    if (/^(cmn|zh-hans)/.test(v)) return 2;
    if (/^zh(-|$)/.test(v)) return 1;
    return 0;
  }
  const base = want.split('-')[0];
  return v === base || v.startsWith(`${base}-`) ? 2 : 0;
}

/** Best ON-DEVICE voice for the language, or null. Never a network voice. */
export function pickLocalVoice<V extends VoiceLike>(voices: readonly V[], lang: string): V | null {
  let best: V | null = null;
  let bestFit = 0;
  for (const v of voices) {
    if (v.localService !== true) continue;
    const fit = languageFit(v.lang, lang);
    if (fit > bestFit) {
      best = v;
      bestFit = fit;
    }
  }
  return best;
}

/**
 * Browser SpeechSynthesis engine, restricted to ON-DEVICE voices.
 * Some browsers (e.g. desktop Chrome's "Google …" voices) offer network voices
 * that send the text to a server; coaching text is derived from the player's
 * technique, so only voices with localService === true are used. The browser
 * default voice is never used implicitly: without a matching local voice,
 * nothing is spoken.
 */
export class WebSpeechEngine implements SpeechEngine {
  private voice: SpeechSynthesisVoice | null = null;
  private lastCancelAt = Number.NEGATIVE_INFINITY;

  constructor(
    private lang: string,
    private readonly rate: number,
  ) {
    if (!WebSpeechEngine.available()) return;
    this.pick();
    speechSynthesis.addEventListener?.('voiceschanged', () => this.pick());
  }

  static available(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  private pick(): void {
    this.voice = pickLocalVoice(speechSynthesis.getVoices(), this.lang);
  }

  setLanguage(lang: string): void {
    this.lang = lang;
    if (WebSpeechEngine.available()) this.pick();
  }

  canSpeak(): boolean {
    if (!WebSpeechEngine.available()) return false;
    if (!this.voice) this.pick(); // Voice lists can load late (e.g. iOS).
    return this.voice !== null;
  }

  start(text: string, onEnd: () => void): void {
    if (!this.canSpeak()) {
      onEnd();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.voice = this.voice;
    u.lang = this.voice!.lang;
    u.rate = this.rate;
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        onEnd();
      }
    };
    u.onend = finish;
    u.onerror = finish;
    // Some Chrome versions silently drop an utterance queued right after
    // cancel(); defer briefly in that case (only when interrupting).
    if (performance.now() - this.lastCancelAt < CANCEL_SETTLE_MS) {
      setTimeout(() => speechSynthesis.speak(u), CANCEL_SETTLE_MS);
    } else {
      speechSynthesis.speak(u);
    }
  }

  stop(): void {
    if (!WebSpeechEngine.available()) return;
    this.lastCancelAt = performance.now();
    speechSynthesis.cancel();
  }
}

/** Used when speech synthesis is unavailable. */
export class SilentEngine implements SpeechEngine {
  start(_text: string, onEnd: () => void): void {
    queueMicrotask(onEnd);
  }

  stop(): void {}

  canSpeak(): boolean {
    return false;
  }

  setLanguage(_lang: string): void {}
}
