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
2. 以 HOST 身份创建房间进入直播间 → 点悬浮工具条「摄像头」或「共享屏幕」**网页直接开播**（麦克风可一键静音，画面源切换不闪断）→ 房间自动转「直播中」
3. 以 VIEWER 身份进入直播间：WebRTC 播放（<1s），失败自动降级 HTTP-FLV；发弹幕聊天
4. 主播在「选品」Tab 挂平台商品 → 观众端小黄车实时更新 → 商品整卡直达详情链接
5. 主播可禁言/删弹幕/结束直播；ADMIN 在 `/admin` 强制关播、封禁用户
6. 点「结束直播」→ 房间自动回到「未开播」

### 兼容外部推流（可选，无需在页面上操作）

页面不展示任何推流码/推流地址；如需用 OBS 或 ffmpeg 推流，可自行调 `POST /api/rooms` 获取 room 的 streamKey 后：

```bash
ffmpeg -re -i test.mp4 -c copy -f flv rtmp://localhost:1935/live/{streamKey}
```

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
