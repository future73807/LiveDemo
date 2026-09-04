import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/** dev-token 直签（API 层，不进 UI） */
async function devToken(request: APIRequestContext, userId: string, nickname: string, role: string): Promise<string> {
  const resp = await request.post('/api/auth/dev-token', { data: { userId, nickname, roles: [role] } });
  if (!resp.ok()) throw new Error(`dev-token 签发失败: ${resp.status()}`);
  const { data } = await resp.json();
  return data.token as string;
}

/** 与 smoke.spec.ts 相同的本地存储注入登录（用于移动视口房间页布局断言） */
async function login(page: Page, userId: string, nickname: string, role: 'VIEWER' | 'HOST') {
  const token = await devToken(page.request, userId, nickname, role);
  const user = { userId, nickname, roles: [role] };
  await page.goto('/');
  await page.evaluate(t => localStorage.setItem('live.token', t), token);
  await page.evaluate(u => localStorage.setItem('live.user', JSON.stringify(u)), user);
  await page.reload();
  await expect(page.locator('.topbar').getByText(new RegExp(nickname))).toBeVisible({ timeout: 15_000 });
}

test('移动视口 375×667：房间页无横向滚动且播放器可见', async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 667 });

  // API 直建一个房间作为进入目标
  const hostToken = await devToken(request, `e2e-mobile-host-${Date.now()}`, 'E2E移动主播', 'HOST');
  const resp = await request.post('/api/rooms', {
    headers: { Authorization: `Bearer ${hostToken}` },
    data: { title: `E2E 移动间-${Date.now()}` }
  });
  if (!resp.ok()) throw new Error(`建房失败: ${resp.status()}`);
  const roomId = ((await resp.json()) as { data: { id: number } }).data.id;

  await login(page, `e2e-mobile-viewer-${Date.now()}`, 'E2E移动观众', 'VIEWER');
  await page.goto(`/rooms/${roomId}`);
  await expect(page.locator('.player-box')).toBeVisible({ timeout: 15_000 });

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, '375 视口下不得出现横向滚动').toBeLessThanOrEqual(375);
});

test('嵌入模式：URL token 免登录 + postMessage ready/room-status 双通道', async ({ page, request }) => {
  test.setTimeout(120_000);
  const ts = Date.now();
  const hostToken = await devToken(request, `e2e-embed-host-${ts}`, 'E2E嵌入主播', 'HOST');
  const resp = await request.post('/api/rooms', {
    headers: { Authorization: `Bearer ${hostToken}` },
    data: { title: `E2E 嵌入间-${ts}` }
  });
  if (!resp.ok()) throw new Error(`建房失败: ${resp.status()}`);
  const roomId = ((await resp.json()) as { data: { id: number } }).data.id;

  // 1) 直连：token+embed 注入后顶栏/登录弹窗隐藏，房间列表正常可见
  await page.goto(`/?token=${hostToken}&embed=1`);
  await expect(page.locator('.topbar')).toHaveCount(0);
  await expect(page.locator('.dialog-mask')).toHaveCount(0);
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 15_000 });

  // 2) 宿主页 iframe 嵌入房间页：先在宿主页挂 message 监听（写入 title），再等两个通道事件
  await page.route('**/embed-host.html', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><title>embed-host</title></head><body>
<script>
  window.__events = [];
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type) {
      window.__events.push(e.data.type + (e.data.status ? ':' + e.data.status : ''));
      document.title = window.__events.join(',');
    }
  });
</script>
<iframe src="http://localhost:3000/rooms/${roomId}?token=${hostToken}&embed=1" style="width:1100px;height:700px"></iframe>
</body></html>`
  }));
  await page.goto('/embed-host.html');
  await expect.poll(() => page.title(), { timeout: 30_000 }).toContain('livedemo-ready');
  await expect.poll(() => page.title(), { timeout: 30_000 }).toContain('livedemo-room-status');
});
