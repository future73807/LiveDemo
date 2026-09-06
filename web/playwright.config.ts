import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests-e2e',
  timeout: 30_000,
  retries: 0,
  // 串行执行：三源开播用例依赖实时音频（RMS/画布断言），并行浏览器会互相抢 CPU 导致抖动
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    headless: true,
    ignoreHTTPSErrors: true,   // 允许对自签 HTTPS 栈跑回归
    // 拉流/推流需直连本机 SRS（localhost:1985/21985），绕过系统代理（如 Clash）
    launchOptions: { args: ['--no-proxy-server'] }
  }
});
