/* 迭代修复回归：建房防重复提交 / 商品负价与伪协议服务端校验 / 房间不存在兜底 / 嵌入失效提示 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

async function apiLogin(request: APIRequestContext) {
  const r = await request.post('/api/auth/login', { data: { username: 'admin', password: 'admin123456' } });
  return (await r.json()).data.token as string;
}

async function login(page: Page, userId: string, nickname: string, role: string) {
  const r = await page.request.post('/api/auth/dev-token', { data: { userId, nickname, roles: [role] } });
  const { data } = await r.json();
  const user = { userId, nickname, roles: [role] };
  await page.goto(BASE + '/');
  await page.evaluate(([t, u]) => { localStorage.setItem('live.token', t); localStorage.setItem('live.user', JSON.stringify(u)); }, [data.token, user]);
}

test('建房双击防重复提交：只创建一个房间', async ({ page }) => {
  const stamp = Date.now();
  await login(page, `gd-h-${stamp}`, '防抖主播', 'HOST');
  await page.goto(BASE + '/');
  await page.getByRole('button', { name: '创建房间' }).click();
  await page.waitForSelector('.dialog');
  await page.locator('.dialog .field input').fill(`防抖回归间-${stamp}`);
  await page.locator('.dialog').getByRole('button', { name: '创建', exact: true }).dblclick();
  await page.getByRole('button', { name: '进入直播间' }).click();
  await page.waitForSelector('.meeting', { timeout: 15000 });
  const rooms = await page.request.get('/api/rooms').then(r => r.json());
  const same = (rooms.data as Array<{ title: string }>).filter(r => r.title === `防抖回归间-${stamp}`);
  expect(same.length, '双击只应创建一个房间').toBe(1);
});

test('商品服务端校验：负价与 javascript: 伪协议被 400 拒绝', async ({ request }) => {
  const token = await apiLogin(request);
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const bad = await request.post('/api/products', { headers: H, data: { title: `负价-${Date.now()}`, price: -1 } });
  expect(bad.status()).toBe(400);
  const evil = await request.post('/api/products', { headers: H, data: { title: `伪协议-${Date.now()}`, price: 1, detailUrl: 'javascript:alert(1)' } });
  expect(evil.status()).toBe(400);
  const ok = await request.post('/api/products', { headers: H, data: { title: `正常-${Date.now()}`, price: 1, detailUrl: 'https://example.com/ok' } });
  expect(ok.status()).toBe(200);
});

test('不存在的房间显示兜底卡片而非永挂加载中', async ({ page }) => {
  await login(page, `gd-m-${Date.now()}`, '兜底观众', 'VIEWER');
  await page.goto(BASE + '/rooms/999999');
  await page.locator('.room-missing').waitFor({ timeout: 10000 });
  await expect(page.locator('.room-missing')).toContainText('房间不存在或已被删除');
});

test('嵌入模式 token 失效显示提示而非白屏', async ({ page }) => {
  await page.goto(`${BASE}/rooms/1?embed=1&token=INVALID.TOKEN.X`);
  await page.locator('.embed-denied').waitFor({ timeout: 10000 });
  await expect(page.locator('.embed-denied')).toContainText('登录态已失效');
});
