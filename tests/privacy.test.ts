import { describe, expect, it } from 'vitest';
import { isAllowedUrl } from '../src/privacy/networkGuard';
import { pickVoice } from '../src/speech/SpeechOutput';
import { DEFAULT_CONFIG } from '../src/config/config';

const ORIGIN = 'https://truman388wh-star.github.io';

describe('network guard URL policy', () => {
  it('allows the app’s own files and local blob/data URLs', () => {
    expect(isAllowedUrl('/Tennis/models/pose_landmarker_lite.task', ORIGIN)).toBe(true);
    expect(isAllowedUrl(`${ORIGIN}/Tennis/mediapipe/wasm/vision_wasm_internal.wasm`, ORIGIN)).toBe(true);
    expect(isAllowedUrl('blob:https://truman388wh-star.github.io/1234', ORIGIN)).toBe(true);
    expect(isAllowedUrl('data:application/octet-stream;base64,AA==', ORIGIN)).toBe(true);
  });

  it('blocks every other origin, including MediaPipe telemetry and CDNs', () => {
    expect(isAllowedUrl('https://odml.pa.googleapis.com/v1/log', ORIGIN)).toBe(false);
    expect(isAllowedUrl('https://storage.googleapis.com/mediapipe-models/x.task', ORIGIN)).toBe(false);
    expect(isAllowedUrl('https://cdn.jsdelivr.net/npm/x', ORIGIN)).toBe(false);
    expect(isAllowedUrl('http://truman388wh-star.github.io/Tennis/', ORIGIN)).toBe(false); // other scheme
    expect(isAllowedUrl('https://evil.github.io/', ORIGIN)).toBe(false);
  });
});

describe('speech voice selection', () => {
  const voices = [
    { lang: 'en-US', localService: false, name: 'Google US English' },
    { lang: 'zh-CN', localService: false, name: 'Google 普通话（中国大陆）' },
    { lang: 'zh-HK', localService: true, name: 'Sinji (Cantonese)' },
    { lang: 'en-GB', localService: true, name: 'Daniel' },
    { lang: 'zh-TW', localService: true, name: 'Meijia' },
    { lang: 'zh-CN', localService: true, name: 'Tingting' },
    { lang: 'en-US', localService: true, name: 'Samantha' },
  ];
  const only = (...names: string[]) => voices.filter((v) => names.includes(v.name));

  it('prefers an on-device voice of the exact language', () => {
    expect(pickVoice(voices, 'en-US')?.name).toBe('Samantha');
    expect(pickVoice(voices, 'zh-CN')?.name).toBe('Tingting');
  });

  it('zh-CN fallback order: zh-CN > zh-Hans-CN > zh-Hans/cmn > zh-* > Cantonese', () => {
    expect(pickVoice(only('Google 普通话（中国大陆）', 'Meijia'), 'zh-CN')?.name).toBe('Google 普通话（中国大陆）');
    expect(pickVoice([{ lang: 'zh-Hans-CN', localService: true, name: 'A' }, { lang: 'zh-Hans', localService: true, name: 'B' }], 'zh-CN')?.name).toBe('A');
    expect(pickVoice([{ lang: 'zh-Hans', localService: false, name: 'B' }, { lang: 'zh-TW', localService: true, name: 'C' }], 'zh-CN')?.name).toBe('B');
    expect(pickVoice([{ lang: 'cmn-Hans-CN', localService: true, name: 'D' }], 'zh-CN')?.name).toBe('D');
    expect(pickVoice([{ lang: 'zh_CN', localService: true, name: 'E' }], 'zh-CN')?.name).toBe('E');
    expect(pickVoice(only('Meijia', 'Sinji (Cantonese)'), 'zh-CN')?.name).toBe('Meijia');
    expect(pickVoice(only('Sinji (Cantonese)'), 'zh-CN')?.name).toBe('Sinji (Cantonese)');
  });

  it('returns null when the language has no voice (default system voice + utterance.lang is used then)', () => {
    expect(pickVoice(only('Samantha', 'Daniel'), 'zh-CN')).toBeNull();
    expect(pickVoice(only('Tingting'), 'en-US')).toBeNull();
    expect(pickVoice([], 'zh-CN')).toBeNull();
  });
});

describe('config', () => {
  it('references only local model and WASM paths', () => {
    expect(DEFAULT_CONFIG.pose.modelPath).not.toMatch(/^https?:/);
    expect(DEFAULT_CONFIG.pose.wasmPath).not.toMatch(/^https?:/);
    expect(JSON.stringify(DEFAULT_CONFIG)).not.toMatch(/https?:\/\//);
  });
});
