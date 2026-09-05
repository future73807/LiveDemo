/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API 目标可经环境变量覆盖：本机 8081 撞 Hyper-V 动态保留区段时改用其他端口
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:8081';

export default defineConfig({
  plugins: [react()],
  test: {
    // vitest 只跑 src 单测，避免误收集 Playwright 用例（tests-e2e/）
    include: ['src/**/*.{test,spec}.{ts,tsx}']
  },
  server: {
    port: 3000,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/ws': { target: apiTarget.replace(/^http/, 'ws'), ws: true }
    }
  }
});
