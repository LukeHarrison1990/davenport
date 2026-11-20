import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The renderer (the window's interface) is a plain React app bundled by Vite.
export default defineConfig({
  root: 'app/renderer',
  base: './',
  plugins: [
    react(),
    {
      // The development server's address is only needed while developing; production builds don't allow it.
      name: 'davenport-production-csp',
      apply: 'build',
      transformIndexHtml: (html) => html.replace(/ ws:\/\/localhost:5199 http:\/\/localhost:5199/, '')
    }
  ],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'chrome140',
    sourcemap: false
  },
  server: { port: 5199, strictPort: true }
});
