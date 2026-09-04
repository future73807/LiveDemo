# M9: 网页开播台 / 平台商品库 / 响应式 / 嵌入 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主播浏览器开播（摄像头/麦克风/屏幕共享，WHIP 推流，零配置）；商品改平台统一库（ADMIN 维护、主播选品）；全站移动端响应式；iframe 嵌入（URL token + postMessage 双通道）；部署文档补无备案 IP 自签 HTTPS 模式。

**Architecture:** 推流走 SRS 原生 WHIP（`/rtc/v1/whip/`，信令经 web nginx 既有 `/rtc` 反代），浏览器 `RTCPeerConnection` sendonly + `getUserMedia/getDisplayMedia`，无音频轨时补静音轨（SRS WHIP 要求音视频齐备）。商品库收归 ADMIN（`ProductCatalog` 接口改为平台库语义，去 owner 校验），删除商品级联软删在架挂载并广播。嵌入：URL `?token=&embed=1` 注入登录态 + postMessage 协议，`/api/auth/me` 提供任意模式下的身份查询。

**Tech Stack:** 沿用工程栈；E2E 用 Playwright fake-media（`--use-fake-device-for-media-stream`）实现无 OBS 开播闭环。

**前置条件：** M1~M8 完成（后端 55 / vitest 6 / Playwright 7 全绿）。

**验收标准:**
- Playwright 假摄像头开播闭环：主播 UI 点「开始直播」→ 房间 LIVING → 观众 WebRTC 出画 → 弹幕 → 结束
- ADMIN 在 /admin 建商品 → 主播选品挂载 → 观众加购正常；HOST 调创建商品接口 → 403
- 375×667 视口下直播间页无横向滚动
- iframe 注入 token 后进入房间无需登录弹窗；postMessage ready/room-status 事件可收
- 全量回归：mvn / vitest / playwright 全绿

---

### Task 1: 后端——publish-urls 接口

**Files:**
- Modify: `live-service/src/main/java/com/livedemo/live/room/RoomController.java`
- Test: `live-service/src/test/java/com/livedemo/live/room/PublishUrlsTest.java`

- [ ] **Step 1: 写失败测试**（追加到 `PlayUrlsModeTest.java` 同目录新文件）：

```java
package com.livedemo.live.room;

import com.livedemo.live.TestTokens;
import com.livedemo.live.auth.AuthUser;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class PublishUrlsTest {

    @Autowired MockMvc mvc;
    @Autowired TestTokens tokens;

    private long createRoom(String user) throws Exception {
        String resp = mvc.perform(post("/api/rooms")
                        .header("Authorization", "Bearer " + tokens.sign(
                                new AuthUser(user, "主播", java.util.Set.of("HOST"))))
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andReturn().getResponse().getContentAsString();
        return ((Number) com.jayway.jsonpath.JsonPath.read(resp, "$.data.id")).longValue();
    }

    @Test
    void ownerGetsWhipUrl() throws Exception {
        long id = createRoom("pu" + System.currentTimeMillis());
        mvc.perform(get("/api/rooms/" + id + "/publish-urls")
                        .header("Authorization", "Bearer " + tokens.sign(
                                new AuthUser("owner" + id, "主播", java.util.Set.of("HOST")))))
                // 非房主 403——先建后查需同用户，改用同用户：
                .andReturn();
    }

    @Test
    void nonOwnerForbidden() throws Exception {
        long id = createRoom("po" + System.currentTimeMillis());
        mvc.perform(get("/api/rooms/" + id + "/publish-urls")
                        .header("Authorization", "Bearer " + tokens.sign(
                                new AuthUser("other" + id, "别人", java.util.Set.of("HOST")))))
                .andExpect(status().isForbidden());
    }

    @Test
    void ownerReceivesWhipAndRtmp() throws Exception {
        String user = "pw" + System.currentTimeMillis();
        long id = createRoom(user);
        mvc.perform(get("/api/rooms/" + id + "/publish-urls")
                        .header("Authorization", "Bearer " + tokens.sign(
                                new AuthUser(user, "主播", java.util.Set.of("HOST")))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.whip").value(
                        org.hamcrest.Matchers.containsString("/rtc/v1/whip/?app=live&stream=room-")))
                .andExpect(jsonPath("$.data.rtmp").value(
                        org.hamcrest.Matchers.startsWith("rtmp://localhost:1935/live/")));
    }
}
```

（`ownerGetsWhipUrl` 用例可删——`ownerReceivesWhipAndRtmp` 已覆盖正路径，保留 2 个用例即可。）

- [ ] **Step 2: 确认失败（404）**。

- [ ] **Step 3: 实现**——`RoomController`：

```java
    public record PublishUrls(String whip, String rtmp, String streamKey) {}

    private String srsBase() {
        if ("base".equalsIgnoreCase(props.getSrs().getPlayUrlMode())) {
            return props.getSrs().getPublicBaseUrl().replaceAll("/+$", "");
        }
        return "http://%s:%d".formatted(props.getSrs().getPublicHost(), props.getSrs().getApiPort());
    }

    @GetMapping("/{id}/publish-urls")
    public ApiResponse<PublishUrls> publishUrls(@PathVariable long id,
                                                @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        Room room = service.get(id);
        service.assertOwner(room, user);
        String key = room.getStreamKey();
        String whip = srsBase() + "/rtc/v1/whip/?app=live&stream=" + key;
        return ApiResponse.ok(new PublishUrls(whip, service.pushUrl(room), key));
    }
```

并把 `playUrls` 方法中 base 分支改用 `srsBase()`（FLV/HLS 仍走 `/live`，host 模式端口用 httpPort——保留原实现，仅 base 分支复用 `srsBase()`）：

```java
    @GetMapping("/{id}/play-urls")
    public ApiResponse<PlayUrls> playUrls(@PathVariable long id) {
        Room room = service.get(id);
        String key = room.getStreamKey();
        String base = srsBase();
        String flvHlsBase = "base".equalsIgnoreCase(props.getSrs().getPlayUrlMode())
                ? base : "http://%s:%d".formatted(props.getSrs().getPublicHost(), props.getSrs().getHttpPort());
        return ApiResponse.ok(new PlayUrls(
                base + "/rtc/v1/whep/?app=live&stream=" + key,
                flvHlsBase + "/live/" + key + ".flv",
                flvHlsBase + "/live/" + key + ".m3u8"));
    }
```

注意：base 模式下 flv/hls 前缀与 whep 同源（`https://域名`），host 模式下 whep 用 apiPort、flv/hls 用 httpPort——与 M8 行为一致，`PlayUrlsModeTest` 必须保持绿。

- [ ] **Step 4: 全量测试绿。Commit** `feat(room): publish-urls 接口（WHIP 开播地址，房主限定）`

---

### Task 2: 后端——平台商品库

**Files:**
- Modify: `live-service/src/main/java/com/livedemo/live/commerce/acl/ProductCatalog.java`
- Modify: `live-service/src/main/java/com/livedemo/live/commerce/local/LocalProductCatalog.java`
- Modify: `live-service/src/main/java/com/livedemo/live/commerce/ProductController.java`
- Modify: `live-service/src/main/java/com/livedemo/live/commerce/ShelfService.java`
- Modify: `live-service/src/main/java/com/livedemo/live/commerce/RoomProductRepository.java`
- Modify: `live-service/src/main/java/com/livedemo/live/commerce/ShelfServiceTest.java`、`CommerceApiTest.java`
- Test: `live-service/src/test/java/com/livedemo/live/commerce/PlatformCatalogTest.java`

语义变更：
- `ProductCatalog`：`create(ProductDraft)`（去 ownerId，落库 `owner_id='platform'`）、`update(long, ProductDraft)`、`delete(long)`、`list()`（全库）；删除 `listByOwner`
- `ShelfService.mount`：删除“仅可挂载自己的商品”校验
- `ProductController`：POST/PATCH/DELETE `/api/products` → 仅 ADMIN；GET `/api/products` → HOST/ADMIN（选品列表）
- `DELETE /api/products/{id}`：删除实体 + 级联软删所有在架挂载并逐房间广播 `product_update`

- [ ] **Step 1: 写失败测试**

`PlatformCatalogTest.java`：

```java
package com.livedemo.live.commerce;

import com.livedemo.live.TestTokens;
import com.livedemo.live.auth.AuthUser;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class PlatformCatalogTest {

    @Autowired MockMvc mvc;
    @Autowired TestTokens tokens;

    private String tokenOf(String id, String role) {
        return tokens.sign(new AuthUser(id, "用户" + id, java.util.Set.of(role)));
    }

    @Test
    void hostCannotCreateButCanList() throws Exception {
        String host = tokenOf("pc-h" + System.currentTimeMillis(), "HOST");
        mvc.perform(post("/api/products").header("Authorization", "Bearer " + host)
                        .contentType("application/json").content("{\"title\":\"x\",\"price\":1}"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/products").header("Authorization", "Bearer " + host))
                .andExpect(status().isOk());
    }

    @Test
    void adminCrudAndCascadeUnmount() throws Exception {
        String admin = tokenOf("pc-a" + System.currentTimeMillis(), "ADMIN");
        String host = tokenOf("pc-h2" + System.currentTimeMillis(), "HOST");
        String resp = mvc.perform(post("/api/products").header("Authorization", "Bearer " + admin)
                        .contentType("application/json")
                        .content("{\"title\":\"平台商品-" + System.currentTimeMillis() + "\",\"price\":19.9}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        Integer pid = com.jayway.jsonpath.JsonPath.read(resp, "$.data.id");

        String roomResp = mvc.perform(post("/api/rooms").header("Authorization", "Bearer " + host)
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andReturn().getResponse().getContentAsString();
        Integer roomId = com.jayway.jsonpath.JsonPath.read(roomResp, "$.data.id");
        mvc.perform(post("/api/rooms/" + roomId + "/products").header("Authorization", "Bearer " + host)
                        .contentType("application/json").content("{\"productId\":" + pid + ",\"sort\":1}"))
                .andExpect(status().isOk());

        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .patch("/api/products/" + pid).header("Authorization", "Bearer " + admin)
                        .contentType("application/json").content("{\"title\":\"改价\",\"price\":29.9}"))
                .andExpect(status().isOk());

        mvc.perform(delete("/api/products/" + pid).header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk());
        mvc.perform(get("/api/rooms/" + roomId + "/products"))
                .andExpect(jsonPath("$.data.length()").value(0));   // 级联摘除
    }
}
```

`RoomProductRepository` 追加：

```java
    java.util.List<RoomProduct> findByProductIdAndRemovedAtIsNull(Long productId);
```

- [ ] **Step 2: 确认失败** → 实现：

`ProductCatalog` 接口替换为：

```java
public interface ProductCatalog {
    Product create(ProductDraft draft);
    Product update(long productId, ProductDraft draft);
    void delete(long productId);
    List<Product> list();
    Product get(long productId);
}
```

`LocalProductCatalog` 对应实现（create 写 `ownerId("platform")`；update find→改字段→save；delete 直接 `repo.deleteById`——级联在 ShelfService）；`ProductController`：POST/PATCH/DELETE 加 `user.requireRole(AuthUser.ADMIN)`，GET 保留 `requireRole(HOST, ADMIN)`，PATCH body 复用 CreateProductRequest；`ShelfService.mount` 删除 owner 校验；新增：

```java
    public int unmountAll(long productId) {
        var actives = shelfRepo.findByProductIdAndRemovedAtIsNull(productId);
        actives.forEach(mount -> {
            mount.setRemovedAt(java.time.LocalDateTime.now());
            shelfRepo.save(mount);
            productRepo.findById(productId).ifPresent(p -> broadcast(mount.getRoomId(), "remove", p));
        });
        return actives.size();
    }
```

`ProductController.delete` 注入 `ShelfService`，顺序：`shelfService.unmountAll(id)` → `catalog.delete(id)`。

- [ ] **Step 3: 适配旧测试**——`ShelfServiceTest`：`product(1L,"h1")` 的 owner 校验用例改为“任意主播可挂平台商品”（删 `mount_otherOwnersProduct_returns403`，构造函数若签名变化同步适配）；`CommerceApiTest.fullCommerceFlow` 中建商品改为 ADMIN token；`LocalCartServiceTest` 不受影响。

- [ ] **Step 4: 全量绿。Commit** `feat(commerce): 平台商品库（ADMIN 维护/主播选品/删除级联摘除）`

---

### Task 3: 后端——/api/auth/me

**Files:**
- Create: `live-service/src/main/java/com/livedemo/live/auth/MeController.java`
- Test: 追加到 `AuthInternalApiTest`（或独立 `MeTest.java`）

```java
package com.livedemo.live.auth;

import com.livedemo.live.common.ApiResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** 当前登录身份查询：任意认证模式可用（需有效凭证），嵌入模式注入 token 后拉取 */
@RestController
public class MeController {
    @GetMapping("/api/auth/me")
    public ApiResponse<AuthUser> me(@org.springframework.web.bind.annotation.RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        return ApiResponse.ok(user);
    }
}
```

测试：dev-token/注册 token 调 `/api/auth/me` → 200 且 `data.userId` 正确；无凭证 → 401。Commit `feat(auth): /api/auth/me 身份查询（嵌入模式依赖）`

---

### Task 4: 前端——网页开播台 StudioPanel

**Files:**
- Create: `web/src/components/StudioPanel.tsx`
- Create: `web/src/realtime/whip.ts`
- Modify: `web/src/api/endpoints.ts`（roomsApi.publishUrls）、`web/src/api/types.ts`（PublishUrls）
- Modify: `web/src/pages/RoomPage.tsx`（主播视角：StudioPanel 替换原「开始直播」入口；HostPanel 保留选品部分）

`web/src/realtime/whip.ts`（WHIP 发布器，含 ICE 收集与静音轨）：

```typescript
export interface WhipSession { pc: RTCPeerConnection; location: string | null; }

function waitIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const done = () => resolve();
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') done();
    });
    setTimeout(done, 1500);
  });
}

/** SRS WHIP 要求音视频齐备：无麦克风时补静音轨 */
export function silentAudioTrack(): MediaStreamTrack {
  const ctx = new AudioContext();
  const dst = ctx.createMediaStreamDestination();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(gain).connect(dst);
  osc.start();
  return dst.stream.getAudioTracks()[0];
}

export async function whipPublish(url: string, stream: MediaStream): Promise<WhipSession> {
  if (stream.getAudioTracks().length === 0) stream.addTrack(silentAudioTrack());
  const pc = new RTCPeerConnection();
  stream.getTracks().forEach(t => pc.addTrack(t, stream));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIce(pc);
  const resp = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription!.sdp
  });
  if (!resp.ok) { pc.close(); throw new Error(`WHIP 推流失败: ${resp.status}`); }
  const answer = await resp.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  const loc = resp.headers.get('Location');
  return { pc, location: loc ? new URL(loc, url).toString() : null };
}

export async function whipStop(session: WhipSession): Promise<void> {
  try { if (session.location) await fetch(session.location, { method: 'DELETE' }); } catch { /* 尽力而为 */ }
  session.pc.close();
}
```

`StudioPanel.tsx`（预览/设备选择/屏幕共享/开始/停止/时长）：

```tsx
import { useEffect, useRef, useState } from 'react';
import { roomsApi } from '../api/endpoints';
import { whipPublish, whipStop, WhipSession } from '../realtime/whip';

type Source = 'camera' | 'screen';

export default function StudioPanel({ roomId, onEnded }: { roomId: number; onEnded: () => void }) {
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState('');
  const [micId, setMicId] = useState('');
  const [source, setSource] = useState<Source>('camera');
  const [publishing, setPublishing] = useState(false);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState('');
  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<WhipSession | null>(null);
  const whipRef = useRef('');

  useEffect(() => { roomsApi.publishUrls(roomId).then(u => { whipRef.current = u.whip; }).catch(() => {}); }, [roomId]);
  useEffect(() => {
    if (!publishing) return;
    const timer = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [publishing]);

  async function openStream(): Promise<MediaStream> {
    if (source === 'screen') return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    return navigator.mediaDevices.getUserMedia({
      video: camId ? { deviceId: { exact: camId } } : true,
      audio: micId ? { deviceId: { exact: micId } } : true
    });
  }

  async function preview() {
    stopPreview();
    try {
      const s = await openStream();
      streamRef.current = s;
      if (previewRef.current) previewRef.current.srcObject = s;
      const all = await navigator.mediaDevices.enumerateDevices();
      setCams(all.filter(d => d.kind === 'videoinput'));
      setMics(all.filter(d => d.kind === 'audioinput'));
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : '打开设备失败（需 HTTPS 环境并授权）'); }
  }
  function stopPreview() { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; }

  async function start() {
    setError('');
    try {
      if (!streamRef.current) await preview();
      sessionRef.current = await whipPublish(whipRef.current, streamRef.current!);
      setPublishing(true);
      setSecs(0);
    } catch (e) { setError(e instanceof Error ? e.message : '推流失败'); }
  }

  async function stop() {
    if (sessionRef.current) await whipStop(sessionRef.current);
    sessionRef.current = null;
    setPublishing(false);
  }

  useEffect(() => () => { // 卸载清理
    if (sessionRef.current) whipStop(sessionRef.current);
    stopPreview();
  }, []);

  const mmss = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

  return (
    <div className="card studio" style={{ marginTop: 12 }}>
      <h3 style={{ marginBottom: 8 }}>开播台</h3>
      {error && <div className="error-text" style={{ marginBottom: 6 }}>{error}</div>}
      <div className="studio-preview" style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden', aspectRatio: '16/9' }}>
        <video ref={previewRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        {!publishing && !streamRef.current && <div className="player-placeholder">选择设备后点击「预览」</div>}
        {publishing && <span className="badge living" style={{ position: 'absolute', left: 8, top: 8 }}>直播中 {mmss}</span>}
      </div>
      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setSource('camera')}>摄像头</button>
        <button onClick={() => setSource('screen')}>共享屏幕</button>
        <button className="primary" onClick={preview}>预览</button>
      </div>
      {source === 'camera' && (
        <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <select value={camId} onChange={e => setCamId(e.target.value)}>
            <option value="">默认摄像头</option>
            {cams.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || '摄像头'}</option>)}
          </select>
          <select value={micId} onChange={e => setMicId(e.target.value)}>
            <option value="">默认麦克风</option>
            {mics.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || '麦克风'}</option>)}
          </select>
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        {!publishing
          ? <button className="primary" onClick={start}>开始直播</button>
          : <button className="danger" onClick={stop}>停止推流</button>}
      </div>
    </div>
  );
}
```

`RoomPage` 主播视角替换：原 HostPanel 中「结束直播」移到 StudioPanel 下方保留（加 `onEnded` 调 roomsApi.end 并 navigate）；HostPanel 精简为选品面板（Task 5）。

- [ ] Commit `feat(web): 网页开播台（WHIP 推流/设备选择/屏幕共享）`

---

### Task 5: 前端——选品面板与平台商品库管理

**Files:**
- Modify: `web/src/components/HostPanel.tsx`（重写：已挂载列表+商品库选品，不再手输商品）
- Modify: `web/src/pages/AdminPage.tsx`（商品管理 Tab）
- Modify: `web/src/api/endpoints.ts`（productsApi.update/remove）

`HostPanel` 重写要点（完整重写该组件）：

```tsx
import { useCallback, useEffect, useState } from 'react';
import { productsApi, shelfApi } from '../api/endpoints';
import type { Product } from '../api/types';

export default function HostPanel({ roomId }: { roomId: number }) {
  const [mounted, setMounted] = useState<Product[]>([]);
  const [library, setLibrary] = useState<Product[]>([]);
  const [kw, setKw] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [shelf, lib] = await Promise.all([shelfApi.list(roomId), productsApi.list()]);
      setMounted(shelf);
      setLibrary(lib);
    } catch (e) { setError(e instanceof Error ? e.message : '加载失败'); }
  }, [roomId]);
  useEffect(() => { refresh(); }, [refresh]);

  const mountedIds = new Set(mounted.map(p => p.id));
  const filtered = library.filter(p => !kw || p.title.includes(kw));

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ marginBottom: 8 }}>选品挂载</h3>
      {error && <div className="error-text">{error}</div>}
      <div className="muted" style={{ margin: '4px 0' }}>已挂载（点击摘除）</div>
      {mounted.map(p => (
        <div key={p.id} className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <span>{p.title}（￥{p.price}）</span>
          <button className="danger" onClick={() => shelfApi.unmount(roomId, p.id).then(refresh)}>摘除</button>
        </div>
      ))}
      {!mounted.length && <div className="muted">暂未挂载商品</div>}
      <div className="muted" style={{ margin: '8px 0 4px' }}>平台商品库</div>
      <input value={kw} onChange={e => setKw(e.target.value)} placeholder="搜索商品" style={{ width: '100%', marginBottom: 6 }} />
      {filtered.map(p => (
        <div key={p.id} className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <span>{p.title}（￥{p.price}）</span>
          <button className="primary" disabled={mountedIds.has(p.id)}
            onClick={() => shelfApi.mount(roomId, p.id).then(refresh)}>
            {mountedIds.has(p.id) ? '已挂载' : '挂载'}
          </button>
        </div>
      ))}
      {!filtered.length && <div className="muted">商品库为空，请联系管理员配置</div>}
    </div>
  );
}
```

（props 中 `onEnded` 移除，由 StudioPanel 区承担结束直播；RoomPage 相应调整。）

`AdminPage` 商品管理：新增 Tab（房间/商品/封禁），商品 Tab：新建表单（标题/价格/图片链接）+ 列表（编辑价格改弹 prompt 或行内 input）+ 删除按钮（确认后调用）。`endpoints`：

```typescript
  update: (id: number, p: { title: string; price: number; imageUrl?: string; detailUrl?: string; stock?: number }) =>
    http.patch<Product>(`/products/${id}`, p),
  remove: (id: number) => http.del<void>(`/products/${id}`),
  list: () => http.get<Product[]>('/products'),
```

- [ ] Commit `feat(web): 平台商品库管理 + 主播选品面板`

---

### Task 6: 前端——响应式

**Files:**
- Modify: `web/src/index.css`

追加（文件尾）：

```css
/* 移动端适配（≤768px） */
@media (max-width: 768px) {
  .page { padding: 10px; }
  .grid { grid-template-columns: 1fr; }
  .room-layout { grid-template-columns: 1fr; }
  .side-panel { min-height: 0; height: auto; max-height: 60vh; }
  .chat-list { max-height: 40vh; }
  .topbar { flex-wrap: wrap; gap: 8px; padding: 10px 12px; }
  .danmaku-item { font-size: 14px; }
  .dialog { width: 94vw; }
  .drawer { width: 100vw; }
  .studio select { max-width: 46%; }
}
```

验证：Playwright 新增移动视口断言（Task 8）。
- [ ] Commit `feat(web): 移动端响应式（≤768px 断点）`

---

### Task 7: 前端——嵌入模式（URL token + postMessage）

**Files:**
- Modify: `web/src/auth/AuthContext.tsx`（URL token 注入 + /me 拉取 + isEmbed）
- Modify: `web/src/App.tsx`（Topbar/LoginModal 按 isEmbed 隐藏；postMessage 监听与 ready 广播）
- Modify: `web/src/pages/RoomPage.tsx`（embed 模式下 room_status 转发 parent）

`AuthContext` 要点（在 Provider 内 useEffect 一次执行）：

```typescript
  // 嵌入模式：?token=<JWT>&embed=1 注入登录态
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');
  const urlEmbed = params.get('embed');
  if (urlEmbed === '1') localStorage.setItem('live.embed', '1');
  if (urlToken) {
    setToken(urlToken);
    params.delete('token'); params.delete('embed');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    authApi.me().then(me => { tokenStorage.user = me; setUser(me); }).catch(() => {});
  }
  const [isEmbed] = useState(() => localStorage.getItem('live.embed') === '1');
```

（实际实现需处理 React StrictMode 双执行幂等——注入逻辑放 useState 初始化或 ref 守卫；`authMode` 拉取失败不阻塞。`isEmbed` 暴露到 value。）

`App.tsx` 要点：

```typescript
  // postMessage 双通道
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const d = e.data as { type?: string; token?: string };
      if (d?.type === 'livedemo-auth' && d.token) {
        setToken(d.token);
        authApi.me().then(me => { tokenStorage.user = me; setUserCtx(me); }).catch(() => {});
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);
  useEffect(() => { if (isEmbed) window.parent?.postMessage({ type: 'livedemo-ready' }, '*'); }, [isEmbed]);
```

Gate：`{!user && !isEmbed && <LoginModal />}`；Topbar：`{!isEmbed && <Topbar />}`；RoomPage：room_status 变化时 `isEmbed && window.parent?.postMessage({ type: 'livedemo-room-status', status }, '*')`。

- [ ] Commit `feat(web): 嵌入模式（URL token/postMessage 双通道 + 骨架隐藏）`

---

### Task 8: E2E 与回归

**Files:**
- Create: `web/tests-e2e/studio.spec.ts`
- Modify: `docs/deploy.md`（IP 自签章节）
- Modify: `scripts/pack.ps1`（修复 node_modules 混入：改用 robocopy /E /XD 排除）

`studio.spec.ts` 核心用例（fake 设备，无 OBS）：

```typescript
import { test, expect } from '@playwright/test';

test.use({
  permissions: ['camera', 'microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }
});

test('假摄像头开播闭环（创建-开播-看播-弹幕-结束）', async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  const viewer = await (await browser.newContext()).newPage();
  // 复用既有登录 helper（注册/登录 API 直签），创建房间并进入
  // host: 开播台可见 → 点「预览」→「开始直播」→ 房间页出现「直播中」徽标（20s 内）
  // viewer: 进入该房间 → video.srcObject 非空且 videoWidth>0（waitForFunction）
  // viewer 发弹幕 → host 聊天列表可见
  // host 点「停止推流」→ viewer 页 30s 内出现「主播还未开播」占位（on_unpublish 回调）
});
```

（登录/建房 helper 从 smoke/flows 复制；断言细节按实现微调。）

`deploy.md` 追加「IP 直连（无备案）部署」章节：
1. 约束说明：getUserMedia/getDisplayMedia/WebRTC 仅安全上下文；`http://IP` 下不可用
2. 自签证书（1Panel：网站-证书-自签 或 openssl 一条命令 + 面板导入），绑定 443
3. `.env`：`LIVE_PUBLIC_BASE_URL=https://<服务器IP>`、`LIVE_PLAY_URL_MODE=base`、`SRS_CANDIDATE=<公网IP>`
4. 访客首次访问需在浏览器信任自签证书（点"高级→继续前往"）；不信任证书的观众可用 `http://IP:3000` + HTTP-FLV 降级观看（无开播/弹幕需 https 的功能除外——弹幕 WS 经 http 也可用，仅媒体与设备 API 受限）
5. 明确提示：一个月期服务器到期前导出 `.env` 与 livedemo-data 卷

`pack.ps1` 修复：Copy-Item 循环替换为逐项 robocopy（`robocopy $i $dest /E /XD node_modules dist target data test-results playwright-report .vite .gradle .git /XF .env`，`$LASTEXITCODE -ge 8` 才算失败），并实测重新打包含无 `web/node_modules`。

回归：`./scripts/mvn.ps1 test`、`cd web && npm test`、`npm run e2e`（smoke 2 + flows 3 + account 2 + studio ≥1）全绿。

- [ ] Commit：`test(e2e): 网页开播闭环用例`、`docs(deploy): 无备案 IP 自签 HTTPS 部署`、`fix(scripts): pack.ps1 排除 node_modules`

---

## 自审记录

- 设计 §11 覆盖：A 开播台（WHIP/设备/屏幕共享/零配置地址）✓；B 平台商品库（ADMIN CRUD/选品/级联摘除+广播）✓；C 响应式 ✓；D 嵌入双通道 ✓；E IP 自签文档 + pack 修复 ✓
- 兼容性：M8 `PlayUrlsModeTest` 行为保持（base 模式 whep/flv/hls 同源；host 模式端口区分）——Task 1 实现需跑该测试确认 ✓
- 类型一致性：`PublishUrls{whip,rtmp,streamKey}`；`ProductCatalog` 新签名在 Task 2 内全部同步（Controller/ShelfService/Local/测试）✓
- 风险：SRS WHIP 无音频轨兼容性用静音轨兜底；StrictMode 下 URL 注入需幂等守卫
