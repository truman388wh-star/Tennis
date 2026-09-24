import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `--mode https` enables a self-signed HTTPS certificate so the dev/preview
// server can be opened from a phone on the same Wi-Fi network. Browsers only
// grant camera access on HTTPS origins (or localhost).
export default defineConfig(({ mode }) => ({
  // Relative base so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  plugins: mode === 'https' ? [basicSsl()] : [],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
}));
