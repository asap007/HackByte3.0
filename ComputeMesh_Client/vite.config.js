import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === 'development' ? '/' : './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true
  },
  server: {
    port: process.env.VITE_PORT || 5173
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
});