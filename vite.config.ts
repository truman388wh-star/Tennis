import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Content-Security-Policy for production builds. The browser enforces it for
// all code, including third-party libraries: the page may only connect to its
// own origin (connect-src 'self'), so no camera frame, pose data, telemetry or
// analytics can be sent anywhere. 'wasm-unsafe-eval' is required to run the
// MediaPipe WebAssembly; 'unsafe-inline' styles are used for score bar widths.
// Not applied to the dev server, whose hot-reload client needs a WebSocket.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
      );
    },
  };
}

// `--mode https` enables a self-signed HTTPS certificate so the dev/preview
// server can be opened from a phone on the same Wi-Fi network. Browsers only
// grant camera access on HTTPS origins (or localhost).
export default defineConfig(({ mode }) => ({
  // BASE_PATH is set by the GitHub Pages workflow (e.g. "/Tennis/") so asset,
  // WASM and model URLs are absolute under the repository sub-path. Locally
  // the relative base works from any directory.
  base: process.env.BASE_PATH || './',
  plugins: [contentSecurityPolicy(), ...(mode === 'https' ? [basicSsl()] : [])],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
}));
