import { describe, expect, it } from 'vitest';
import { ISSUE_IDS, PRAISE_ORDER } from '../src/coaching/issues';
import { loadSettings, saveSettings } from '../src/config/settings';
import { DEFAULT_SETTINGS } from '../src/config/config';
import {
  coachingText,
  detectLanguage,
  fmt,
  getMessages,
  I18n,
  LANGUAGES,
  resolveLanguage,
} from '../src/i18n';
import { enUS } from '../src/i18n/en-US';
import { zhCN } from '../src/i18n/zh-CN';
import { CATEGORY_IDS } from '../src/types';

/** All leaf paths of a resource object. */
function paths(obj: unknown, prefix = ''): string[] {
  if (typeof obj === 'string') return [prefix];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => paths(v, `${prefix}[${i}]`));
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => paths(v, prefix ? `${prefix}.${k}` : k));
}

function leaf(obj: unknown, path: string): string {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj) as string;
}

const HAN = /[一-鿿]/;

describe('localized resources', () => {
  it('zh-CN and en-US define exactly the same keys, all non-empty', () => {
    expect(paths(zhCN).sort()).toEqual(paths(enUS).sort());
    for (const lang of LANGUAGES) for (const p of paths(getMessages(lang))) expect(leaf(getMessages(lang), p), p).not.toBe('');
  });

  it('keeps placeholders consistent between languages', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const p of paths(enUS)) expect(ph(leaf(zhCN, p)), p).toBe(ph(leaf(enUS, p)));
  });

  it('Chinese resources are actually Chinese (except shared/technical strings)', () => {
    const shared = new Set(['settings.language', 'units.deg', 'score.chip']);
    const latinOk = /^(buttons\.(voiceOn|voiceOff|settings)|units\.)/;
    for (const p of paths(zhCN)) {
      if (shared.has(p) || latinOk.test(p)) continue;
      expect(HAN.test(leaf(zhCN, p)), `${p}: ${leaf(zhCN, p)}`).toBe(true);
    }
    for (const p of paths(enUS)) {
      if (p === 'settings.language') continue;
      expect(HAN.test(leaf(enUS, p)), p).toBe(false);
    }
  });

  it('has every coaching message in both languages', () => {
    for (const lang of LANGUAGES) {
      for (const issue of ISSUE_IDS) {
        for (const variant of ['now', 'repeated', 'improved'] as const) {
          expect(coachingText({ type: 'issue', issue, variant }, lang)).toBeTruthy();
        }
      }
      for (const c of [...CATEGORY_IDS, ...PRAISE_ORDER]) expect(coachingText({ type: 'praise', category: c }, lang)).toBeTruthy();
    }
  });

  it('uses the agreed on-court phrasing', () => {
    const now = (issue: (typeof ISSUE_IDS)[number], lang: 'zh-CN' | 'en-US') => coachingText({ type: 'issue', issue, variant: 'now' }, lang);
    expect(now('late-contact', 'zh-CN')).toBe('击球点太晚了');
    expect(now('late-preparation', 'zh-CN')).toBe('准备再早一点');
    expect(now('small-shoulder-turn', 'zh-CN')).toBe('转肩更充分一些');
    expect(now('no-weight-transfer', 'zh-CN')).toBe('重心向前送');
    expect(now('short-follow-through', 'zh-CN')).toBe('随挥再完整一点');
    expect(coachingText({ type: 'issue', issue: 'late-contact', variant: 'improved' }, 'zh-CN')).toBe('很好，击球点更靠前了');

    expect(now('late-contact', 'en-US')).toBe('Contact point was too late.');
    expect(now('late-preparation', 'en-US')).toBe('Prepare a little earlier.');
    expect(now('small-shoulder-turn', 'en-US')).toBe('Rotate your shoulders more.');
    expect(now('no-weight-transfer', 'en-US')).toBe('Transfer your weight forward.');
    expect(now('short-follow-through', 'en-US')).toBe('Finish the follow-through.');
    expect(coachingText({ type: 'issue', issue: 'late-contact', variant: 'improved' }, 'en-US')).toBe(
      'Good, your contact point is earlier now.',
    );
  });

  it('Chinese cues are short (spoken while playing)', () => {
    for (const issue of ISSUE_IDS) expect(coachingText({ type: 'issue', issue, variant: 'now' }, 'zh-CN').length).toBeLessThanOrEqual(10);
  });

  it('fmt fills placeholders', () => {
    expect(fmt('第 {n} 拍 · 得分 {score}', { n: 3, score: 88 })).toBe('第 3 拍 · 得分 88');
    expect(fmt('{missing}', {})).toBe('{missing}');
  });
});

describe('language selection', () => {
  it('detects Chinese devices as zh-CN, everything else as en-US', () => {
    expect(detectLanguage(['zh-CN', 'en-US'])).toBe('zh-CN');
    expect(detectLanguage(['zh-TW'])).toBe('zh-CN');
    expect(detectLanguage(['zh-Hans-CN'])).toBe('zh-CN');
    expect(detectLanguage(['zh'])).toBe('zh-CN');
    expect(detectLanguage(['en-GB', 'zh-CN'])).toBe('en-US');
    expect(detectLanguage(['fr-FR'])).toBe('en-US');
    expect(detectLanguage([])).toBe('en-US');
  });

  it('always respects a saved preference over the device language', () => {
    expect(resolveLanguage('en-US', ['zh-CN'])).toBe('en-US');
    expect(resolveLanguage('zh-CN', ['en-US'])).toBe('zh-CN');
    expect(resolveLanguage(undefined, ['zh-CN'])).toBe('zh-CN');
    expect(resolveLanguage('de-DE', ['en-US'])).toBe('en-US');
  });

  it('notifies subscribers when the language changes', () => {
    const i18n = new I18n('en-US');
    const seen: string[] = [];
    i18n.subscribe((l) => seen.push(l));
    i18n.setLanguage('zh-CN');
    i18n.setLanguage('zh-CN'); // no duplicate notification
    expect(seen).toEqual(['zh-CN']);
    expect(i18n.t.buttons.start).toBe('开始');
  });

  it('persists the language preference, and only once the user picked one', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveSettings({ ...DEFAULT_SETTINGS }, storage);
    expect(loadSettings(storage).language).toBeUndefined();
    saveSettings({ ...DEFAULT_SETTINGS, language: 'zh-CN' }, storage);
    expect(loadSettings(storage).language).toBe('zh-CN');
    store.set('tennis-coach.settings.v1', JSON.stringify({ language: 'klingon' }));
    expect(loadSettings(storage).language).toBeUndefined();
  });
});
