import { describe, expect, it } from 'vitest';
import { QueuedSpeechOutput, type SpeechEngine } from '../src/speech/SpeechOutput';

class FakeEngine implements SpeechEngine {
  spoken: string[] = [];
  stops = 0;
  lang = 'en-US';
  /** Languages with an on-device voice on this fake device. */
  localVoices = new Set(['en-US', 'zh-CN']);
  canSpeak(): boolean {
    return this.localVoices.has(this.lang);
  }
  setLanguage(lang: string): void {
    this.lang = lang;
  }
  private onEnd: (() => void) | null = null;
  start(text: string, onEnd: () => void): void {
    if (text) this.spoken.push(text);
    this.onEnd = onEnd;
  }
  stop(): void {
    this.stops++;
    const cb = this.onEnd;
    this.onEnd = null;
    cb?.(); // Real engines fire onend/onerror on cancel.
  }
  finish(): void {
    const cb = this.onEnd;
    this.onEnd = null;
    cb?.();
  }
}

function setup(maxAge = 2500) {
  let now = 0;
  const engine = new FakeEngine();
  const out = new QueuedSpeechOutput(engine, maxAge, () => now);
  return { engine, out, advance: (ms: number) => (now += ms) };
}

describe('QueuedSpeechOutput', () => {
  it('speaks immediately when idle and never overlaps', () => {
    const { engine, out } = setup();
    out.speak('one', 1);
    expect(engine.spoken).toEqual(['one']);
    out.speak('two', 1);
    expect(engine.spoken).toEqual(['one']); // queued, not overlapping
    expect(out.queued).toBe('two');
    engine.finish();
    expect(engine.spoken).toEqual(['one', 'two']);
  });

  it('keeps only the newest pending message', () => {
    const { engine, out } = setup();
    out.speak('one', 1);
    out.speak('two', 1);
    out.speak('three', 1);
    engine.finish();
    engine.finish();
    expect(engine.spoken).toEqual(['one', 'three']);
  });

  it('interrupts lower-priority speech for more important feedback', () => {
    const { engine, out } = setup();
    out.speak('Good stroke.', 1);
    out.speak('Contact point was too late.', 3);
    expect(engine.spoken).toEqual(['Good stroke.', 'Contact point was too late.']);
    expect(out.speaking).toBe('Contact point was too late.');
    engine.finish();
    expect(out.speaking).toBeNull();
  });

  it('drops stale queued feedback', () => {
    const { engine, out, advance } = setup(1000);
    out.speak('one', 1);
    out.speak('two', 1);
    advance(1500);
    engine.finish();
    expect(engine.spoken).toEqual(['one']);
  });

  it('mute silences and cancels speech', () => {
    const { engine, out } = setup();
    out.speak('one', 1);
    out.setMuted(true);
    expect(engine.stops).toBeGreaterThan(0);
    out.speak('two', 1);
    expect(engine.spoken).toEqual(['one']);
    out.setMuted(false);
    out.speak('three', 1);
    expect(engine.spoken).toEqual(['one', 'three']);
  });

  it('speak() returns immediately (non-blocking)', () => {
    const { out } = setup();
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) out.speak(`m${i}`, 1);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it('reports "unavailable" and speaks nothing without an on-device voice for the language', () => {
    const { engine, out } = setup();
    engine.localVoices = new Set(['en-US']);
    out.setLanguage('zh-CN');
    expect(out.available).toBe(false);
    expect(out.speak('击球点太晚了', 2)).toBe('unavailable');
    out.unlock();
    expect(engine.spoken).toEqual([]);
    out.setLanguage('en-US');
    expect(out.speak('Contact point was too late.', 2)).toBe('spoken');
    expect(engine.spoken).toEqual(['Contact point was too late.']);
  });

  it('switching language stops speech in the old language', () => {
    const { engine, out } = setup();
    out.speak('Good stroke.', 1);
    out.speak('Finish the follow-through.', 1);
    out.setLanguage('zh-CN');
    expect(engine.lang).toBe('zh-CN');
    expect(out.speaking).toBeNull();
    expect(out.queued).toBeNull();
    expect(engine.stops).toBeGreaterThan(0);
  });
});

describe('FallbackSpeechEngine', () => {
  /** Fake Web Speech: 'ok' speaks, 'fail' errors before starting. */
  function fakeWeb(mode: 'ok' | 'fail') {
    const said: string[] = [];
    return {
      said,
      speak(text: string, cb: { onEnd(): void; onFail(r: string): void }) {
        said.push(text);
        if (mode === 'ok') cb.onEnd();
        else cb.onFail('synthesis-failed');
      },
      stop() {},
      unlock() {},
      setLanguage() {},
    };
  }
  function fakeClips(ids: string[]) {
    const played: string[] = [];
    return {
      played,
      has: (_l: string, id?: string) => !!id && ids.includes(id),
      hasLanguage: () => ids.length > 0,
      play(lang: string, id: string, onEnd: () => void) {
        played.push(`${lang}/${id}`);
        onEnd();
      },
      stop() {},
      unlock() {},
    };
  }

  it('uses Web Speech when it works', async () => {
    const { FallbackSpeechEngine } = await import('../src/speech/SpeechOutput');
    const web = fakeWeb('ok');
    const clips = fakeClips(['speech.test']);
    const e = new FallbackSpeechEngine('zh-CN', web as never, clips as never);
    let ended = 0;
    e.start('语音测试成功，现在可以正常播放中文。', () => ended++, 'speech.test');
    expect(web.said).toEqual(['语音测试成功，现在可以正常播放中文。']);
    expect(clips.played).toEqual([]);
    expect(ended).toBe(1);
  });

  it('falls back to the bundled clip when Web Speech cannot speak, and keeps using clips', async () => {
    const { FallbackSpeechEngine } = await import('../src/speech/SpeechOutput');
    const web = fakeWeb('fail');
    const clips = fakeClips(['speech.test', 'issue.late-contact.now']);
    const e = new FallbackSpeechEngine('zh-CN', web as never, clips as never);
    let ended = 0;
    e.start('语音测试成功，现在可以正常播放中文。', () => ended++, 'speech.test');
    e.start('击球点太晚了', () => ended++, 'issue.late-contact.now');
    expect(web.said).toHaveLength(1); // not retried after failing
    expect(clips.played).toEqual(['zh-CN/speech.test', 'zh-CN/issue.late-contact.now']);
    expect(ended).toBe(2);
    e.resetFailures(); // the voice test button retries Web Speech
    e.start('击球点太晚了', () => ended++, 'issue.late-contact.now');
    expect(web.said).toHaveLength(2);
  });

  it('uses clips directly when the Web Speech API is missing, and reports total failure', async () => {
    const { FallbackSpeechEngine } = await import('../src/speech/SpeechOutput');
    const clips = fakeClips(['speech.test']);
    const e = new FallbackSpeechEngine('zh-CN', null, clips as never);
    let failures = 0;
    e.onFailure = () => failures++;
    expect(e.canSpeak()).toBe(true);
    e.start('语音测试成功，现在可以正常播放中文。', () => undefined, 'speech.test');
    e.start('没有对应音频的文字', () => undefined, 'unknown.clip');
    expect(clips.played).toEqual(['zh-CN/speech.test']);
    expect(failures).toBe(1);
    expect(new FallbackSpeechEngine('zh-CN', null, fakeClips([]) as never).canSpeak()).toBe(false);
  });
});
