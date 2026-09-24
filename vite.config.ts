import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `--mode https` enables a self-signed HTTPS certificate so the dev/preview
// server can be opened from a phone on the same Wi-Fi network. Browsers only
// grant camera access on HTTPS origins (or localhost).
export default defineConfig(({ mode }) => ({
  // BASE_PATH is set by the GitHub Pages workflow (e.g. "/Tennis/") so asset,
  // WASM and model URLs are absolute under the repository sub-path. Locally
  // the relative base works from any directory.
  base: process.env.BASE_PATH || './',
  plugins: mode === 'https' ? [basicSsl()] : [],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
}));
