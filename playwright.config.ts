import { defineConfig } from '@playwright/test';
// Chromium fakes a camera (a synthetic test pattern) so the full camera ->
// MediaPipe -> pipeline path can run headless without hardware.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  retries: 0,
  use: {
    // E2E_BASE_URL lets the same tests run against a sub-path build or the
    // deployed site. Must end with "/"; tests navigate to "./".
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4173/',
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
    permissions: ['camera'],
    // Default browser language for tests; i18n tests override it per test.
    locale: 'en-US',
    // Never record screenshots, videos or traces (privacy; nothing is uploaded
    // from CI either). The fake camera only shows Chromium's test pattern.
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
