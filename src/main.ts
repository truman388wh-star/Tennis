import './ui/styles.css';
import { installNetworkGuard } from './privacy/networkGuard';
import { CoachApp } from './app/CoachApp';
import { loadSettings } from './config/settings';

// Must run before the pose model is created: blocks every request to other
// origins (e.g. MediaPipe's usage logging). Camera data never leaves the device.
// Skipped in the Vite dev server, whose hot-reload client uses a WebSocket.
if (import.meta.env.PROD) installNetworkGuard();

const app = new CoachApp(loadSettings());
// Exposed for automated browser tests and debugging from the console.
(window as unknown as { coachApp: CoachApp }).coachApp = app;

// Offline support: cache the app shell, WASM runtime and model after the
// first visit so the app works at courts with poor reception.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker registration failed', err));
  });
}
