import { test, expect, type Page } from '@playwright/test';

const ts = Date.now();

/** internal 模式：走「注册」Tab 创建真实账号，注册成功即登录 */
async function register(page: Page, username: string, password: string, nickname: string, role: 'VIEWER' | 'HOST') {
  await page.goto('/');
  await page.locator('.tabs button', { hasText: '注册' }).click();
  await page.getByPlaceholder('4-32 位字母数字下划线').fill(username);
  await page.getByPlaceholder('至少 6 位').fill(password);
  await page.getByPlaceholder('直播间展示名').fill(nickname);
  await page.locator('.dialog select').selectOption(role);
  await page.getByRole('button', { name: '注册并进入' }).click();
  // 顶栏显示昵称 = 注册成功即登录（断言限定顶栏，避免撞首页卡片里的主播昵称）
  await expect(page.locator('.topbar').getByText(new RegExp(nickname))).toBeVisible({ timeout: 15_000 });
}

test('注册 HOST → 建房 → 房间卡片出现', async ({ page }) => {
  await register(page, `e2e_h_${ts}`, 'pass123456', 'E2E账号主播', 'HOST');

  const title = `E2E 账号间-${ts}`;
  await page.getByRole('button', { name: '创建房间' }).click();
  await page.locator('.dialog .field', { hasText: '房间标题' }).locator('input').fill(title);
  await page.getByRole('button', { name: '创建', exact: true }).click();
  // 创建成功弹窗给出推流码，且首页列表出现本次房间卡片
  await expect(page.locator('.dialog .field', { hasText: '推流码' }).locator('input')).toHaveValue(/room-/);
  await expect(page.locator('.card', { hasText: title }).first()).toBeVisible({ timeout: 10_000 });
});

test('注册 VIEWER → 登录 Tab 密码登录 → 进最近房间发弹幕自见回显', async ({ page }) => {
  const nickname = 'E2E账号观众';
  await register(page, `e2e_v_${ts}`, 'pass123456', nickname, 'VIEWER');

  // 登出后用「登录」Tab 走密码登录，覆盖登录 Tab 链路
  await page.getByRole('button', { name: '退出' }).click();
  await page.getByPlaceholder('用户名').fill(`e2e_v_${ts}`);
  await page.getByPlaceholder('密码').fill('pass123456');
  await page.getByRole('button', { name: '进入' }).click();
  await expect(page.locator('.topbar').getByText(new RegExp(nickname))).toBeVisible({ timeout: 15_000 });

  // 进最近创建的房间（首页第一张卡片），发弹幕并等待自己的消息回显
  await page.locator('.card').first().click();
  await expect(page.getByText(/\d+ 人在线/)).toBeVisible({ timeout: 15_000 });
  const text = `账号弹幕-${ts}`;
  await page.getByPlaceholder('发个弹幕…').fill(text);
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.locator('.chat-item', { hasText: text })).toBeVisible({ timeout: 10_000 });
});
