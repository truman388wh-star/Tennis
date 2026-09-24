import { describe, expect, it } from 'vitest';
import { isAllowedUrl } from '../src/privacy/networkGuard';
import { pickLocalVoice } from '../src/speech/SpeechOutput';
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

describe('speech voice selection (on-device only)', () => {
  const voices = [
    { lang: 'en-US', localService: false, name: 'Google US English' },
    { lang: 'zh-CN', localService: false, name: 'Google 普通话（中国大陆）' },
    { lang: 'zh-HK', localService: true, name: 'Sinji (Cantonese)' },
    { lang: 'en-GB', localService: true, name: 'Daniel' },
    { lang: 'zh-TW', localService: true, name: 'Meijia' },
    { lang: 'zh-CN', localService: true, name: 'Tingting' },
    { lang: 'en-US', localService: true, name: 'Samantha' },
  ];

  it('en-US: picks the local US English voice, never the network one', () => {
    expect(pickLocalVoice(voices, 'en-US')?.name).toBe('Samantha');
    expect(pickLocalVoice(voices.filter((v) => v.name !== 'Samantha'), 'en-US')?.name).toBe('Daniel');
  });

  it('zh-CN: picks a local Mandarin voice, never the network one or Cantonese', () => {
    expect(pickLocalVoice(voices, 'zh-CN')?.name).toBe('Tingting');
    expect(pickLocalVoice(voices.filter((v) => v.name !== 'Tingting'), 'zh-CN')?.name).toBe('Meijia');
    expect(pickLocalVoice([{ lang: 'zh_CN', localService: true }], 'zh-CN')).not.toBeNull();
    expect(pickLocalVoice([{ lang: 'cmn-Hans-CN', localService: true }], 'zh-CN')).not.toBeNull();
  });

  it('returns null (text only) when only network or wrong-language voices exist', () => {
    const remoteOnly = voices.filter((v) => !v.localService);
    expect(pickLocalVoice(remoteOnly, 'en-US')).toBeNull();
    expect(pickLocalVoice(remoteOnly, 'zh-CN')).toBeNull();
    expect(pickLocalVoice([{ lang: 'zh-HK', localService: true }], 'zh-CN')).toBeNull();
    expect(pickLocalVoice([{ lang: 'en-US', localService: true }], 'zh-CN')).toBeNull();
    expect(pickLocalVoice([{ lang: 'zh-CN', localService: true }], 'en-US')).toBeNull();
  });
});

describe('config', () => {
  it('references only local model and WASM paths', () => {
    expect(DEFAULT_CONFIG.pose.modelPath).not.toMatch(/^https?:/);
    expect(DEFAULT_CONFIG.pose.wasmPath).not.toMatch(/^https?:/);
    expect(JSON.stringify(DEFAULT_CONFIG)).not.toMatch(/https?:\/\//);
  });
});
