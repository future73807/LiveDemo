# M8: 公网化部署（宝塔/1Panel 兼容）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** demo 可部署到有域名+服务器的公网环境：HTTPS 由宝塔/1Panel 反代承担（容器不内置 TLS），消除混合内容（play-urls 同源化），配置全部环境变量化，输出部署文档。

**Architecture:** 流量模型——宝塔/1Panel 把 `https://域名` 反代到 `http://127.0.0.1:3000`（web 容器 nginx）；web nginx 新增 `/rtc → srs:1985`（WHEP 信令）与 `/live → srs:8080`（FLV/HLS）反代，使播放地址全部同源（`https://域名/rtc/...`、`https://域名/live/...`），浏览器不再拦混合内容；RTMP 1935 与 WebRTC UDP 8000 仍直连服务器。`play-url-mode: base` 时按 `live.srs.public-base-url` 拼同源地址；本地开发保持 `host` 模式零改动。

**Tech Stack:** nginx / docker compose env / 现有工程栈。

**验收标准:**
- `base` 模式下 play-urls 返回 `https://<base>/rtc/...`、`https://<base>/live/...`（单测覆盖）
- 本地经 web nginx 反代可 ffprobe 到 FLV（`http://localhost:3000/live/<key>.flv`）并完成一次完整推拉流
- 1985/8080 仅绑定 127.0.0.1；全量回归绿（mvn / vitest / playwright）
- docs/deploy.md 完整可执行（宝塔 + 1Panel 两套步骤）

---

### Task 1: play-urls base 模式

**Files:**
- Modify: `live-service/src/main/java/com/livedemo/live/config/LiveProps.java`（Srs 增加 `playUrlMode`、`publicBaseUrl`）
- Modify: `live-service/src/main/java/com/livedemo/live/room/RoomController.java`（playUrls 按 mode 拼装；pushUrl 不变）
- Modify: `live-service/src/main/resources/application.yml`
- Test: `live-service/src/test/java/com/livedemo/live/room/PlayUrlsModeTest.java`

- [x] **Step 1: 写失败测试**

`PlayUrlsModeTest.java`（WebEnvironment.RANDOM_PORT + @TestPropertySource 切 base 模式，避免影响其他用例）：

```java
package com.livedemo.live.room;

import com.livedemo.live.TestTokens;
import com.livedemo.live.auth.AuthUser;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "live.srs.play-url-mode=base",
        "live.srs.public-base-url=https://live.example.com"
})
class PlayUrlsModeTest {

    @Autowired MockMvc mvc;
    @Autowired TestTokens tokens;

    @Test
    void baseModeEmitsSameOriginUrls() throws Exception {
        String roomResp = mvc.perform(post("/api/rooms")
                        .header("Authorization", "Bearer " + tokens.sign(
                                new AuthUser("pb" + System.currentTimeMillis(), "主播", java.util.Set.of("HOST"))))
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andReturn().getResponse().getContentAsString();
        Integer id = com.jayway.jsonpath.JsonPath.read(roomResp, "$.data.id");

        String resp = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .get("/api/rooms/" + id + "/play-urls"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat((String) com.jayway.jsonpath.JsonPath.read(resp, "$.data.webrtc"))
                .startsWith("https://live.example.com/rtc/v1/whep/?app=live&stream=");
        assertThat((String) com.jayway.jsonpath.JsonPath.read(resp, "$.data.flv"))
                .startsWith("https://live.example.com/live/").endsWith(".flv");
        assertThat((String) com.jayway.jsonpath.JsonPath.read(resp, "$.data.hls"))
                .startsWith("https://live.example.com/live/").endsWith(".m3u8");
    }
}
```

- [x] **Step 2: 确认失败** → `./scripts/mvn.ps1 test "-Dtest=PlayUrlsModeTest"`（host 模式断言不匹配）。

- [x] **Step 3: 实现**

`LiveProps.Srs` 追加：

```java
        /** host=按 public-host:port 拼地址（本地开发）；base=按 public-base-url 拼同源地址（公网 HTTPS） */
        private String playUrlMode = "host";
        private String publicBaseUrl = "";
```

`RoomController.playUrls` 替换为：

```java
    @GetMapping("/{id}/play-urls")
    public ApiResponse<PlayUrls> playUrls(@PathVariable long id) {
        Room room = service.get(id);
        String key = room.getStreamKey();
        PlayUrls urls;
        if ("base".equalsIgnoreCase(props.getSrs().getPlayUrlMode())) {
            String base = props.getSrs().getPublicBaseUrl().replaceAll("/+$", "");
            urls = new PlayUrls(
                    base + "/rtc/v1/whep/?app=live&stream=" + key,
                    base + "/live/" + key + ".flv",
                    base + "/live/" + key + ".m3u8");
        } else {
            String host = props.getSrs().getPublicHost();
            urls = new PlayUrls(
                    "http://%s:%d/rtc/v1/whep/?app=live&stream=%s".formatted(host, props.getSrs().getApiPort(), key),
                    "http://%s:%d/live/%s.flv".formatted(host, props.getSrs().getHttpPort(), key),
                    "http://%s:%d/live/%s.m3u8".formatted(host, props.getSrs().getHttpPort(), key));
        }
        return ApiResponse.ok(urls);
    }
```

`application.yml` 追加（`live.srs` 下）：

```yaml
    play-url-mode: ${LIVE_PLAY_URL_MODE:host}
    public-base-url: ${LIVE_PUBLIC_BASE_URL:}
```

- [x] **Step 4: 全量测试**（预期 53 + 1，Errors 0——host 模式默认值不影响既有用例）。

- [x] **Step 5: Commit** `feat(srs): play-urls base 模式（公网同源地址，消除混合内容）`

---

### Task 2: web nginx 反代 /rtc /live

**Files:**
- Modify: `web/nginx.conf`（追加两个 location）

- [x] **Step 1: 追加 location（置于 /api 与 /ws 之间）**

```nginx
    # WHEP 信令反代（base 模式播放地址为同源 /rtc/...）
    location /rtc/ {
        proxy_pass http://srs:1985;
        proxy_set_header Host $host;
    }

    # HTTP-FLV / HLS 反代（base 模式播放地址为同源 /live/...）
    location /live/ {
        proxy_pass http://srs:8080;
        proxy_set_header Host $host;
        # FLV 是长连接流，关闭缓冲
        proxy_buffering off;
    }
```

- [x] **Step 2: 本地验证**（host 模式 compose 下即可验证反代链路）：

```powershell
docker compose up -d --build web   # timeout 600000
# 推一路流后（docker ffmpeg，见 M6 适配），经 3000 反代探测：
docker run --rm --network livedemo_default --entrypoint ffprobe jrottenberg/ffmpeg:6-alpine -v error -show_entries stream=codec_name -of csv=p=0 http://web/live/<key>.flv
# 注意：web 容器在 compose 网络内可达 srs；从宿主机验证改为：
curl.exe -s -o NUL -w "%{http_code}" -X POST "http://localhost:3000/rtc/v1/whep/?app=live&stream=<key>" -H "Content-Type: application/sdp" --data "v=0"
```

预期：WHEP 反代返回非 404（M1 已知非法 SDP 可能空回复/断连，以 SRS 日志出现处理记录为准）；ffprobe 经 `http://localhost:3000/live/<key>.flv` 从宿主机验证输出 `aac`,`h264`（3000 对宿主机开放，容器间 web 可达 srs）。

- [x] **Step 3: Commit** `feat(web): nginx 反代 /rtc /live（同源播放地址链路）`

---

### Task 3: 配置收敛与部署文档

**Files:**
- Modify: `docker-compose.yml`（端口绑定收敛 + .env 化）
- Create: `.env.example`
- Create: `docs/deploy.md`
- Modify: `README.md`（部署段指向 deploy.md）

- [x] **Step 1: docker-compose.yml 终稿调整**

```yaml
services:
  srs:
    image: ossrs/srs:5
    container_name: livedemo-srs
    restart: unless-stopped
    ports:
      - "1935:1935"                 # RTMP 推流（主播直连）
      - "127.0.0.1:1985:1985"       # SRS API/WHEP——仅本机，公网走 web 反代
      - "127.0.0.1:8080:8080"       # FLV/HLS——仅本机，公网走 web 反代
      - "${SRS_UDP_BIND:-0.0.0.0}:8000:8000/udp"   # WebRTC 媒体
    environment:
      - CANDIDATE=${SRS_CANDIDATE:-127.0.0.1}   # 公网部署必须改为服务器公网 IP
    volumes:
      - ./srs/srs.conf:/usr/local/srs/conf/docker.conf

  live-service:
    build: ./live-service
    container_name: livedemo-api
    restart: unless-stopped
    ports:
      - "127.0.0.1:8081:8081"       # 仅本机调试用；公网流量走 web 反代
    environment:
      - SPRING_PROFILES_ACTIVE=${SPRING_PROFILES_ACTIVE:-demo}
      - LIVE_AUTH_MODE=${LIVE_AUTH_MODE:-internal}
      - LIVE_JWT_SECRET=${LIVE_JWT_SECRET:?请在 .env 中设置强随机密钥}
      - LIVE_ADMIN_USER=${LIVE_ADMIN_USER:-admin}
      - LIVE_ADMIN_PASSWORD=${LIVE_ADMIN_PASSWORD:?请在 .env 中设置管理员密码}
      - LIVE_PLAY_URL_MODE=${LIVE_PLAY_URL_MODE:-host}
      - LIVE_PUBLIC_BASE_URL=${LIVE_PUBLIC_BASE_URL:}
    volumes:
      - livedemo-data:/app/data

  web:
    build: ./web
    container_name: livedemo-web
    restart: unless-stopped
    ports:
      - "${WEB_BIND:-0.0.0.0}:3000:80"   # 宝塔/1Panel 反代目标：http://127.0.0.1:3000
    depends_on:
      - live-service

volumes:
  livedemo-data:
```

- [x] **Step 2: .env.example**

```bash
# 复制为 .env 并修改；.env 已被 .gitignore 排除
# WebRTC 候选地址：公网部署必须填服务器公网 IP
SRS_CANDIDATE=127.0.0.1
# JWT 签发密钥：至少 32 字节随机串的 Base64（生成：openssl rand -base64 32）
LIVE_JWT_SECRET=
# 管理员引导账号（internal 模式）
LIVE_ADMIN_USER=admin
LIVE_ADMIN_PASSWORD=
# 播放地址模式：host=本地开发；base=公网 HTTPS（填域名）
LIVE_PLAY_URL_MODE=host
LIVE_PUBLIC_BASE_URL=
```

注意 `.env` 检查：确认根 `.gitignore` 已含 `.env`（M1 Task 0 已加）。

- [x] **Step 3: docs/deploy.md**（完整两套步骤，直接可执行）

内容要点（写入文档）：
1. **前置**：域名 A 记录 → 服务器 IP；防火墙/安全组放行 `443/tcp`、`1935/tcp`、`8000/udp`；**不开放** 1985/8080/3000/8081 公网
2. **安装**：服务器装 Docker + Compose → 克隆代码 → `cp .env.example .env` → 填 `SRS_CANDIDATE=<公网IP>`、`LIVE_JWT_SECRET=<openssl rand -base64 32>`、`LIVE_ADMIN_PASSWORD`、`LIVE_PLAY_URL_MODE=base`、`LIVE_PUBLIC_BASE_URL=https://你的域名` → `docker compose up -d --build`
3. **宝塔反代**：网站 → 添加站点（域名，PHP 纯静态即可）→ SSL → Let's Encrypt 申请并开启强制 HTTPS → 反向代理 → 目标 `http://127.0.0.1:3000`，**务必开启 WebSocket 支持**（发送域名 `$host`）
4. **1Panel 反代**：网站 → 创建网站-反向代理 → 代理地址 `http://127.0.0.1:3000` → 证书申请 Let's Encrypt → 修改反代配置文件加入：
   ```nginx
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   proxy_read_timeout 3600s;
   ```
5. **验证清单**：浏览器打开 https://域名 → 注册账号 → 建房 → OBS 推 `rtmp://服务器IP:1935/live/<推流码>` → 观众看播/弹幕/加购；确认无混合内容告警
6. **常见问题**：WebRTC 黑屏 → 检查 CANDIDATE 与 8000/udp；弹幕连不上 → 反代未开 WebSocket；证书续期由面板自动处理
7. **数据**：房间/商品存 H2 卷 `livedemo-data`；弹幕与在线人数不持久（demo 语义）

- [x] **Step 4: README 部署段**追加一行指向 `docs/deploy.md`；Commit `feat(deploy): 端口收敛/.env 化与宝塔、1Panel 部署文档`

---

### Task 4: 全量回归

- [x] **Step 1:** `cp .env.example .env`（本地默认值可跑：host 模式 + 默认密钥）→ `docker compose up -d --build`（timeout 600000）→ 三容器 Up。
- [x] **Step 2:** 回归三件套：`./scripts/mvn.ps1 test`、`cd web && npm test`、`npm run e2e`（smoke 2 + flows 3 + account ≥2）——全绿。
- [x] **Step 3:** 手动反代模拟（可选）：本机用 nginx/caddy 将一个假域名指 3000 验证 WebSocket 透传——如无环境则依赖 Task 2 的 /rtc /live 反代验证 + e2e（已覆盖 /api /ws 链路），在计划文件验证记录注明。
- [x] **Step 4:** 计划勾选 + 验证记录；如无代码改动跳过提交。

---

## 验证记录（2026-09-04 执行）

- **Task 1**：PlayUrlsModeTest 先红（host 模式输出 `http://localhost:1985/...`）后绿；全量 mvn `Tests run: 55, Failures: 0, Errors: 0`（54 + 1）。偏差：计划示例的 `TestTokens` 实际位于 `com.livedemo.live.auth` 包（import 已修正），并按仓库惯例补 `@ActiveProfiles("demo")`。
- **Task 2**：重建 web 后，经宿主机 3000 反代 ffprobe `http://localhost:3000/live/room-0ab191d3.flv` 实际输出 `aac`,`h264`（本机无 ffprobe，用 jrottenberg/ffmpeg:6-alpine 容器打 `host.docker.internal:3000`，等价命中宿主机 3000 发布端口）；WHEP `curl.exe POST` 伪 SDP 返回 **502**（非 404），SRS 日志出现 `srs_app_rtc_api.cpp do_serve_http → check_remote_sdp` 处理记录，佐证 `/rtc/` 反代已到达 SRS。
- **Task 3**：compose 终稿生效（`docker compose config` 实测 host_ip：1985/8080/8081 → 127.0.0.1，1935/8000udp/3000 → 0.0.0.0）；`.gitignore` 已含 `.env`，`.env` 未入库。偏差：计划片段 `${LIVE_PUBLIC_BASE_URL:}` 为非法 compose 插值语法，改为 `${LIVE_PUBLIC_BASE_URL:-}`；`.env.example` 增补 `WEB_BIND`/`SRS_UDP_BIND` 可选注释项。
- **Task 4 回归**：mvn **55/55 绿**；vitest **6/6 绿**；playwright **7/7 绿**（smoke 2 + flows 3 + account 2）。三容器 Up（livedemo-srs / livedemo-api / livedemo-web），端口绑定收敛生效，e2e 走 3000 反代无影响（仅 flows.spec 直连 `localhost:8081` 打 SRS hook，127.0.0.1 绑定下可达）。
- **Task 4 Step 3（可选反代模拟）**：本机无 nginx/caddy 假域名环境，未执行；WebSocket 透传由 e2e 的 `/ws` 链路（wss→web nginx→live-service，弹幕用例）与 Task 2 的 `/rtc`/`/live` 反代验证共同覆盖。
- 提交：`a642359` play-urls base 模式 / `817ff19` web nginx 反代 / `684ce23` deploy 端口收敛与部署文档；计划勾选与验证记录见 `20bfcb5`（本条为补全后的完整记录）。

---

## 自审记录

- 设计增量覆盖：play-urls 同源化（base 模式）✓；宝塔/1Panel 反代兼容（web nginx 承担 /rtc /live，面板只代理一个端口）✓；CANDIDATE/密钥/管理员账号 env 化 + 弱配置拒绝启动（LIVE_JWT_SECRET `:?` 语法）✓；端口收敛 ✓；deploy 文档 ✓
- 本地零影响：默认值全部回落到现状（host 模式 / 127.0.0.1 / demo profile）✓
- 类型一致性：PlayUrls 三字段名不变，仅取值来源变化；前端零改动 ✓
