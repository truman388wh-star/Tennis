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

describe('speech voice selection', () => {
  it('only ever picks on-device voices', () => {
    const voices = [
      { lang: 'en-US', localService: false, name: 'Google US English' },
      { lang: 'en-GB', localService: true, name: 'Daniel' },
    ];
    expect(pickLocalVoice(voices, 'en-US')).toMatchObject({ localService: true });
    expect(pickLocalVoice([{ lang: 'en-US', localService: false }], 'en-US')).toBeNull();
  });
});

describe('config', () => {
  it('references only local model and WASM paths', () => {
    expect(DEFAULT_CONFIG.pose.modelPath).not.toMatch(/^https?:/);
    expect(DEFAULT_CONFIG.pose.wasmPath).not.toMatch(/^https?:/);
    expect(JSON.stringify(DEFAULT_CONFIG)).not.toMatch(/https?:\/\//);
  });
});
