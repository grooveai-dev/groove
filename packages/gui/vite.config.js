import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  define: {
    __GROOVE_EDITION__: JSON.stringify(process.env.GROOVE_EDITION || 'community'),
  },
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
    rollupOptions: {
      output: {
        manualChunks: {
          'codemirror': ['@codemirror/view', '@codemirror/state', '@codemirror/commands', '@codemirror/language', '@codemirror/search', '@codemirror/autocomplete', '@codemirror/theme-one-dark'],
          'xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'],
          'reactflow': ['@xyflow/react'],
          'vendor': ['react', 'react-dom', 'zustand', 'framer-motion'],
        },
      },
    },
  },
});
