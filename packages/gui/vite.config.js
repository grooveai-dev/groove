import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3142,
    proxy: {
      '/api': 'http://localhost:31415',
      '/ws': {
        target: 'ws://localhost:31415',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
