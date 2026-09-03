import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, userId: string, nickname: string, role: 'VIEWER' | 'HOST' | 'ADMIN') {
  await page.goto('/');
  await page.getByPlaceholder('如 host1 / v1').fill(userId);
  await page.getByPlaceholder('直播间展示名').fill(nickname);
  await page.locator('select').selectOption(role);
  await page.getByRole('button', { name: '进入' }).click();
  // 断言限定顶栏：首页房间卡片会显示历史房间的主播昵称，全局 getByText 会撞 strict mode
  await expect(page.locator('.topbar').getByText(new RegExp(nickname))).toBeVisible();
}

test('登录-建房-双端弹幕闭环', async ({ browser }) => {
  const hostPage = await browser.newContext().then(c => c.newPage());
  const viewerPage = await browser.newContext().then(c => c.newPage());
  // H2 数据卷持久化：历史运行会累积同名房间，标题带时间戳保证观众点进的一定是本次房间
  const roomTitle = `E2E 冒烟间-${Date.now()}`;

  // 主播：登录并建房（实际 UI 中「房间标题」是 label 而非 placeholder，按 field 定位输入框）
  await login(hostPage, 'e2e-host', 'E2E主播', 'HOST');
  await hostPage.getByRole('button', { name: '创建房间' }).click();
  await hostPage.locator('.dialog .field', { hasText: '房间标题' }).locator('input').fill(roomTitle);
  await hostPage.getByRole('button', { name: '创建', exact: true }).click();
  await hostPage.getByRole('button', { name: '进入直播间' }).click();
  await expect(hostPage.locator('.player-box')).toBeVisible();

  // 观众：从首页点进同一房间
  await login(viewerPage, 'e2e-viewer', 'E2E观众', 'VIEWER');
  await viewerPage.locator('.card', { hasText: roomTitle }).first().click();
  // 在线人数：WS presence 随进出变化的轻量断言
  await expect(viewerPage.getByText(/\d+ 人在线/)).toBeVisible();

  // 观众发弹幕 → 双端可见（弹幕链路与推流解耦）
  const text = `hello-${Date.now()}`;
  await viewerPage.getByPlaceholder('发个弹幕…').fill(text);
  await viewerPage.getByRole('button', { name: '发送' }).click();
  await expect(hostPage.locator('.chat-item', { hasText: text })).toBeVisible({ timeout: 10_000 });
  await expect(viewerPage.locator('.chat-item', { hasText: text })).toBeVisible();
});

test('管理员后台可见强制关播按钮', async ({ page }) => {
  await login(page, 'e2e-admin', 'E2E管理员', 'ADMIN');
  await page.getByRole('link', { name: '管理后台' }).click();
  await expect(page.getByRole('button', { name: '强制关播' }).first()).toBeVisible();
});
