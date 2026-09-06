import { existsSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

// 假摄像头/假麦克风：无 OBS 的浏览器开播闭环（WHIP 推流走 SRS 原生 /rtc/v1/whip/）
// 需带 H264 解码器的品牌浏览器（自带 Chromium 无解码器，观众端无法出画）。
// 频道优先级：E2E_BROWSER_CHANNEL 环境变量 > 本机装了 Chrome 用 chrome > 回退 msedge（Windows 必有且带 H264）
function resolveBrandChannel(): 'chrome' | 'msedge' {
  if (process.env.E2E_BROWSER_CHANNEL) return process.env.E2E_BROWSER_CHANNEL as 'chrome' | 'msedge';
  const chromePaths = [
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter((p): p is string => !!p);
  return chromePaths.some(p => existsSync(p)) ? 'chrome' : 'msedge';
}

test.use({
  channel: resolveBrandChannel(),
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

test('三源独立全链路：麦克风单独开播→+摄像头→+屏幕共享→全关自动停播', async ({ page }) => {
  test.setTimeout(180_000);
  const ts = Date.now();

  // 真 getDisplayMedia 在无头模式选不了源：3s 内选不出则回退「假屏+振荡器音轨」，
  // 音频/视频轨都是真 MediaStreamTrack，混音接线（connectScreenAudio）走真实链路
  await page.addInitScript(() => {
    const real = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = (c?: DisplayMediaStreamOptions): Promise<MediaStream> =>
      Promise.race<MediaStream>([
        real(c),
        new Promise<MediaStream>((_, rej) => setTimeout(() => rej(new Error('picker-timeout')), 3000)),
      ]).catch(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 360;
        const g = canvas.getContext('2d')!;
        let i = 0;
        setInterval(() => {
          g.fillStyle = '#243447'; g.fillRect(0, 0, 640, 360);
          g.fillStyle = '#e8eef5'; g.fillRect(60 + (i++ % 10) * 20, 70, 90, 90);
        }, 200);
        const videoTrack = canvas.captureStream(15).getVideoTracks()[0];
        const ctx = new AudioContext();
        const dst = ctx.createMediaStreamDestination();
        const osc = ctx.createOscillator();
        osc.connect(dst); osc.start();
        return new MediaStream([videoTrack, dst.stream.getAudioTracks()[0]]);
      });
  });

  await login(page, `e2e-3src-host-${ts}`, '三源主播', 'HOST');
  await createAndEnter(page, `三源间-${ts}`);
  await expect(page.locator('.meeting')).toBeVisible({ timeout: 15_000 });
  const toolbar = page.locator('.meeting-toolbar');

  // ── 1) 麦克风单独开播：SRS on_publish → 直播中；无画面源时显示文字垫 ──
  await toolbar.getByRole('button', { name: '麦克风已关' }).click();
  await expect(page.locator('.badge', { hasText: '直播中' }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.meeting-tag')).toContainText('麦克风直播中');

  // ── 2) 直播中加摄像头：预览出画、文字垫消失、无报错（会话不重建） ──
  await toolbar.getByRole('button', { name: '摄像头已关' }).click();
  await expect(toolbar.getByRole('button', { name: '摄像头', exact: true })).toBeVisible();
  await page.waitForFunction(() => {
    const v = document.querySelector('.meeting video.meeting-src-video') as HTMLVideoElement | null;
    return !!v && v.srcObject !== null && v.videoWidth > 0;
  }, null, { timeout: 15_000, polling: 500 });
  await expect(page.locator('.meeting-tag')).toHaveCount(0);
  await expect(page.locator('.meeting .meeting-error')).toHaveCount(0);

  // ── 2b) 麦克风静音/取消静音差分：发布音轨峰值 RMS 静音≈0、取消静音恢复 ──
  // 假麦克风是间歇蜂鸣：用 4s 窗口取峰值；取消静音用"10s 内任意 250ms 窗出现信号"稳健断言
  const peakRms = (windows = 16) => page.evaluate(async (windows) => {
    const v = document.querySelector('.meeting video') as HTMLVideoElement | null;
    const track = v?.srcObject?.getAudioTracks?.()[0];
    if (!track) return -1;
    const ac = new AudioContext();
    await ac.resume().catch(() => {});   // 无头无手势时新建即 suspended，必须恢复才有数据
    const src = ac.createMediaStreamSource(new MediaStream([track]));
    const an = ac.createAnalyser(); an.fftSize = 2048;
    src.connect(an);
    let peak = 0;
    for (let w = 0; w < windows; w++) {
      await new Promise(r => setTimeout(r, 250));
      const buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf);
      let sum = 0; for (const x of buf) sum += x * x;
      peak = Math.max(peak, Math.sqrt(sum / buf.length));
    }
    await ac.close();
    return peak;
  }, windows);
  const rmsUnmuted = await peakRms(60);   // 假麦克风蜂鸣有长静音期：15s 内等信号
  await toolbar.getByRole('button', { name: '麦克风', exact: true }).click();
  const rmsMuted = await peakRms(8);      // 增益 0 立即断流：静音期所有窗口都应≈0
  await toolbar.getByRole('button', { name: '麦克风已关' }).click();
  const rmsBack = await peakRms(40);      // 10s 内等蜂鸣回归
  console.log('[3src] 麦克风 RMS 未静音:', rmsUnmuted.toFixed(4), '静音:', rmsMuted.toFixed(4), '恢复:', rmsBack.toFixed(4));
  expect(rmsMuted, '静音后能量应归零').toBeLessThan(0.005);
  // 蜂鸣间隙不规律：未静音阶段（含后续摄像头+麦同开窗口）任一窗口有信号即算通过
  const rmsCamMic = await peakRms(16);    // 摄像头+麦同开 4s 再采样一次
  const micFlowPeak = Math.max(rmsUnmuted, rmsBack, rmsCamMic);
  console.log('[3src] 麦克风流动峰值:', micFlowPeak.toFixed(4));
  expect(micFlowPeak, '未静音阶段应能采到麦克风信号').toBeGreaterThan(0.01);

  // ── 3) 直播中加屏幕共享（带声音轨）：进入画中画合成，无报错 ──
  await toolbar.getByRole('button', { name: '共享屏幕' }).click();
  await expect(toolbar.getByRole('button', { name: '停止共享' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.meeting .meeting-error')).toHaveCount(0);

  // ── 3b) 画中画合成像素断言：屏幕层 + 摄像头画中画边框都在画布上 ──
  const pip = await page.evaluate(() => {
    const c = document.querySelector('.meeting canvas') as HTMLCanvasElement | null;
    if (!c) return null;
    const g = c.getContext('2d')!;
    const bw = 320, bh = Math.round(320 * 9 / 16);
    const bx = c.width - bw - 24, by = c.height - bh - 24;
    return {
      screenLayer: g.getImageData(60, 70, 1, 1).data.join(','),
      pipCenter: g.getImageData(bx + bw / 2, by + bh / 2, 1, 1).data.join(','),
      pipBorder: g.getImageData(bx + 2, by + 2, 1, 1).data.join(',')
    };
  });
  console.log('[3src] 画中画像素:', JSON.stringify(pip));
  expect(pip, '合成画布应存在').not.toBeNull();
  expect(pip!.pipBorder, '画中画应有描边（非纯黑）').not.toBe('0,0,0,0');

  // ── 3c) 屏幕共享带系统声音：静音麦克风后发布音轨仍有屏幕声能量 ──
  await toolbar.getByRole('button', { name: '麦克风', exact: true }).click();
  const rmsScreenAudio = await peakRms();
  await toolbar.getByRole('button', { name: '麦克风已关' }).click();
  console.log('[3src] 麦静音后屏幕声 RMS:', rmsScreenAudio.toFixed(4));
  expect(rmsScreenAudio, '屏幕共享声音应混入发布音轨').toBeGreaterThan(0.005);

  // ── 3d) 服务端确认：媒体真实到达 SRS（在播流 + 收流字节） ──
  const srs = await fetch('http://127.0.0.1:21985/api/v1/streams/').then(r => r.json());
  const liveStreams = (srs.streams ?? []).filter((x: { publish?: { active?: boolean }; recv_bytes?: number }) =>
    x.publish?.active && (x.recv_bytes ?? 0) > 0);
  console.log('[3src] SRS 在播流:', JSON.stringify(liveStreams.map((x: { name: string; recv_bytes: number }) => ({ name: x.name, recv: x.recv_bytes }))));
  expect(liveStreams.length, 'SRS 应有在播流').toBeGreaterThan(0);

  // ── 4) 停止共享（页面按钮 ≡ 浏览器"停止共享"） ──
  await toolbar.getByRole('button', { name: '停止共享' }).click();
  await expect(toolbar.getByRole('button', { name: '共享屏幕' })).toBeVisible();

  // ── 5) 全关自动停播：关摄像头 + 麦克风静音 → WHIP DELETE → on_unpublish → 未开播 ──
  await toolbar.getByRole('button', { name: '摄像头', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: '摄像头已关' })).toBeVisible();
  await toolbar.getByRole('button', { name: '麦克风', exact: true }).click();
  await expect(page.locator('.meeting .player-placeholder')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.badge', { hasText: '未开播' }).first()).toBeVisible({ timeout: 40_000 });
  await expect(page.locator('.meeting .meeting-error')).toHaveCount(0);
});
