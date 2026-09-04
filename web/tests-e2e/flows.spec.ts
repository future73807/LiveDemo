import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';

/** API 直签 dev-token（平台商品库建品等后端调用用） */
async function apiToken(request: APIRequestContext, userId: string, role: 'ADMIN' | 'HOST'): Promise<string> {
  const resp = await request.post('/api/auth/dev-token', { data: { userId, nickname: userId, roles: [role] } });
  if (!resp.ok()) throw new Error(`dev-token 签发失败: ${resp.status()}`);
  const { data } = await resp.json();
  return data.token as string;
}

/** 与 smoke.spec.ts 相同的登录方式：dev-token 直签后注入本地存储（internal 模式 UI 由 account.spec 覆盖） */
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
  // 断言限定顶栏：首页房间卡片会显示历史房间的主播昵称，全局 getByText 会撞 strict mode。
  // 宽限 15s：容器刚重启时 JVM 冷启动会让首个请求变慢
  await expect(page.locator('.topbar').getByText(new RegExp(nickname))).toBeVisible({ timeout: 15_000 });
}

/** 起真实推流容器（SRS 收到流后回调 on_publish → 房间转直播中） */
function startPush(container: string, streamKey: string) {
  try { execSync(`docker rm -f ${container}`, { stdio: 'pipe' }); } catch { /* 无残留 */ }
  execSync(
    `docker run -d --name ${container} --network livedemo_default jrottenberg/ffmpeg:6-alpine ` +
    '-re -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=1000 ' +
    '-c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p -c:a aac ' +
    `-f flv rtmp://srs:1935/live/${streamKey}`,
    { stdio: 'pipe', timeout: 120_000 });
}

function stopPush(container: string) {
  try { execSync(`docker rm -f ${container}`, { stdio: 'pipe' }); } catch { /* 容器不存在 */ }
}

/** 直接调用 SRS on_publish 回调标记开播（与真实推流走同一后端路径 markLiving） */
async function srsPublish(streamKey: string) {
  const resp = await fetch('http://localhost:8081/api/v1/srs/hooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'on_publish', stream: streamKey })
  });
  if (!resp.ok) throw new Error(`SRS hook 调用失败: ${resp.status}`);
}

/** HOST 从首页建房并进入直播间；推流码 UI 不再展示，改从创建房间 API 响应读取 */
async function createRoom(page: Page): Promise<{ title: string; streamKey: string }> {
  const title = `E2E 交互间-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  await page.getByRole('button', { name: '创建房间' }).click();
  await page.locator('.dialog .field', { hasText: '房间标题' }).locator('input').fill(title);
  const createResp = await page.waitForResponse(r => r.url().includes('/api/rooms') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  const streamKey = (await createResp.json()).data.streamKey;
  if (!streamKey) throw new Error('创建房间 API 未返回推流码');
  await page.getByRole('button', { name: '进入直播间' }).click();
  await expect(page.locator('.studio')).toBeVisible({ timeout: 15_000 });
  return { title, streamKey };
}

test('完整直播闭环：推流-出画-弹幕-商品-购物车-禁言-删除-结束', async ({ browser }) => {
  test.setTimeout(300_000);
  const ts = Date.now();
  const hostCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const hostPage = await hostCtx.newPage();
  const viewerPage = await viewerCtx.newPage();
  // H2 数据卷持久化会累积历史房间/商品/购物车：userId、标题、商品名全部带时间戳隔离
  const productName = `商品E2E-${ts}`;
  const textA = `观众第一条-${ts}`;
  const textB = `删除我-${ts}`;
  const textC = `删除后再发-${ts}`;
  const textD = `禁言后发送-${ts}`;
  const container = 'push-e2e-flow1';

  try {
    // ── HOST 建房并起推流 ──
    await login(hostPage, `e2e-flow-host-${ts}`, 'E2E主播甲', 'HOST');
    const { title, streamKey } = await createRoom(hostPage);   // createRoom 内已进入直播间
    await expect(hostPage.locator('.player-box')).toBeVisible();
    startPush(container, streamKey);
    await expect(hostPage.locator('.badge', { hasText: '直播中' })).toBeVisible({ timeout: 30_000 });

    // ── VIEWER 进房，WebRTC 出画 ──
    await login(viewerPage, `e2e-flow-viewer-${ts}`, 'E2E观众甲', 'VIEWER');
    await viewerPage.locator('.card', { hasText: title }).first().click();
    await expect(viewerPage.getByText(/\d+ 人在线/)).toBeVisible();
    await viewerPage.waitForFunction(() => {
      const v = document.querySelector('.player-box video') as HTMLVideoElement | null;
      return !!v && v.srcObject !== null && v.videoWidth > 0;
    }, null, { timeout: 20_000, polling: 500 });

    // ── 弹幕：双端可见 + host 端弹幕层渲染 ──
    await viewerPage.getByPlaceholder('发个弹幕…').fill(textA);
    await viewerPage.getByRole('button', { name: '发送' }).click();
    await expect(hostPage.locator('.chat-item', { hasText: textA })).toBeVisible({ timeout: 10_000 });
    await expect(viewerPage.locator('.chat-item', { hasText: textA })).toBeVisible();
    await expect(hostPage.locator('.danmaku-item', { hasText: textA })).toBeVisible({ timeout: 10_000 });

    // ── 商品：管理员平台库建品 → 主播选品挂载 → 观众端 product_update 实时可见 ──
    // （M9 起商品收归平台库：POST /api/products 仅 ADMIN，主播端改为选品挂载面板）
    const adminToken = await apiToken(hostPage.request, `e2e-flow-admin-${ts}`, 'ADMIN');
    const createResp = await hostPage.request.post('/api/products', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { title: productName, price: 9.9 }
    });
    if (!createResp.ok()) throw new Error(`平台建品失败: ${createResp.status()}`);
    await hostPage.getByPlaceholder('搜索商品').fill(productName);
    await hostPage.locator('.row', { hasText: productName })
      .getByRole('button', { name: '挂载', exact: true }).first().click();
    await viewerPage.getByRole('button', { name: /商品/ }).click();
    await expect(viewerPage.locator('.card', { hasText: productName })).toBeVisible({ timeout: 10_000 });

    // ── 购物车：加购 → 角标 → 抽屉 → 改数量 → 移除 ──
    await viewerPage.getByRole('button', { name: '加购' }).click();
    const cartBtn = viewerPage.getByRole('button', { name: /购物车/ });
    await expect(cartBtn).toHaveText(/购物车\(1\)/);
    await cartBtn.click();
    const entry = viewerPage.locator('.drawer .card', { hasText: productName });
    await expect(entry).toBeVisible();
    await entry.getByRole('button', { name: '+' }).click();
    await expect(cartBtn).toHaveText(/购物车\(2\)/);
    await entry.getByRole('button', { name: '移除' }).click();
    await expect(viewerPage.locator('.drawer')).toContainText('购物车是空的');
    await expect(cartBtn).not.toHaveText(/\(\d+\)/);
    // 抽屉带全屏遮罩，必须先关闭才能继续操作页面其余部分
    await viewerPage.getByRole('button', { name: '关闭' }).click();

    // 回到聊天 Tab
    await viewerPage.getByRole('button', { name: '聊天' }).click();

    // ── 删除弹幕：双端同时消失；删除后新弹幕仍要正常渲染（消息数组收缩回归点）──
    await viewerPage.getByPlaceholder('发个弹幕…').fill(textB);
    await viewerPage.getByRole('button', { name: '发送' }).click();
    const itemB = hostPage.locator('.chat-item', { hasText: textB });
    await expect(itemB).toBeVisible({ timeout: 10_000 });
    await itemB.getByRole('button', { name: '删除' }).click();
    await expect(hostPage.locator('.chat-item', { hasText: textB })).toHaveCount(0, { timeout: 10_000 });
    await expect(viewerPage.locator('.chat-item', { hasText: textB })).toHaveCount(0);
    await viewerPage.getByPlaceholder('发个弹幕…').fill(textC);
    await viewerPage.getByRole('button', { name: '发送' }).click();
    await expect(hostPage.locator('.chat-item', { hasText: textC })).toBeVisible({ timeout: 10_000 });
    await expect(hostPage.locator('.danmaku-item', { hasText: textC })).toBeVisible({ timeout: 10_000 });

    // ── 禁言：定向 muted 通知 + 发送被 E_MUTED 拒绝 ──
    await hostPage.locator('.chat-item', { hasText: textA }).getByRole('button', { name: '禁言' }).click();
    await expect(viewerPage.getByText('已被禁言 600 秒')).toBeVisible({ timeout: 10_000 });
    await viewerPage.getByPlaceholder('发个弹幕…').fill(textD);
    await viewerPage.getByRole('button', { name: '发送' }).click();
    await expect(viewerPage.getByText('E_MUTED')).toBeVisible({ timeout: 10_000 });
    await expect(hostPage.locator('.chat-item', { hasText: textD })).toHaveCount(0);

    // ── 结束直播：主播跳首页，观众端出现未开播占位 ──
    await hostPage.getByRole('button', { name: '结束直播' }).click();
    await expect(hostPage.getByRole('heading', { name: '直播间' })).toBeVisible({ timeout: 10_000 });
    await expect(viewerPage.getByText('主播还未开播')).toBeVisible({ timeout: 10_000 });
  } finally {
    stopPush(container);
    await hostCtx.close();
    await viewerCtx.close();
  }
});

test('断线恢复：观众网络闪断后 WS 重连并可继续发言', async ({ browser }) => {
  test.setTimeout(240_000);
  const ts = Date.now();
  const hostCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const hostPage = await hostCtx.newPage();
  const viewerPage = await viewerCtx.newPage();
  const msg1 = `断线前-${ts}`;
  const msg2 = `断线后-${ts}`;

  try {
    await login(hostPage, `e2e-reconnect-host-${ts}`, 'E2E主播乙', 'HOST');
    const { title } = await createRoom(hostPage);
    await hostPage.getByRole('button', { name: '进入直播间' }).click();
    await expect(hostPage.locator('.player-box')).toBeVisible();

    await login(viewerPage, `e2e-reconnect-viewer-${ts}`, 'E2E观众乙', 'VIEWER');
    await viewerPage.locator('.card', { hasText: title }).first().click();
    await expect(viewerPage.getByText(/\d+ 人在线/)).toBeVisible();

    // 断线前链路确认
    await viewerPage.getByPlaceholder('发个弹幕…').fill(msg1);
    await viewerPage.getByRole('button', { name: '发送' }).click();
    await expect(hostPage.locator('.chat-item', { hasText: msg1 })).toBeVisible({ timeout: 10_000 });

    // 断网 6 秒 → 恢复网络
    await viewerPage.context().setOffline(true);
    await viewerPage.waitForTimeout(6_000);
    await viewerPage.context().setOffline(false);

    // 在线状态恢复（重连后服务端补发 presence）
    await expect(viewerPage.getByText(/\d+ 人在线/)).toBeVisible({ timeout: 60_000 });

    // 60 秒内重试发送，直到主播可见（WS 重连成功的证明；未就绪时 sendChat 静默丢弃）
    const deadline = Date.now() + 60_000;
    let delivered = false;
    while (Date.now() < deadline) {
      await viewerPage.getByPlaceholder('发个弹幕…').fill(msg2);
      await viewerPage.getByRole('button', { name: '发送' }).click();
      try {
        await expect(hostPage.locator('.chat-item', { hasText: msg2 })).toBeVisible({ timeout: 5_000 });
        delivered = true;
        break;
      } catch { /* WS 尚未就绪，稍后重试 */ }
    }
    expect(delivered, '观众断线恢复后 60 秒内未能重新发出弹幕').toBe(true);
  } finally {
    await hostCtx.close();
    await viewerCtx.close();
  }
});

test('管理后台：强制关播与封禁/解封点击流', async ({ browser }) => {
  test.setTimeout(180_000);
  const ts = Date.now();
  const adminCtx = await browser.newContext();
  const hostCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  const hostPage = await hostCtx.newPage();
  const banTarget = `e2e-ban-target-${ts}`;

  try {
    // 准备一个"直播中"房间（on_publish 回调与真实推流同路径）
    await login(hostPage, `e2e-admin-host-${ts}`, 'E2E主播丙', 'HOST');
    const { title, streamKey } = await createRoom(hostPage);   // createRoom 内已进入直播间
    await srsPublish(streamKey);

    await login(adminPage, `e2e-flow-admin-${ts}`, 'E2E管理员丙', 'ADMIN');
    await adminPage.getByRole('link', { name: '管理后台' }).click();
    const row = adminPage.locator('tr', { hasText: title });
    await expect(row.getByText('直播中')).toBeVisible({ timeout: 15_000 });

    // 强制关播：行内状态翻转为未开播（组件自动 refresh），刷新后仍为未开播
    await row.getByRole('button', { name: '强制关播' }).click();
    await expect(row.getByText('未开播')).toBeVisible({ timeout: 10_000 });
    await adminPage.reload();
    await expect(adminPage.locator('tr', { hasText: title }).getByText('未开播')).toBeVisible();

    // 封禁 / 解封：必须有行内反馈，不能静默无响应
    // M9 起 AdminPage 分 房间/商品/封禁 三个 Tab：先切到封禁 Tab，提交按钮用 .card 限定避免与 Tab 同名按钮撞 strict mode
    await adminPage.locator('.tabs').getByRole('button', { name: '封禁' }).click();
    await adminPage.getByPlaceholder('用户 ID').fill(banTarget);
    await adminPage.locator('.card').getByRole('button', { name: '封禁', exact: true }).click();
    await expect(adminPage.getByText(`已封禁用户 ${banTarget}`)).toBeVisible({ timeout: 10_000 });
    await adminPage.getByRole('button', { name: '解封' }).click();
    await expect(adminPage.getByText(`已解封用户 ${banTarget}`)).toBeVisible({ timeout: 10_000 });
  } finally {
    await adminCtx.close();
    await hostCtx.close();
  }
});
