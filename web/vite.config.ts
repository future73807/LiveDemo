/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // vitest 只跑 src 单测，避免误收集 Playwright 用例（tests-e2e/）
    include: ['src/**/*.{test,spec}.{ts,tsx}']
  },
  server: {
    port: 3000,
    proxy: {
      '/api': { target: 'http://localhost:8081', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8081', ws: true }
    }
  }
});
