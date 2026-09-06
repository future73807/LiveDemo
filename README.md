# LiveDemo — 直播间 Demo（带电商与管理）

基于 **SRS** 流媒体服务器 + **Spring Boot 直播微服务** + **React 前端** 的多房间直播间演示项目。

功能：多房间直播、弹幕/聊天、在线人数、**商品链接同步（小黄车）/商品详情直达**、**网页直接开播（摄像头/麦克风/屏幕共享，腾讯会议式）**、**SSO 认证（JWT 首选，多机制可插拔）**、**主播管理工具 / 平台管理后台 / 内容安全**。

> 设计原则：视频服务器（SRS）与前端完全分离；直播业务做成**独立微服务**，只暴露语言无关的 REST + WebSocket API，可被 SpringBoot 系统、Next.js 系统或任何生态直接接入。电商域经防腐层（ACL）先自建闭环，接入期切换为现有系统 API，业务代码零改动。主播开播走浏览器 WHIP，无需推流码与 OBS。

## 架构

```
┌──────────┐  RTMP 推流(1935)  ┌──────────────┐  HTTP 回调(开播/关播)  ┌─────────────────────┐
│ OBS/ffmpeg│ ───────────────► │ SRS 容器      │ ────────────────────► │ live-service        │
│ (可选外部) │ ◄─ WHIP ──────── │ ossrs/srs:5  │                       │ (Spring Boot 3)     │
└──────────┘    ▲网页开播        │ HTTP API 1985│ ◄──────────────────── │ · 认证(JWT/网关头)    │
                │               └──────┬───────┘   HTTP API(流状态查询)  │ · 房间+回调状态机     │
                └─────────────────────┬┘       WebRTC/FLV/HLS 拉流     │ · 弹幕 WS+内容安全    │
                              ┌──────▼─────────────────────────┐    │ · 电商(ACL: 商品/    │
                              │ web (React + Vite)             │◄──►│   小黄车/直达链接)   │
                              │ 房间列表 / 播放页 / 弹幕 /        │    │ · 主播工具/管理后台   │
                              │ 网页开播 / 小黄车 / 管理后台      │    └─────────────────────┘
                              └────────────────────────────────┘
```

| 组件 | 技术 | 职责 |
|---|---|---|
| **srs** | `ossrs/srs:5`（Docker） | 流媒体收发：WHIP/RTMP 收流，WebRTC / HTTP-FLV / HLS 拉流 |
| **live-service** | Spring Boot 3 / Java 17 | 认证、房间管理、SRS 回调、弹幕 WS、商品（ACL）、管理与内容安全 |
| **web** | React 18 + Vite | 房间列表、直播间（网页开播+播放器+弹幕+小黄车）、管理后台 |

详细设计见 [docs/design.md](docs/design.md)。

## 快速开始

### 前置要求

- Docker + Docker Compose
- 摄像头/麦克风（可选，纯屏幕共享开播则无需）

### 启动

```bash
docker compose up -d --build
```

> 首次启动需复制 `.env.example` 为 `.env` 并填写 JWT 密钥与管理员密码（变量缺失会拒绝启动）。

| 服务 | 地址 |
|---|---|
| 前端页面 | http://localhost:3000 |
| live-service API | http://localhost:8081/api |
| SRS HTTP API | http://localhost:1985 |
| SRS 播放器测试页 | http://localhost:8080/players/srs_player.html |

公网服务器部署（域名 + HTTPS + 宝塔/1Panel 反代）见 [docs/deploy.md](docs/deploy.md)。

### 体验流程

1. 打开前端页面 → 登录弹窗输入 userId/昵称/角色（demo 签发测试 JWT，链路与真实 JWT 一致）
2. 以 HOST 身份创建房间进入直播间 → 悬浮工具条三源独立开关，**网页直接开播**：麦克风可单独开播（纯音频直播）；摄像头与共享屏幕可同屏合成（屏幕全屏 + 摄像头画中画）；共享屏幕可同时分享系统声音；开关任意组合、切换不闪断 → 房间自动转「直播中」
3. 以 VIEWER 身份进入直播间：WebRTC 播放（<1s），失败自动降级 HTTP-FLV；发弹幕聊天
4. 主播在「选品」Tab 挂平台商品 → 观众端小黄车实时更新 → 商品整卡直达详情链接
5. 主播可禁言/删弹幕/结束直播；ADMIN 在 `/admin` 强制关播、封禁用户
6. 点「结束直播」→ 房间自动回到「未开播」

### 兼容外部推流（可选，无需在页面上操作）

页面不展示任何推流码/推流地址；如需用 OBS 或 ffmpeg 推流，可自行调 `POST /api/rooms` 获取 room 的 streamKey 后：

```bash
ffmpeg -re -i test.mp4 -c copy -f flv rtmp://localhost:${SRS_RTMP_PORT:-1935}/live/{streamKey}
```

## 嵌入模式（iframe 集成到宿主系统）

直播间整页可嵌入现有系统的 iframe，无站点顶栏/登录弹窗，铺满 iframe 视口。

### 快速接入

```html
<!-- 1. 用后端签发的 JWT（任意认证模式）拼 iframe 地址 -->
<iframe
  src="https://你的域名/rooms/1?token=<JWT>&embed=1"
  style="width:100%;height:100%;border:0"></iframe>
```

- `?token=<JWT>`：注入登录态后自动从 URL 摘除，前端调 `GET /api/auth/me` 确认身份（internal/jwt/gateway 三种认证模式通用）
- `?embed=1`：隐藏顶栏与登录弹窗，直播间铺满 iframe（桌面/移动端响应式）

### postMessage 双通道（宿主页 ↔ 直播间）

```html
<script>
  const iframe = document.querySelector('iframe');

  // 1) 直播间就绪 / 房间状态变化 → 宿主页接收
  window.addEventListener('message', e => {
    if (e.data?.type === 'livedemo-ready')       console.log('直播间已就绪');
    if (e.data?.type === 'livedemo-room-status') console.log('房间状态:', e.data.status); // LIVING | IDLE
  });

  // 2) 登录态过期后 → 宿主页重新注入新 token（无需刷新 iframe）
  function refreshLiveToken(newJwt) {
    iframe.contentWindow.postMessage({ type: 'livedemo-auth', token: newJwt }, '*');
  }
</script>
```

| 消息 | 方向 | 载荷 |
|---|---|---|
| `livedemo-ready` | 直播间 → 宿主 | 骨架就绪，可以开始发 auth |
| `livedemo-room-status` | 直播间 → 宿主 | `{status: 'LIVING'\|'IDLE'}` |
| `livedemo-auth` | 宿主 → 直播间 | `{token: '<JWT>'}`，重新注入登录态 |

### 嵌入注意事项

- token 过期/非法：直播间会显示"登录态已失效"提示，宿主页应监听状态并重新签发 JWT 后走 `livedemo-auth` 注入
- iframe 高度建议占满视口或容器（直播间内部自适应，页面不滚动）

## 网页开播要求与排错

开播（摄像头/麦克风/屏幕共享）全部走浏览器 WebRTC（WHIP 推流），**必须满足**：

1. **安全上下文**：`localhost` 可用 HTTP；其余地址必须 HTTPS，否则 `getUserMedia` 直接不可用（浏览器不弹授权）
2. **浏览器授权**：首次点「摄像头/共享屏幕」时允许权限；拒绝后需进浏览器站点设置重置
3. **SRS 端口可达**：播放/推流走 `localhost:<SRS_API_PORT>`（本地）或同源反代 `/rtc/`（公网 base 模式）

常见故障对照：

| 现象 | 原因 | 处理 |
|---|---|---|
| 报错 `Cannot read properties of undefined (reading 'getDisplayMedia'/'getUserMedia')` | 通过**非 localhost 的 HTTP 地址**访问（如 `http://192.168.x.x:3002`），浏览器判定非安全上下文，整体禁用摄像头/麦克风/屏幕共享 | 改用 `http://localhost:<端口>` 访问；跨设备访问必须部署 HTTPS（见 docs/deploy.md），页面上也会显示同样的黄色提示 |
| 点摄像头报"打开设备失败" | 非 HTTPS 环境或无摄像头 | 用 localhost 访问或部署 HTTPS；共享屏幕无需摄像头 |
| "WHIP 推流失败: 404/超时" | SRS API 端口不通 | 检查 srs 容器状态与 `SRS_API_PORT` 映射；混合内容（HTTPS 页面拉 HTTP 推流地址）时改用 `base` 播放地址模式 |
| 画面卡住不出帧 | WebRTC 候选地址不通 | 多网卡/虚拟网卡机器把 `.env` 的 `SRS_CANDIDATE` 改为本机局域网 IP |
| 本机端口被占用/被保留 | Hyper-V 保留区段或其他应用 | `.env` 重映射：`SRS_API_PORT`/`SRS_HTTP_PORT`/`SRS_RTMP_PORT`/`WEB_PORT`（live-service 自动跟随拼接地址） |
| 观众看得到听不到/黑屏 | 编解码或降级链路 | 自动降级 HTTP-FLV；确认 SRS 的 8080（或映射端口）可访问 |

## 与现有产品集成（多生态）

live-service 是唯一的集成点：

- **SpringBoot 系统**：直接 HTTP 调用 REST API，或将其纳入网关路由
- **Next.js 系统**：`fetch` 调 REST；弹幕/商品推送用原生 WebSocket；也可在 `next.config.js` 加 rewrite 代理
- **前端组件**：`Player`、`DanmakuLayer`、`ChatPanel`、`ProductShelf`、`MeetingStage` 均为独立 React 组件，可平移进 Next.js 页面

### 认证接入

| 模式 | 机制 | 适用 |
|---|---|---|
| `jwt`（默认） | Bearer JWT 验签，支持 HS256 密钥与 RS256 JWK Set URI | 现有系统直接签发 JWT |
| `gateway` | 网关认证后透传 `X-User-Id`/`X-User-Roles` 头 | 流量统一过认证网关 |

配置 `live.auth.mode` 切换；demo profile 的 dev-token 签发端点接入期关闭。

### 电商接入

商品与购物车 demo 期为 live-service 自建表实现；正式接入时将 ACL 实现（`ProductCatalog` / `CartService`）替换为现有系统商品库/购物车 API 的 HTTP 客户端即可，API 契约与前端不变。

## 目录结构（规划）

```
LiveDemo/
├── docker-compose.yml
├── srs/
│   └── srs.conf              # SRS 配置（含 http_hooks 回调）
├── live-service/             # Spring Boot 微服务
│   ├── Dockerfile
│   └── src/main/java/...
├── web/                      # React + Vite 前端
│   ├── Dockerfile
│   └── src/...
└── docs/
    └── design.md             # 设计文档
```
