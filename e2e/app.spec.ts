import { expect, test, type Page } from '@playwright/test';

/** Records console errors and any request that leaves localhost. */
function watch(page: Page) {
  const errors: string[] = [];
  const external: string[] = [];
  const failed: string[] = [];
  page.on('response', (res) => {
    if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    const url = new URL(r.url());
    const own = new URL(page.url() === 'about:blank' ? r.url() : page.url()).hostname;
    if (url.protocol.startsWith('http') && url.hostname !== own && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      external.push(r.url());
    }
  });
  return { errors, external, failed };
}

test('loads the start screen without errors', async ({ page }) => {
  const w = watch(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'AI Tennis Coach' })).toBeVisible();
  await expect(page.locator('#start')).toHaveText('Start');
  await expect(page.locator('#subscores .sub')).toHaveCount(7);
  expect(w.errors).toEqual([]);
  expect(w.failed).toEqual([]);
});

test('demo mode detects strokes, shows feedback and a session summary', async ({ page }) => {
  const w = watch(page);
  await page.goto('./');
  await page.locator('#demo').click();
  await expect(page.locator('#status')).toHaveText('Demo');

  // Demo strokes are ~3.2 s apart; wait for three analyzed strokes.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { coachApp: { strokeCount: number } }).coachApp.strokeCount), {
      timeout: 20_000,
    })
    .toBeGreaterThanOrEqual(3);

  await expect(page.locator('#feedback')).toBeVisible();
  await expect(page.locator('#feedback-text')).not.toBeEmpty();
  await expect(page.locator('#score-value')).toHaveText(/^\d+$/);
  expect(await page.locator('#history .chip').count()).toBeGreaterThanOrEqual(3);
  // First demo stroke is a late contact.
  await expect(page.locator('#history .chip').last()).toHaveAttribute('title', /late/i);

  await page.locator('#start').click(); // Stop
  await expect(page.locator('#summary')).toBeVisible();
  await expect(page.locator('#summary-content')).toContainText('Forehands detected');
  await expect(page.locator('#summary-content')).toContainText('Most frequent issue');
  expect(w.errors).toEqual([]);
  expect(w.external).toEqual([]);
  expect(w.failed).toEqual([]);
});

test('camera mode loads MediaPipe from local assets and runs pose inference', async ({ page }) => {
  const w = watch(page);
  await page.goto('./');
  await page.locator('#start').click();
  await expect(page.locator('#status')).toHaveText('Live', { timeout: 60_000 });
  await expect(page.locator('#start')).toHaveText('Stop');
  // Inference loop is running (fps counter > 0). The fake camera shows no
  // person, so "No player detected" is the expected phase.
  await expect(page.locator('#perf')).toHaveText(/^[1-9]\d* fps/, { timeout: 15_000 });
  await expect(page.locator('#phase')).toHaveText('No player detected');
  // Live camera fills the stage; Chromium's fake camera has no zoom, so no zoom UI.
  await expect(page.locator('#stage')).toHaveClass(/\bcover\b/);
  await expect(page.locator('#video')).toHaveCSS('object-fit', 'cover');
  await expect(page.locator('#zoom')).toBeHidden();
  await page.locator('#start').click();
  await expect(page.locator('#summary-content')).toContainText('No forehands were detected');
  await expect(page.locator('#stage')).not.toHaveClass(/\bcover\b/);
  expect(w.external, 'no CDN or remote requests').toEqual([]);
  expect(w.failed, 'no 404s for JS, WASM, model or other assets').toEqual([]);
  expect(w.errors.filter((e) => !/GPU|WebGL|gl_context|OpenGL/i.test(e))).toEqual([]);
});

test('camera zoom: prefers the main rear lens, starts at 1x and applies real zoom', async ({ page }) => {
  // Simulate a phone with an ultra-wide and a main rear camera and a zoomable
  // track (Chromium's fake camera has neither).
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    const realGUM = md.getUserMedia.bind(md);
    const realEnum = md.enumerateDevices.bind(md);
    const calls: unknown[] = [];
    (window as unknown as { gumCalls: unknown[] }).gumCalls = calls;
    md.getUserMedia = (c) => {
      calls.push(c);
      return realGUM(c);
    };
    md.enumerateDevices = async () => {
      const real = (await realEnum()).filter((d) => d.kind === 'videoinput');
      const id = real[0]?.deviceId ?? 'fake';
      const fake = (deviceId: string, label: string) => ({ deviceId, label, kind: 'videoinput', groupId: 'g', toJSON() {} }) as MediaDeviceInfo;
      // The browser's default pick (the only real fake device) plays the ultra-wide.
      return [fake(id, 'camera2 2, facing back'), fake('main-id', 'camera2 0, facing back')];
    };
    let zoom = 0.5;
    const proto = MediaStreamTrack.prototype;
    const caps = proto.getCapabilities;
    const settings = proto.getSettings;
    const apply = proto.applyConstraints;
    proto.getCapabilities = function () {
      return { ...caps.call(this), zoom: { min: 0.5, max: 8, step: 0.1 } } as MediaTrackCapabilities;
    };
    proto.getSettings = function () {
      return { ...settings.call(this), zoom } as MediaTrackSettings;
    };
    proto.applyConstraints = function (c?: MediaTrackConstraints) {
      const z = (c?.advanced?.[0] as { zoom?: number } | undefined)?.zoom;
      if (typeof z === 'number') {
        zoom = z;
        return Promise.resolve();
      }
      return apply.call(this, c);
    };
  });
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto('./');
  await page.locator('#start').click();
  await expect(page.locator('#status')).toHaveText('Live', { timeout: 60_000 });

  const zoom = page.locator('#zoom');
  await expect(zoom).toBeVisible();
  await expect(zoom.locator('button')).toHaveText(['0.5×', '1×', '2×']);
  // Default is 1x, not the ultra-wide 0.5x.
  await expect(zoom.locator('button[aria-pressed="true"]')).toHaveText('1×');
  await zoom.locator('button', { hasText: '2×' }).click();
  await expect(zoom.locator('button[aria-pressed="true"]')).toHaveText('2×');
  await expect(page.locator('#perf')).toHaveText(/^[1-9]\d* fps/, { timeout: 15_000 });

  // The app re-opened the camera on the main rear lens (camera2 0) by deviceId.
  const calls = await page.evaluate(() => JSON.stringify((window as unknown as { gumCalls: unknown[] }).gumCalls));
  expect(calls).toContain('main-id');
  expect(logs.some((l) => l.includes('[camera] browser chose'))).toBe(true);
  expect(logs.some((l) => l.includes('[camera] active track'))).toBe(true);
  await page.locator('#start').click();
  await expect(zoom).toBeHidden();
});
