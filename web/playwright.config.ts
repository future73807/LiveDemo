import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests-e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    headless: true,
    // 拉流/推流需直连本机 SRS（localhost:1985/21985），绕过系统代理（如 Clash）
    launchOptions: { args: ['--no-proxy-server'] }
  }
});
