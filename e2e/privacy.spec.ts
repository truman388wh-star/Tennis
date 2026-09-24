// Privacy guarantees, checked in a real browser against the production build:
// camera data and derived data never leave the device, and only static app
// files are requested from the site's own origin.
import { expect, test, type Page } from '@playwright/test';

interface Req {
  method: string;
  url: string;
  hasBody: boolean;
}

function recordRequests(page: Page): Req[] {
  const reqs: Req[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith('http')) reqs.push({ method: r.method(), url: r.url(), hasBody: r.postDataBuffer() !== null });
  });
  return reqs;
}

/** Static files the app is allowed to load (relative to the app's base URL). */
const STATIC_FILE = /\/(|index\.html|sw\.js|manifest\.webmanifest|icon[-\w]*\.(svg|png)|assets\/[\w.-]+\.(js|css)|mediapipe\/wasm\/vision_wasm[\w]*\.(js|wasm)|models\/pose_landmarker_lite\.task)$/;

for (const locale of ['en-US', 'zh-CN'] as const) test.describe(`in ${locale}`, () => {
test.use({ locale });

test('camera session sends nothing off-device, even after MediaPipe telemetry interval', async ({ page, baseURL }) => {
  const reqs = recordRequests(page);
  await page.clock.install();
  await page.goto('./');
  const origin = new URL(page.url()).origin;

  await page.locator('#start').click();
  await expect(page.locator('#status')).toHaveAttribute('data-kind', 'live', { timeout: 60_000 });
  await expect(page.locator('#perf')).toHaveText(/^[1-9]\d* /, { timeout: 15_000 });
  expect(await page.evaluate(() => document.documentElement.lang)).toBe(locale);

  // MediaPipe's usage logger flushes every 60 s: jump past that, twice.
  await page.clock.fastForward(65_000);
  await page.clock.fastForward(65_000);
  await page.waitForTimeout(500);
  await page.locator('#start').click(); // Stop

  // 1. Every request went to the app's own origin, as a GET, without a body.
  for (const r of reqs) {
    expect(new URL(r.url).origin, r.url).toBe(origin);
    expect(r.method, r.url).toBe('GET');
    expect(r.hasBody, r.url).toBe(false);
  }
  // 2. ...and every one of them is a static app file (no API endpoints).
  const basePath = new URL(baseURL!).pathname.replace(/\/$/, '');
  for (const r of reqs) {
    const path = new URL(r.url).pathname.slice(basePath.length);
    expect(path, r.url).toMatch(STATIC_FILE);
  }
  // 3. MediaPipe's telemetry attempt was intercepted by the privacy guard.
  const blocked = await page.evaluate(
    () => (window as unknown as { __privacyGuard?: { blocked: { url: string }[] } }).__privacyGuard?.blocked ?? [],
  );
  expect(blocked.map((b) => new URL(b.url).hostname)).toContain('odml.pa.googleapis.com');
  // 4. The Content-Security-Policy restricts connections to the own origin.
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("connect-src 'self'");
});
});

test('no training data is stored in the browser', async ({ page }) => {
  await page.goto('./');
  await page.locator('#demo').click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { coachApp: { strokeCount: number } }).coachApp.strokeCount), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);
  await page.locator('#start').click();

  const stored = await page.evaluate(async () => {
    const local = Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]));
    const session = Object.keys(sessionStorage);
    const idb = 'databases' in indexedDB ? (await indexedDB.databases()).map((d) => d.name) : [];
    const cached: string[] = [];
    for (const name of await caches.keys()) {
      const c = await caches.open(name);
      for (const req of await c.keys()) cached.push(new URL(req.url).pathname);
    }
    return { local, session, idb, cached, cookies: document.cookie };
  });

  // localStorage: only the settings object (language, hand, net side, voice, fps, camera).
  expect(Object.keys(stored.local).every((k) => k === 'tennis-coach.settings.v1')).toBe(true);
  const allowed = ['cameraFacing', 'handedness', 'language', 'netDirection', 'targetPoseFps', 'voiceEnabled'];
  for (const v of Object.values(stored.local)) {
    for (const key of Object.keys(JSON.parse(v as string))) expect(allowed).toContain(key);
  }
  expect(stored.session).toEqual([]);
  expect(stored.idb).toEqual([]);
  expect(stored.cookies).toBe('');
  // Service worker cache (if active yet): static app files only.
  for (const p of stored.cached) expect(p, p).toMatch(STATIC_FILE);
});

test('network guard rejects external requests from any code on the page', async ({ page }) => {
  const reqs = recordRequests(page);
  await page.goto('./');
  const results = await page.evaluate(async () => {
    const out: Record<string, string> = {};
    try {
      await fetch('https://example.com/upload', { method: 'POST', body: 'frame' });
      out.fetch = 'sent';
    } catch {
      out.fetch = 'blocked';
    }
    try {
      const x = new XMLHttpRequest();
      x.open('POST', 'https://example.com/upload');
      x.send('frame');
      out.xhr = 'sent';
    } catch {
      out.xhr = 'blocked';
    }
    out.beacon = navigator.sendBeacon('https://example.com/beacon', 'frame') ? 'sent' : 'blocked';
    try {
      new WebSocket('wss://example.com/socket');
      out.ws = 'sent';
    } catch {
      out.ws = 'blocked';
    }
    return out;
  });
  expect(results).toEqual({ fetch: 'blocked', xhr: 'blocked', beacon: 'blocked', ws: 'blocked' });
  expect(reqs.filter((r) => new URL(r.url).hostname === 'example.com')).toEqual([]);
});
