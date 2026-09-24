// Text-to-speech output with a non-blocking, non-overlapping queue.
//
// Policy (players need the *latest* relevant cue, not a backlog):
//   - nothing playing          -> speak immediately
//   - playing, new priority >  -> interrupt and speak the new message
//   - playing, otherwise       -> keep only the newest message as "pending"
//   - pending older than maxQueuedAgeMs when its turn comes -> dropped
// Speech runs in the browser's speech engine; calls return immediately, so
// camera capture, pose inference and stroke detection are never paused.

export interface SpeechOutput {
  speak(text: string, priority: number): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  /** Must be called from a user gesture on iOS/Safari to enable audio. */
  unlock(): void;
  cancel(): void;
}

/** Minimal engine abstraction so the queue can be tested without a browser. */
export interface SpeechEngine {
  /** Starts speaking; must call onEnd exactly once when finished or cancelled. */
  start(text: string, onEnd: () => void): void;
  stop(): void;
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

  get speaking(): string | null {
    return this.current?.text ?? null;
  }

  get queued(): string | null {
    return this.pending?.text ?? null;
  }

  speak(text: string, priority: number): void {
    if (this._muted || !text) return;
    const item = { text, priority, queuedAt: this.now() };
    if (!this.current) {
      this.play(item);
    } else if (priority > this.current.priority) {
      this.pending = null;
      this.play(item);
    } else {
      this.pending = item;
    }
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (muted) this.cancel();
  }

  unlock(): void {
    // Speaking an empty utterance inside a user gesture unlocks audio on iOS.
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

/** Best on-device voice for the language, or null. Never a network voice. */
export function pickLocalVoice(
  voices: readonly Pick<SpeechSynthesisVoice, 'lang' | 'localService'>[],
  lang: string,
): SpeechSynthesisVoice | null {
  const local = voices.filter((v) => v.localService);
  const base = lang.split('-')[0];
  return (
    (local.find((v) => v.lang === lang) ??
      local.find((v) => v.lang.replace('_', '-').startsWith(base)) ??
      null) as SpeechSynthesisVoice | null
  );
}

/**
 * Browser SpeechSynthesis engine, restricted to ON-DEVICE voices.
 * Some browsers (e.g. desktop Chrome's "Google …" voices) offer network voices
 * that send the text to a server; coaching text is derived from the player's
 * technique, so only voices with localService === true are used. If the voice
 * list is known and contains no local voice, feedback is shown but not spoken.
 */
export class WebSpeechEngine implements SpeechEngine {
  private voice: SpeechSynthesisVoice | null = null;
  private voicesKnown = false;
  private lastCancelAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly lang: string,
    private readonly rate: number,
  ) {
    if (!WebSpeechEngine.available()) return;
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      this.voicesKnown = voices.length > 0;
      this.voice = pickLocalVoice(voices, lang);
    };
    pick();
    speechSynthesis.addEventListener?.('voiceschanged', pick);
  }

  /** False when only network voices exist (speech disabled for privacy). */
  get hasPrivateVoice(): boolean {
    return !this.voicesKnown || this.voice !== null;
  }

  static available(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  start(text: string, onEnd: () => void): void {
    if (!WebSpeechEngine.available() || !this.hasPrivateVoice) {
      onEnd();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.lang;
    u.rate = this.rate;
    // Before the voice list has loaded (common on iOS), the platform default
    // voice is used; on iOS and Android that is the on-device system voice.
    if (this.voice) u.voice = this.voice;
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
}
