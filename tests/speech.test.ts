import { describe, expect, it } from 'vitest';
import { QueuedSpeechOutput, type SpeechEngine } from '../src/speech/SpeechOutput';

class FakeEngine implements SpeechEngine {
  spoken: string[] = [];
  stops = 0;
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
});
