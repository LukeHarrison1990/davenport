import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The renderer (the window's interface) is a plain React app bundled by Vite.
export default defineConfig({
  root: 'app/renderer',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'chrome140',
    sourcemap: false
  },
  server: { port: 5199, strictPort: true }
});
