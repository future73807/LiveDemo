import { test, expect, type Page } from '@playwright/test';

// 假摄像头/假麦克风：无 OBS 的浏览器开播闭环（WHIP 推流走 SRS 原生 /rtc/v1/whip/）
// channel=chrome：Playwright 自带 Chromium 无 H264 解码器，观众端无法出画
test.use({
  channel: 'chrome',
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-proxy-server'] }
});

/** 与 smoke.spec.ts 相同的登录方式：dev-token 直签后注入本地存储 */
async function login(page: Page, userId: string, nickname: string, role: 'VIEWER' | 'HOST' | 'ADMIN') {
  const resp = await page.request.post('/api/auth/dev-token', {
    data: { userId, nickname, roles: [role] }
  });
  if (!resp.ok()) throw new Error(`dev-token 签发失败: ${resp.status()}`);
  const { data } = await resp.json();
  const user = { userId, nickname, roles: [role] };
  await page.goto('/');
  await page.evaluate(token => localStorage.setItem('live.token', token), data.token);
  await page.evaluate(u => localStorage.setItem('live.user', JSON.stringify(u)), user);
  await page.reload();
  // 断言限定顶栏，避免撞首页卡片里的主播昵称；15s 宽限 JVM 冷启动
  await expect(page.locator('.topbar').getByText(new RegExp(nickname))).toBeVisible({ timeout: 15_000 });
}

/** HOST 从首页建房并进入直播间 */
async function createAndEnter(page: Page, title: string) {
  await page.getByRole('button', { name: '创建房间' }).click();
  await page.locator('.dialog .field', { hasText: '房间标题' }).locator('input').fill(title);
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await page.getByRole('button', { name: '进入直播间' }).click();
}

test('假摄像头开播闭环：摄像头开播-WHIP推流-观众出画-弹幕-结束直播', async ({ browser }) => {
  test.setTimeout(240_000);
  const ts = Date.now();
  const hostCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const viewerCtx = await browser.newContext();
  const hostPage = await hostCtx.newPage();
  const viewerPage = await viewerCtx.newPage();
  const title = `E2E 开播间-${ts}`;

  try {
    // ── HOST：建房进房，会议式开播台就位 ──
    await login(hostPage, `e2e-studio-host-${ts}`, 'E2E开播主播', 'HOST');
    await createAndEnter(hostPage, title);
    await expect(hostPage.locator('.meeting')).toBeVisible({ timeout: 15_000 });

    // ── 点「摄像头」直接开播（无独立预览/推流码步骤）：本地预览出画 ──
    await hostPage.locator('.meeting-toolbar').getByRole('button', { name: '摄像头' }).click();
    await hostPage.waitForFunction(() => {
      const v = document.querySelector('.meeting video') as HTMLVideoElement | null;
      return !!v && v.srcObject !== null && v.videoWidth > 0;
    }, null, { timeout: 15_000, polling: 500 });
    await expect(hostPage.locator('.meeting .player-placeholder')).toHaveCount(0);

    // ── WHIP 发布 → SRS on_publish → 房间转「直播中」 ──
    await expect(hostPage.locator('.badge', { hasText: '直播中' }).first()).toBeVisible({ timeout: 20_000 });

    // ── VIEWER：进房 WebRTC 出画 ──
    await login(viewerPage, `e2e-studio-viewer-${ts}`, 'E2E开播观众', 'VIEWER');
    await viewerPage.locator('.card', { hasText: title }).first().click();
    await expect(viewerPage.getByText(/\d+ 人在线/)).toBeVisible({ timeout: 20_000 });
    await viewerPage.waitForFunction(() => {
      const v = document.querySelector('.player-box video') as HTMLVideoElement | null;
      return !!v && v.srcObject !== null && v.videoWidth > 0;
    }, null, { timeout: 30_000, polling: 500 });

    // ── 弹幕互见 ──
    const text = `开播弹幕-${ts}`;
    await viewerPage.getByPlaceholder('发个弹幕…').fill(text);
    await viewerPage.getByRole('button', { name: '发送' }).click();
    await expect(hostPage.locator('.chat-item', { hasText: text })).toBeVisible({ timeout: 10_000 });
    await expect(viewerPage.locator('.chat-item', { hasText: text })).toBeVisible();

    // ── 结束直播：WHIP 删除 + 房间结束 → 观众回「主播还未开播」占位 ──
    await hostPage.locator('.meeting-toolbar').getByRole('button', { name: '结束直播' }).click();
    await expect(viewerPage.getByText('主播还未开播')).toBeVisible({ timeout: 40_000 });
  } finally {
    await hostCtx.close();
    await viewerCtx.close();
  }
});
