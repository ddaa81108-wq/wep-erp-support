import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4310',
        changeOrigin: true,
        // The preview is a separate local origin; keep the API's same-origin
        // protection intact while proxying the preview requests locally.
        headers: { origin: 'http://127.0.0.1:4310' },
      },
    },
  },
});
