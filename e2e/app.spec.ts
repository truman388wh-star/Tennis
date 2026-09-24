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
  await page.locator('#start').click();
  await expect(page.locator('#summary-content')).toContainText('No forehands were detected');
  expect(w.external, 'no CDN or remote requests').toEqual([]);
  expect(w.failed, 'no 404s for JS, WASM, model or other assets').toEqual([]);
  expect(w.errors.filter((e) => !/GPU|WebGL|gl_context|OpenGL/i.test(e))).toEqual([]);
});
