// Text-to-speech output with a non-blocking, non-overlapping queue.
//
// Policy (players need the *latest* relevant cue, not a backlog):
//   - nothing playing          -> speak immediately
//   - playing, new priority >  -> interrupt and speak the new message
//   - playing, otherwise       -> keep only the newest message as "pending"
//   - pending older than maxQueuedAgeMs when its turn comes -> dropped
// Speech runs in the browser's speech engine / an <audio> element; calls
// return immediately, so capture, pose inference and detection never pause.
//
// Engines, in order of preference (see FallbackSpeechEngine):
//   1. Web Speech API with a voice matching the language (e.g. a Chinese voice)
//   2. Web Speech API with the default system voice and utterance.lang set
//   3. Bundled pre-generated audio clips (public/audio/<lang>/<id>.mp3),
//      played as ordinary audio when the browser cannot synthesize speech.

export type SpeakResult = 'spoken' | 'queued' | 'muted' | 'unavailable';

export interface SpeechOutput {
  /** clipId: id of the bundled audio clip for this text (tier-3 fallback). */
  speak(text: string, priority: number, clipId?: string): SpeakResult;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  /** Switches the speech language (e.g. 'zh-CN', 'en-US'); stops current speech. */
  setLanguage(lang: string): void;
  /** Whether any way of producing speech exists for the current language. */
  readonly available: boolean;
  /** Must be called from a user gesture (tap) to unlock audio on mobile. */
  unlock(): void;
  cancel(): void;
}

/** Minimal engine abstraction so the queue can be tested without a browser. */
export interface SpeechEngine {
  /** Starts speaking; must call onEnd exactly once when finished, failed or cancelled. */
  start(text: string, onEnd: () => void, clipId?: string): void;
  stop(): void;
  canSpeak(): boolean;
  setLanguage(lang: string): void;
  unlock?(): void;
}

interface Item {
  text: string;
  clipId?: string;
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

  speak(text: string, priority: number, clipId?: string): SpeakResult {
    if (this._muted || !text) return 'muted';
    if (!this.engine.canSpeak()) return 'unavailable';
    const item = { text, clipId, priority, queuedAt: this.now() };
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
    try {
      this.engine.unlock?.();
    } catch (err) {
      console.warn('[speech] unlock failed', err);
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
    }, item.clipId);
  }
}

// ---------------------------------------------------------------------------
// Voice selection

type VoiceLike = Pick<SpeechSynthesisVoice, 'lang' | 'localService'> & { name?: string };

/**
 * How well a voice's language fits the requested language (0 = unusable).
 * zh-CN: zh-CN > zh-Hans-CN > zh-Hans / cmn > other Mandarin zh-* > zh-HK/yue
 * (Cantonese is last: it still reads Chinese characters aloud).
 */
export function languageFit(voiceLang: string, lang: string): number {
  const v = voiceLang.replace(/_/g, '-').toLowerCase();
  const want = lang.toLowerCase();
  if (v === want) return 10;
  if (want.startsWith('zh')) {
    if (v === 'zh-hans-cn') return 9;
    if (v === 'zh-hans' || v.startsWith('cmn')) return 8;
    if (/^(zh-hk|zh-mo|yue)/.test(v)) return 2;
    if (/^zh(-|$)/.test(v)) return 5;
    return 0;
  }
  const base = want.split('-')[0];
  return v === base || v.startsWith(`${base}-`) ? 5 : 0;
}

/**
 * Best voice for the language, or null (-> the default system voice is used
 * with utterance.lang set). On-device voices win over network voices of the
 * same language fit.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], lang: string): V | null {
  let best: V | null = null;
  let bestScore = 0;
  for (const v of voices) {
    const fit = languageFit(v.lang, lang);
    if (fit === 0) continue;
    const score = fit * 2 + (v.localService ? 1 : 0);
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Tier 1 + 2: Web Speech API

const CANCEL_SETTLE_MS = 60;
/** If no 'start' event arrives within this time, the engine is not producing speech. */
const START_TIMEOUT_MS = 2500;
const VOICE_POLL_MS = 250;
const VOICE_POLL_LIMIT = 20;

export interface UtteranceCallbacks {
  onEnd(): void;
  /** Speech could not be produced (error before start, or no start at all). */
  onFail(reason: string): void;
}

export class WebSpeechEngine {
  private voices: SpeechSynthesisVoice[] = [];
  private lastCancelAt = Number.NEGATIVE_INFINITY;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private loggedVoiceSummary = '';

  constructor(
    private lang: string,
    private readonly rate: number,
  ) {
    console.info('[speech] speechSynthesis supported:', WebSpeechEngine.supported());
    if (!WebSpeechEngine.supported()) return;
    this.loadVoices('initial');
    // Voices load asynchronously (often empty at first, especially on Android).
    speechSynthesis.addEventListener?.('voiceschanged', () => this.loadVoices('voiceschanged'));
    // Some browsers never fire voiceschanged: poll for a few seconds as well.
    let polls = 0;
    const timer = setInterval(() => {
      polls++;
      if (this.voices.length > 0 || polls >= VOICE_POLL_LIMIT) clearInterval(timer);
      else this.loadVoices('poll');
    }, VOICE_POLL_MS);
  }

  static supported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.speechSynthesis?.speak === 'function' &&
      typeof window.SpeechSynthesisUtterance === 'function'
    );
  }

  setLanguage(lang: string): void {
    this.lang = lang;
    if (WebSpeechEngine.supported()) this.logSelection();
  }

  private loadVoices(source: string): void {
    const list = speechSynthesis.getVoices();
    this.voices = list;
    const summary = list.map((v) => `${v.name} (${v.lang}${v.localService ? ', local' : ', network'})`).join('; ');
    if (summary !== this.loggedVoiceSummary) {
      this.loggedVoiceSummary = summary;
      console.info(`[speech] voices loaded (${source}): ${list.length}`);
      for (const v of list) console.info(`[speech]   voice name="${v.name}" lang=${v.lang} local=${v.localService}`);
      this.logSelection();
    }
  }

  private logSelection(): void {
    const v = pickVoice(this.voices, this.lang);
    if (v) console.info(`[speech] selected voice for ${this.lang}: "${v.name}" (${v.lang})`);
    else console.info(`[speech] no ${this.lang} voice in list; will use the default system voice with lang=${this.lang}`);
  }

  /** Speaks with the best matching voice, or the default voice with utterance.lang. */
  speak(text: string, cb: UtteranceCallbacks): void {
    if (this.voices.length === 0) this.loadVoices('speak');
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.lang;
    u.rate = this.rate;
    const voice = pickVoice(this.voices, this.lang);
    if (voice) {
      u.voice = voice;
      console.info(`[speech] speak "${text}" voice="${voice.name}" lang=${voice.lang} (utterance.lang=${u.lang})`);
    } else {
      console.info(`[speech] speak "${text}" with DEFAULT system voice fallback (utterance.lang=${u.lang})`);
    }
    let started = false;
    let finished = false;
    const done = (fn: () => void) => {
      if (finished) return;
      finished = true;
      if (this.watchdog) clearTimeout(this.watchdog);
      this.watchdog = null;
      fn();
    };
    u.onstart = () => {
      started = true;
      console.info(`[speech] start "${text}"`);
    };
    u.onend = () => {
      console.info(`[speech] end "${text}"`);
      done(() => (started ? cb.onEnd() : cb.onFail('ended without start')));
    };
    u.onerror = (e: SpeechSynthesisErrorEvent) => {
      console.warn(`[speech] error "${e.error}" for "${text}"`);
      const benign = e.error === 'interrupted' || e.error === 'canceled';
      done(() => (started || benign ? cb.onEnd() : cb.onFail(e.error)));
    };
    this.watchdog = setTimeout(() => {
      if (started || finished) return;
      console.warn(`[speech] no start event after ${START_TIMEOUT_MS} ms for "${text}"`);
      speechSynthesis.cancel();
      done(() => cb.onFail('timeout'));
    }, START_TIMEOUT_MS);

    const go = () => {
      speechSynthesis.resume?.(); // Some Android browsers start paused.
      speechSynthesis.speak(u);
    };
    // Some Chrome versions silently drop an utterance queued right after cancel().
    if (performance.now() - this.lastCancelAt < CANCEL_SETTLE_MS) setTimeout(go, CANCEL_SETTLE_MS);
    else go();
  }

  stop(): void {
    if (!WebSpeechEngine.supported()) return;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    this.lastCancelAt = performance.now();
    speechSynthesis.cancel();
  }

  /** Called inside a user gesture: a silent utterance unlocks speech on mobile. */
  unlock(): void {
    if (!WebSpeechEngine.supported()) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.lang = this.lang;
    u.volume = 0;
    speechSynthesis.resume?.();
    speechSynthesis.speak(u);
    console.info('[speech] speechSynthesis unlocked by user gesture');
  }
}

// ---------------------------------------------------------------------------
// Tier 3: bundled audio clips

export class AudioClipPlayer {
  private manifest: Record<string, string[]> | null = null;
  private readonly audio: HTMLAudioElement | null;

  constructor(private readonly baseUrl: string) {
    this.audio = typeof Audio === 'undefined' ? null : new Audio();
    if (this.audio) this.audio.preload = 'auto';
    void this.loadManifest();
  }

  private async loadManifest(): Promise<void> {
    try {
      const res = await fetch(new URL('audio/manifest.json', this.baseUrl).href);
      if (res.ok) this.manifest = await res.json();
      console.info('[speech] audio clip fallback', this.manifest ? 'available' : 'not available');
    } catch {
      console.info('[speech] audio clip fallback not available');
    }
  }

  has(lang: string, clipId: string | undefined): boolean {
    return !!this.audio && !!clipId && !!this.manifest?.[lang]?.includes(clipId);
  }

  hasLanguage(lang: string): boolean {
    return !!this.audio && !!this.manifest?.[lang]?.length;
  }

  private url(lang: string, clipId: string): string {
    return new URL(`audio/${lang}/${clipId}.mp3`, this.baseUrl).href;
  }

  play(lang: string, clipId: string, onEnd: () => void, onFail: (reason: string) => void): void {
    const a = this.audio!;
    let finished = false;
    const done = (fn: () => void) => {
      if (finished) return;
      finished = true;
      a.onended = null;
      a.onerror = null;
      fn();
    };
    console.info(`[speech] playing audio clip ${lang}/${clipId}`);
    a.muted = false;
    a.onended = () => {
      console.info(`[speech] audio clip end ${clipId}`);
      done(onEnd);
    };
    a.onerror = () => {
      console.warn(`[speech] audio clip error ${clipId}`);
      done(() => onFail('audio error'));
    };
    a.src = this.url(lang, clipId);
    a.play().then(
      () => console.info(`[speech] audio clip start ${clipId}`),
      (err: unknown) => {
        console.warn(`[speech] audio clip play() rejected: ${err instanceof Error ? err.name : String(err)}`);
        done(() => onFail('play rejected'));
      },
    );
  }

  stop(): void {
    this.audio?.pause();
  }

  /** Called inside a user gesture so later clips may play without one. */
  unlock(lang: string): void {
    const a = this.audio;
    if (!a || !this.has(lang, 'speech.enabled')) return;
    a.muted = true;
    a.src = this.url(lang, 'speech.enabled');
    a.play().then(
      () => {
        a.pause();
        a.muted = false;
        console.info('[speech] audio playback unlocked by user gesture');
      },
      () => (a.muted = false),
    );
  }
}

// ---------------------------------------------------------------------------
// Fallback chain

/**
 * Tries Web Speech (matching voice, else default voice with utterance.lang);
 * if the browser cannot produce speech for the language (error or no start
 * event), plays the bundled clip instead and keeps using clips for that
 * language for the rest of the session.
 */
export class FallbackSpeechEngine implements SpeechEngine {
  private readonly webFailed = new Set<string>();
  /** Called when neither Web Speech nor a clip could produce audio. */
  onFailure: (() => void) | null = null;

  constructor(
    private lang: string,
    private readonly web: WebSpeechEngine | null,
    private readonly clips: AudioClipPlayer | null,
  ) {}

  canSpeak(): boolean {
    return !!this.web || !!this.clips?.hasLanguage(this.lang);
  }

  setLanguage(lang: string): void {
    this.lang = lang;
    this.web?.setLanguage(lang);
  }

  /** Lets Web Speech be tried again (e.g. from the voice test button). */
  resetFailures(): void {
    this.webFailed.clear();
  }

  start(text: string, onEnd: () => void, clipId?: string): void {
    const lang = this.lang;
    const playClip = (reason: string) => {
      if (this.clips?.has(lang, clipId)) {
        console.info(`[speech] fallback to bundled audio clip (${reason})`);
        this.clips.play(lang, clipId!, onEnd, (r) => {
          console.warn(`[speech] no audio could be produced (${r})`);
          this.onFailure?.();
          onEnd();
        });
      } else {
        console.warn(`[speech] no audio fallback for "${text}" (${reason})`);
        this.onFailure?.();
        onEnd();
      }
    };
    if (this.web && !this.webFailed.has(lang)) {
      this.web.speak(text, {
        onEnd,
        onFail: (reason) => {
          console.warn(`[speech] Web Speech could not speak ${lang} (${reason}); using audio clips for ${lang} from now on`);
          this.webFailed.add(lang);
          playClip(reason);
        },
      });
    } else {
      playClip(this.web ? 'Web Speech failed earlier' : 'Web Speech not supported');
    }
  }

  stop(): void {
    this.web?.stop();
    this.clips?.stop();
  }

  unlock(): void {
    this.web?.unlock();
    this.clips?.unlock(this.lang);
  }
}

/** Used in tests and where no audio output exists. */
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
