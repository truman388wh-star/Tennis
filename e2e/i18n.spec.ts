// Localization in a real browser: Chinese and English rendering, runtime
// switching without reload, persistence, localized coaching, and speech that
// follows the language using on-device voices only.
import { expect, test, type Page } from '@playwright/test';

interface FakeVoice {
  name: string;
  lang: string;
  localService: boolean;
}

const LOCAL_ZH: FakeVoice = { name: 'Tingting', lang: 'zh-CN', localService: true };
const LOCAL_EN: FakeVoice = { name: 'Samantha', lang: 'en-US', localService: true };
const REMOTE_ZH: FakeVoice = { name: 'Google 普通话（中国大陆）', lang: 'zh-CN', localService: false };
const REMOTE_EN: FakeVoice = { name: 'Google US English', lang: 'en-US', localService: false };

/**
 * Replaces the browser speech engine with a recorder that exposes the given
 * voice list, so tests can check exactly what is spoken and with which voice.
 */
async function mockSpeech(page: Page, voices: FakeVoice[]): Promise<void> {
  await page.addInitScript((list: FakeVoice[]) => {
    const w = window as unknown as Record<string, unknown>;
    const spoken: { text: string; lang: string; voice: string | null; local: boolean | null }[] = [];
    w.__spoken = spoken;
    class FakeUtterance {
      lang = '';
      voice: FakeVoice | null = null;
      rate = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    const synth = {
      speaking: false,
      pending: false,
      getVoices: () => list,
      speak(u: FakeUtterance) {
        spoken.push({ text: u.text, lang: u.lang, voice: u.voice?.name ?? null, local: u.voice?.localService ?? null });
        setTimeout(() => u.onend?.(), 30);
      },
      cancel() {},
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    w.SpeechSynthesisUtterance = FakeUtterance;
  }, voices);
}

function spoken(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __spoken: { text: string; lang: string; voice: string | null; local: boolean | null }[] }).__spoken,
  );
}

function externalRequests(page: Page): string[] {
  const out: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith('http') && u.origin !== new URL(page.url() === 'about:blank' ? r.url() : page.url()).origin) out.push(r.url());
  });
  return out;
}

async function strokes(page: Page, n: number) {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { coachApp: { strokeCount: number } }).coachApp.strokeCount), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(n);
}

async function chooseLanguage(page: Page, lang: 'zh-CN' | 'en-US') {
  await page.locator('#settings-btn').click();
  await page.locator('#set-language').selectOption(lang);
  await page.locator('#settings button[value="close"]').click();
}

test.describe('Chinese device', () => {
  test.use({ locale: 'zh-CN' });

  test('renders the UI in Simplified Chinese by default', async ({ page }) => {
    const ext = externalRequests(page);
    await page.goto('./');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('zh-CN');
    await expect(page).toHaveTitle('AI 网球教练');
    await expect(page.locator('#intro h1')).toHaveText('AI 网球教练');
    await expect(page.locator('#start')).toHaveText('开始');
    await expect(page.locator('#settings-btn')).toHaveText('⚙︎ 设置');
    await expect(page.locator('#demo')).toHaveText('试用演示（无需摄像头）');
    await expect(page.locator('#status')).toHaveText('未开始');
    await expect(page.locator('#subscores .sub .name').first()).toHaveText('准备');
    await expect(page.locator('#intro')).toContainText('隐私');
    await page.locator('#settings-btn').click();
    await expect(page.locator('#settings h2')).toHaveText('设置');
    await expect(page.locator('#set-language')).toHaveValue('zh-CN');
    await expect(page.locator('#set-hand option').first()).toHaveText('右手');
    // No English words in the visible main UI (brand "AI" and units aside).
    const visible = await page.locator('#app').innerText();
    expect(visible).not.toMatch(/\b(Start|Settings|Voice|Preparation|Rotation|Stroke|Try demo)\b/);
    expect(ext).toEqual([]);
  });

  test('coaches and speaks in Chinese with an on-device Mandarin voice', async ({ page }) => {
    await mockSpeech(page, [REMOTE_ZH, REMOTE_EN, LOCAL_EN, LOCAL_ZH]);
    const ext = externalRequests(page);
    await page.goto('./');
    await page.locator('#demo').click();
    await strokes(page, 2);
    await expect(page.locator('#feedback-text')).toHaveText(/击球点|好球|很好/);
    const said = await spoken(page);
    const cues = said.filter((s) => s.text);
    expect(cues.length).toBeGreaterThan(0);
    expect(cues[0].text).toBe('击球点太晚了'); // first demo stroke is a late contact
    for (const s of cues) {
      expect(s.voice).toBe('Tingting');
      expect(s.local).toBe(true);
      expect(s.lang).toBe('zh-CN');
    }
    // Details and history are localized too.
    await page.locator('#metrics-details summary').click();
    await expect(page.locator('#metrics')).toContainText('转肩角度');
    await expect(page.locator('#metrics')).toContainText('反馈依据');
    await page.locator('#start').click(); // 停止
    await expect(page.locator('#summary h2')).toHaveText('训练总结');
    await expect(page.locator('#summary-content')).toContainText('识别到的正手');
    await expect(page.locator('#summary-content')).toContainText('击球点太晚了');
    expect(ext).toEqual([]);
  });

  test('shows text only (never an online voice) when no local Mandarin voice exists', async ({ page }) => {
    await mockSpeech(page, [REMOTE_ZH, LOCAL_EN, REMOTE_EN]);
    const ext = externalRequests(page);
    await page.goto('./');
    await page.locator('#demo').click();
    await strokes(page, 1);
    await expect(page.locator('#feedback-text')).toHaveText('击球点太晚了');
    await expect(page.locator('#feedback-meta')).toContainText('未播报');
    await expect(page.locator('#notice')).toBeVisible();
    await expect(page.locator('#notice')).toContainText('没有本地中文语音');
    const said = (await spoken(page)).filter((s) => s.text);
    expect(said).toEqual([]); // nothing spoken, in particular not with the Google voice
    expect(ext).toEqual([]);
  });
});

test.describe('English device', () => {
  test.use({ locale: 'en-US' });

  test('renders the UI in English by default', async ({ page }) => {
    await page.goto('./');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en-US');
    await expect(page).toHaveTitle('AI Tennis Coach');
    await expect(page.locator('#start')).toHaveText('Start');
    await expect(page.locator('#status')).toHaveText('Not started');
    await expect(page.locator('#subscores .sub .name').first()).toHaveText('Preparation');
    const visible = await page.locator('#app').innerText();
    expect(visible).not.toMatch(/[一-鿿]/);
  });

  test('coaches and speaks in English with an on-device English voice', async ({ page }) => {
    await mockSpeech(page, [REMOTE_EN, LOCAL_ZH, LOCAL_EN]);
    const ext = externalRequests(page);
    await page.goto('./');
    await page.locator('#demo').click();
    await strokes(page, 2);
    const cues = (await spoken(page)).filter((s) => s.text);
    expect(cues[0].text).toBe('Contact point was too late.');
    for (const s of cues) {
      expect(s.voice).toBe('Samantha');
      expect(s.local).toBe(true);
    }
    expect(ext).toEqual([]);
  });

  test('shows text only when no local English voice exists', async ({ page }) => {
    await mockSpeech(page, [REMOTE_EN, LOCAL_ZH]);
    await page.goto('./');
    await page.locator('#demo').click();
    await strokes(page, 1);
    await expect(page.locator('#feedback-text')).toHaveText('Contact point was too late.');
    await expect(page.locator('#notice')).toContainText('no on-device English voice');
    expect((await spoken(page)).filter((s) => s.text)).toEqual([]);
  });
});

test.describe('switching language', () => {
  test.use({ locale: 'zh-CN' });

  test('switches UI, feedback and speech voice immediately, without reloading', async ({ page }) => {
    await mockSpeech(page, [LOCAL_ZH, LOCAL_EN]);
    const ext = externalRequests(page);
    await page.goto('./');
    await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
    await page.locator('#demo').click();
    await strokes(page, 1);
    await expect(page.locator('#feedback-text')).toHaveText('击球点太晚了');

    await chooseLanguage(page, 'en-US');
    // Same page (no reload), everything re-rendered in English, including the last feedback.
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en-US');
    await expect(page.locator('#start')).toHaveText('Stop');
    await expect(page.locator('#status')).toHaveText('Demo');
    await expect(page.locator('#feedback-text')).toHaveText('Contact point was too late.');
    await expect(page.locator('#subscores .sub .name').first()).toHaveText('Preparation');

    // Next spoken cues use the English on-device voice.
    const before = (await spoken(page)).length;
    await strokes(page, 3);
    const after = (await spoken(page)).slice(before).filter((s) => s.text);
    expect(after.length).toBeGreaterThan(0);
    for (const s of after) {
      expect(s.voice).toBe('Samantha');
      expect(s.text).not.toMatch(/[一-鿿]/);
    }

    await chooseLanguage(page, 'zh-CN');
    await expect(page.locator('#start')).toHaveText('停止');
    expect(ext).toEqual([]);
  });

  test('remembers the chosen language across reloads, overriding the device language', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('#start')).toHaveText('开始'); // device is Chinese
    await chooseLanguage(page, 'en-US');
    await expect(page.locator('#start')).toHaveText('Start');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tennis-coach.settings.v1') ?? '{}'));
    expect(saved.language).toBe('en-US');
    await page.reload();
    await expect(page.locator('#start')).toHaveText('Start');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en-US');
  });
});
