import { test, expect, type Page } from '@playwright/test';

/** UI 回归：主题日/夜切换、桌面直播间侧栏与播放器等高（B 站式）、移动端无横向滚动 */
async function login(page: Page, userId: string, role: 'VIEWER' | 'HOST') {
  const resp = await page.request.post('/api/auth/dev-token', {
    data: { userId, nickname: userId, roles: [role] }
  });
  const { data } = await resp.json();
  const user = { userId, nickname: userId, roles: [role] };
  await page.goto('/');
  await page.evaluate(t => localStorage.setItem('live.token', t), data.token);
  await page.evaluate(u => localStorage.setItem('live.user', JSON.stringify(u)), user);
  await page.reload();
  await expect(page.locator('.topbar').getByText(userId)).toBeVisible({ timeout: 15_000 });
}

test('主题切换与布局等高断言', async ({ page, request }) => {
  // 建房
  const hostToken = (await (async () => {
    const r = await request.post('/api/auth/dev-token', { data: { userId: 'ui-h', nickname: 'UI主播', roles: ['HOST'] } });
    return (await r.json()).data.token;
  })());
  const room = await (async () => {
    const r = await request.post('/api/rooms', { headers: { Authorization: `Bearer ${hostToken}` }, data: { title: `UI检查间-${Date.now()}` } });
    return (await r.json()).data;
  })();

  await login(page, `ui-viewer-${Date.now()}`, 'VIEWER');
  await page.goto('/');

  // 1) 主题：默认落到 dark 或 light，切换按钮存在且翻转 data-theme
  const initial = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(['dark', 'light']).toContain(initial);
  await page.locator('.topbar .theme-toggle').click();
  const toggled = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(toggled).not.toBe(initial);
  await page.locator('.topbar .theme-toggle').click();

  // 2) 桌面直播间：侧栏顶/底与播放器区域对齐（B 站式等高），页面单屏不滚动（无横向/纵向页面级滚动）
  await page.goto(`/rooms/${room.id}`);
  await expect(page.locator('.player-box')).toBeVisible({ timeout: 15_000 });
  const geom = await page.evaluate(() => {
    const stage = document.querySelector('.player-stage')!.getBoundingClientRect();
    const side = document.querySelector('.side-panel')!.getBoundingClientRect();
    return {
      stageTop: stage.top, stageBottom: stage.bottom,
      sideTop: side.top, sideBottom: side.bottom,
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      theme: document.documentElement.dataset.theme
    };
  });
  expect(Math.abs(geom.stageTop - geom.sideTop)).toBeLessThan(2);
  expect(Math.abs(geom.stageBottom - geom.sideBottom)).toBeLessThan(3);   // 16:9 小数像素舍入容差
  expect(geom.scrollW).toBeLessThanOrEqual(geom.innerW);
  expect(geom.scrollH, '桌面房间页必须单屏，无纵向滚动').toBeLessThanOrEqual(geom.innerH + 1);

  // 3) 移动端房间页：单屏无任何页面级滚动、播放器全宽、侧栏在下方
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(300);
  const mobile = await page.evaluate(() => {
    const stage = document.querySelector('.player-stage')!.getBoundingClientRect();
    const side = document.querySelector('.side-panel')!.getBoundingClientRect();
    return {
      stageW: stage.width, sideTop: side.top, stageBottom: stage.bottom,
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      innerW: window.innerWidth,
      innerH: window.innerHeight
    };
  });
  expect(mobile.scrollW).toBeLessThanOrEqual(375);
  expect(mobile.scrollH, '移动端房间页必须单屏，无纵向滚动').toBeLessThanOrEqual(mobile.innerH + 1);
  expect(mobile.stageW).toBeCloseTo(375, 0);
  expect(mobile.sideTop).toBeGreaterThanOrEqual(mobile.stageBottom - 1);
});