import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { buildMetadata } from './scripts/build-metadata.mjs';

export default defineConfig({
  plugins: [react()],
  define: { __BUILD_INFO__: JSON.stringify(buildMetadata()) },
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Test restore locks and live SQLite files are not interface sources.
    watch: { ignored: ['**/artifacts/**', '**/var/**'] },
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
