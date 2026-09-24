import './ui/styles.css';
import { installNetworkGuard } from './privacy/networkGuard';
import { CoachApp } from './app/CoachApp';
import { loadSettings } from './config/settings';
import { browserLanguages, I18n, resolveLanguage } from './i18n';

// Must run before the pose model is created: blocks every request to other
// origins (e.g. MediaPipe's usage logging). Camera data never leaves the device.
// Skipped in the Vite dev server, whose hot-reload client uses a WebSocket.
if (import.meta.env.PROD) installNetworkGuard();

const settings = loadSettings();
// Saved choice wins; otherwise the device/browser language (zh* -> zh-CN, else en-US).
const i18n = new I18n(resolveLanguage(settings.language, browserLanguages()));
const app = new CoachApp(settings, i18n);
// Exposed for automated browser tests and debugging from the console.
(window as unknown as { coachApp: CoachApp }).coachApp = app;

// Offline support: cache the app shell, WASM runtime and model after the
// first visit so the app works at courts with poor reception.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker registration failed', err));
  });
}
