# LiveDemo 设计文档

日期：2026-09-03
状态：待评审（v2，新增 SSO / 商品购物车 / 直播间管理）

## 1. 背景与目标

为现有产品（后端含 SpringBoot 与 Next.js 两种生态）增加直播能力，先以 Demo 验证完整链路：

- 多房间：房间创建、房间列表、开播/关播状态管理
- 播放：观众端低延迟拉流播放（WebRTC 优先，HTTP-FLV 兜底）
- 互动：弹幕/聊天、在线人数
- **电商**：商品链接同步（小黄车）、购物车、购物列表——先自建后对接现有系统
- **认证**：SSO 集成，多认证机制可插拔，JWT 首选
- **管理**：主播管理工具、平台管理后台、内容安全（敏感词/频控/禁言/封禁）
- 推流：OBS / ffmpeg 通过 RTMP 推流
- 架构要求：视频服务器与前端分离；直播业务为**独立微服务**，API 语言无关，可被多生态系统接入

### 选型结论

| 决策 | 结论 | 理由 |
|---|---|---|
| 流媒体服务器 | SRS（裸用，非 Oryx） | Oryx 是带自带 UI 的全家桶应用，其直播间页无弹幕、无电商、UI 不可嵌入现有产品；自建前端场景下 Oryx 省不掉任何必写代码。SRS 作为无 UI 假设的纯组件，HTTP API + 回调即可完成全部对接 |
| 直播业务后端 | Spring Boot 3 独立微服务 | 与 SpringBoot 生态同栈可平移合并；对 Next.js 侧只暴露 REST + WS，语言无关 |
| 前端 | React 18 + Vite | 组件可平移进 Next.js；demo 启动快 |
| 电商域 | live-service 自建 + 防腐层 | demo 独立闭环；接入期仅替换 ACL 实现为现有系统 API 调用 |

## 2. 总体架构

```
OBS/ffmpeg ──RTMP:1935──► SRS 容器 ◄──http_hooks(开播/关播回调)── live-service(Spring Boot:8081)
                            │  ▲                                    │
                            │  └──── HTTP API :1985(流状态查询) ─────┤
              WebRTC:1985信令+8000/udp / HTTP-FLV,HLS:8080          │
                            │                                      │
              web(React+Vite, nginx:3000) ──/api,/ws 反代────────────┤
                                                                   │
                       ┌───────────────────────────────────────────┤
                       │ live-service 内部模块：                      │
                       │  认证(AuthProvider SPI: JWT/网关头)          │
                       │  房间域(状态机+回调)  弹幕域(WS+内容安全)      │
                       │  电商域(ACL: 商品/小黄车/购物车)  管理域       │
                       └───────────────────────────────────────────┘
```

组件职责：

- **SRS**：只做流媒体。收 RTMP，出 WebRTC(WHEP)/HTTP-FLV/HLS。不感知房间、商品、用户业务。
- **live-service**：唯一的业务/集成点。认证、房间、弹幕、电商（经 ACL）、管理与内容安全。
- **web**：纯展示与交互。不知晓 SRS 内部细节，播放地址一律从 live-service 获取。

## 3. 认证与角色（SSO）

### 3.1 AuthProvider SPI

```java
public interface AuthProvider {
    AuthUser authenticate(String credential);   // 返回 userId + roles，失败抛异常
    AuthMode mode();                            // JWT / GATEWAY_HEADER
}
```

| 模式 | 机制 | 说明 |
|---|---|---|
| **jwt（默认，首选）** | `Authorization: Bearer <JWT>`，spring-security-oauth2-resource-server 验签 | 同时支持 HS256（配置对称密钥）与 RS256（配置 JWK Set URI），覆盖多数现有系统 |
| **gateway** | 网关/认证中心完成认证后透传 `X-User-Id` + `X-User-Roles` 头 | 适用于现有流量都过统一网关的场景，live-service 只信任内网来源 |

通过 `live.auth.mode` 配置切换，接入现有系统时按其实际机制选择；两种模式共用同一套 `AuthUser` 上下文，业务代码无感知。

### 3.2 Demo 签发

仅 `demo` profile 启用：`POST /api/auth/dev-token {userId, nickname, roles}` → 用本地 HS256 密钥签发测试 JWT。前端登录弹窗调用它，链路与真实 JWT 完全一致（同样走验签），接入期关闭该端点即可。

### 3.3 角色与权限矩阵

| 能力 | VIEWER | HOST | ADMIN |
|---|---|---|---|
| 进房、发弹幕、看小黄车 | ✓ | ✓ | ✓ |
| 购物车读写（本人） | ✓ | ✓ | ✓ |
| 创建房间 | | ✓ | ✓ |
| 房间设置、挂/摘商品、禁言、删弹幕、结束直播（限本人房间） | | ✓ | ✓ |
| 平台后台：全量房间、强制关播、封禁/解封用户 | | | ✓ |

## 4. SRS 设计

### 4.1 部署与端口

镜像 `ossrs/srs:5`，端口规划（宿主机）：

| 端口 | 协议 | 用途 |
|---|---|---|
| 1935/tcp | RTMP | 推流 |
| 1985/tcp | HTTP | SRS HTTP API + WebRTC 信令(WHEP) + http_hooks 回调目标 |
| 8080/tcp | HTTP | HTTP-FLV / HLS 播放 |
| 8000/udp | WebRTC | 媒体传输 |

### 4.2 srs.conf 要点

```conf
http_server { listen 8080; }
http_api { listen 1985; }
rtc_server { listen 8000; candidate $CANDIDATE; }
vhost __defaultVhost__ {
    # 注意：SRS 5 中回调配置为 http_hooks（复数）且必须置于 vhost 内；
    # 放在 http_api 内的 http_hook 会被静默忽略
    http_hooks {
        enabled         on;
        on_publish      http://live-service:8081/api/v1/srs/hooks;
        on_unpublish    http://live-service:8081/api/v1/srs/hooks;
    }
    rtc { enabled on; rtmp_to_rtc on; }
    hls { enabled on; }
}
```

部署注意：`ossrs/srs:5` 镜像以 `conf/docker.conf` 启动，compose 挂载须覆盖该文件（`./srs/srs.conf:/usr/local/srs/conf/docker.conf`），挂到 `conf/srs.conf` 不会生效。

说明：

- `rtmp_to_rtc on`：RTMP 推流自动转 WebRTC 可播，观众无需分别推流
- 回调只订阅 `on_publish` / `on_unpublish` 两个事件，用于驱动房间状态机。不使用 `on_close`：该事件对播放连接同样触发，观众断开会导致房间被误标为未开播
- demo 不启用 SRS 端鉴权，推流合法性由 `on_publish` 回调校验 streamKey 实现

### 4.3 推拉流地址规则

- 推流：`rtmp://{SRS_HOST}:1935/live/{streamKey}`
- WebRTC 播放（WHEP）：`http://{SRS_HOST}:1985/rtc/v1/whep/?app=live&stream={streamKey}`
- HTTP-FLV：`http://{SRS_HOST}:8080/live/{streamKey}.flv`
- HLS：`http://{SRS_HOST}:8080/live/{streamKey}.m3u8`

`{streamKey}` 由 live-service 生成（`room-{id}-{8位随机}`），是房间与流的关联键。

## 5. live-service 设计（Spring Boot 3 / Java 17）

### 5.1 数据模型

```sql
-- 房间
CREATE TABLE room (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    title       VARCHAR(128) NOT NULL,
    owner_id    VARCHAR(64)  NOT NULL,          -- 主播 userId（认证态）
    owner_name  VARCHAR(64)  NOT NULL,
    stream_key  VARCHAR(64)  NOT NULL UNIQUE,
    status      VARCHAR(16)  NOT NULL DEFAULT 'IDLE',   -- IDLE / LIVING
    created_at  DATETIME     NOT NULL
);

-- 商品（live-service 自建；接入期由 ACL 替换为现有系统商品库）
CREATE TABLE product (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner_id    VARCHAR(64)  NOT NULL,          -- 商品归属主播
    title       VARCHAR(128) NOT NULL,
    price       DECIMAL(10,2) NOT NULL,
    image_url   VARCHAR(255),
    detail_url  VARCHAR(255),
    stock       INT          NOT NULL DEFAULT 0,
    created_at  DATETIME     NOT NULL
);

-- 直播间商品挂载（小黄车）
CREATE TABLE room_product (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    room_id     BIGINT NOT NULL,
    product_id  BIGINT NOT NULL,
    sort        INT    NOT NULL DEFAULT 0,
    added_at    DATETIME NOT NULL,
    removed_at  DATETIME,                  -- 摘除 = 软删
    UNIQUE KEY uk_room_product (room_id, product_id)
);

-- 购物车（购物列表）
CREATE TABLE cart_item (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     VARCHAR(64) NOT NULL,
    product_id  BIGINT NOT NULL,
    qty         INT NOT NULL DEFAULT 1,
    UNIQUE KEY uk_user_product (user_id, product_id)
);

-- 平台封禁
CREATE TABLE banned_user (
    user_id     VARCHAR(64) PRIMARY KEY,
    reason      VARCHAR(255),
    banned_at   DATETIME NOT NULL
);
```

内存态（不落库，随房间生命周期）：

- 弹幕：每房间最近 50 条环形队列（含 messageId，支持删除广播）
- 房间禁言：`Map<roomId, Map<userId, untilTs>>`
- 在线人数：每房间 WebSocket 连接数

### 5.2 防腐层（ACL）——先自建后对接的关键

```java
// 电商域统一接口，业务代码只依赖接口
public interface ProductCatalog {
    Product create(ProductDraft draft, String ownerId);
    List<Product> listByOwner(String ownerId);
    Product get(long productId);
}
public interface CartService {
    List<CartItem> list(String userId);                      // 购物列表
    CartItem add(String userId, long productId, int qty);    // 加购
    CartItem updateQty(String userId, long itemId, int qty);
    void remove(String userId, long itemId);
}
```

- demo 实现：`LocalProductCatalog` / `LocalCartService` 直接读写上面的表
- 接入期实现：`RemoteProductCatalog` / `RemoteCartService` 调现有系统 HTTP API（商品库、购物车、下单）
- 切换仅改 `@Primary` Bean / 配置，Room 控制器、WS 推送、前端全部零改动

### 5.3 REST API 契约

统一前缀 `/api`，响应 `{ code, message, data }`。认证：JWT 模式走 `Authorization` 头，gateway 模式走透传头；未认证返回 401，权限不足返回 403。

**认证（仅 demo profile）**

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/auth/dev-token` | 签发测试 JWT `{userId, nickname, roles}` |

**房间**

| Method | Path | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/rooms` | HOST | 创建房间 `{title}` → 房间信息 + 推流地址 + streamKey |
| GET | `/api/rooms?status=LIVING` | 公开 | 房间列表（含 viewerCount、商品数） |
| GET | `/api/rooms/{id}` | 公开 | 房间详情 |
| PATCH | `/api/rooms/{id}` | HOST 本人 | 修改标题等 |
| POST | `/api/rooms/{id}/end` | HOST 本人 | 结束直播（置 IDLE） |
| DELETE | `/api/rooms/{id}` | HOST 本人 / ADMIN | 关闭并删除房间 |
| GET | `/api/rooms/{id}/play-urls` | 公开 | `{webrtc, flv, hls}` 播放地址（按请求 Host 或配置的公网域名拼装） |

**小黄车 / 商品**

| Method | Path | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/rooms/{id}/products` | 公开 | 在架商品列表（按 sort 排序） |
| POST | `/api/rooms/{id}/products` | HOST 本人 | 挂载商品 `{productId, sort}`，WS 广播 `product_update` |
| DELETE | `/api/rooms/{id}/products/{productId}` | HOST 本人 | 摘除（软删），WS 广播 |
| GET | `/api/products` | HOST 本人 | 我的商品库 |
| POST | `/api/products` | HOST / ADMIN | 创建商品 |

**购物车（购物列表）**

| Method | Path | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/cart` | 登录 | 我的购物列表 |
| POST | `/api/cart/items` | 登录 | 加购 `{productId, qty}` |
| PATCH | `/api/cart/items/{itemId}` | 登录本人 | 改数量 |
| DELETE | `/api/cart/items/{itemId}` | 登录本人 | 移除 |

**弹幕管理（主播工具）**

| Method | Path | 权限 | 说明 |
|---|---|---|---|
| DELETE | `/api/rooms/{id}/messages/{messageId}` | HOST 本人 / ADMIN | 删弹幕，WS 广播 `message_deleted` |
| POST | `/api/rooms/{id}/mutes` | HOST 本人 / ADMIN | 禁言 `{userId, durationSec}`，WS 定向通知 |
| DELETE | `/api/rooms/{id}/mutes/{userId}` | HOST 本人 / ADMIN | 解除禁言 |

**平台后台**

| Method | Path | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/admin/rooms` | ADMIN | 全量房间（任意状态） |
| POST | `/api/admin/rooms/{id}/force-close` | ADMIN | 强制关播：置 IDLE、WS 广播、记录操作人；主播可重新开播 |
| POST | `/api/admin/users/{userId}/ban` | ADMIN | 封禁 `{reason}`：立即断其 WS、拒绝登录/发言/加购 |
| DELETE | `/api/admin/users/{userId}/ban` | ADMIN | 解封 |

**内部接口**

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/v1/srs/hooks` | SRS 回调入口，校验来源（仅容器网络）后处理 |

### 5.4 SRS 回调处理（房间状态机）

SRS 回调 POST body 携带 `action, app, stream, param`：

1. `on_publish`：按 `stream` 反查 streamKey → 命中则置房间 `LIVING`，广播房间状态事件；**未命中返回非 200 拒绝推流**（非法推流防护）
2. `on_unpublish`：置回 `IDLE`，广播状态事件

### 5.5 WebSocket 设计

- 端点：`/ws?roomId={id}&token=<JWT>`。浏览器原生 WebSocket 无法携带自定义请求头，JWT 统一通过 `token` 查询参数传递；gateway 模式下由 nginx 反代注入 `X-User-Id` 头。握手认证失败直接关闭连接
- 客户端 → 服务端：`{"type":"chat","content":"..."}`
- 服务端 → 客户端：

| type | 载荷 | 说明 |
|---|---|---|
| `history` | `{messages:[50条]}` | 新连接时下发 |
| `chat` | `{messageId, userId, nickname, content, ts}` | 弹幕/聊天 |
| `presence` | `{viewers, users}` | 在线人数与名单 |
| `room_status` | `{status}` | 开播/关播 |
| `product_update` | `{action: add/remove, product}` | 小黄车实时同步 |
| `message_deleted` | `{messageId}` | 弹幕被删 |
| `muted` | `{durationSec}` | 定向通知被禁言者 |
| `error` | `{code, message}` | 发言被拒（禁言/频控/敏感词拦截提示） |

- 频控（服务端强制）：单连接每秒最多 5 条发言，超频回 `error` 并丢弃

### 5.6 内容安全

- **敏感词**：DFA 词树，词库文件 `sensitive-words.txt` 可热更新；命中默认替换为 `***`（可配置为拒绝）
- **频控**：见 5.5
- **禁言**：主播/管理员房间级禁言（内存，随房间销毁）；平台级封禁落库，覆盖所有房间
- **封禁联动**：`ban` 时立即关闭该用户所有 WS 连接，`AuthProvider` 后续校验直接拒绝

### 5.7 错误处理

| 场景 | 处理 |
|---|---|
| 非法 streamKey 推流 | on_publish 返回 403，SRS 拒绝推流 |
| SRS 回调不可达 | SRS 自带重试；房间状态由下次回调兜底修正 |
| WS 断线 | 前端指数退避重连（1s/2s/4s，上限 30s），重连后重新拉房间状态、历史消息与小黄车 |
| 观众拉流失败 | 播放器 WebRTC → HTTP-FLV 自动降级，再失败展示重试按钮 |
| 加购商品已被摘除 | 商品快照校验：小黄车中已软删的商品加购返回 400 明确提示 |
| JWT 过期/无效 | 401，前端引导重新登录 |

## 6. web 设计（React 18 + Vite）

### 6.1 页面

- `/` 房间列表：直播中房间卡片网格（标题/主播/在线人数/商品数），「创建房间」弹窗（返回推流地址+推流码）
- `/rooms/:id` 直播间：
  - 左：播放器（16:9）+ 弹幕层
  - 右：Tab 切换【聊天】【商品（小黄车）】；购物车图标（角标数量）唤起购物列表抽屉
  - 主播视角附加管理面板：挂/摘商品选择器、禁言/删弹幕操作、结束直播
- `/admin` 平台后台：全量房间表（强制关播）、用户封禁管理
- 登录：demo profile 下弹窗输入 userId/昵称/角色 → 调 dev-token 签发，token 存 localStorage

### 6.2 播放器策略

1. 优先 WebRTC：原生 `RTCPeerConnection` 走 WHEP（SRS 标准信令，无需额外库），延迟 <1s
2. 失败/超时 3s → 降级 mpegts.js 拉 HTTP-FLV（延迟 2~3s）
3. 播放地址由 `GET /api/rooms/{id}/play-urls` 下发，前端不硬编码 SRS 地址

### 6.3 弹幕与购物车组件

- 聊天消息在播放器上方以横向滚动弹幕渲染（纯 CSS 动画，随机轨道），右侧聊天列表同步；被 `message_deleted` 的消息即时移除
- 小黄车收到 `product_update` 实时增删，加购后角标数量与购物列表实时一致
- 组件化：`Player`、`DanmakuLayer`、`ChatPanel`、`ProductShelf`、`CartDrawer` 相互独立，可单独平移进 Next.js

## 7. 编排与部署（docker-compose）

| 服务 | 端口映射 | 说明 |
|---|---|---|
| srs | 1935, 1985, 8080, 8000/udp | 挂载 `srs/srs.conf` |
| live-service | 8081 | 多阶段构建，JRE 17 运行 |
| web | 3000 → nginx | 静态产物；nginx 将 `/api`、`/ws` 反代到 `live-service:8081` |

服务发现依赖 compose 网络别名（`live-service`、`srs`）。SRS 回调 URL 指向容器内地址 `http://live-service:8081/...`，浏览器侧一律走 web 的 nginx 代理，避免跨域与端口暴露。

## 8. 测试策略

- live-service 单元测试：房间状态机与回调处理（模拟 SRS 回调 body）、ACL 电商逻辑（加购/去重/摘除校验）、AuthProvider（JWT 验签/过期/角色）、敏感词 DFA
- 集成验证（手动）：compose 起全栈 → ffmpeg 推流 → 房间转 LIVING → 浏览器播放 + 双开弹幕互见 → 主播挂商品观众实时可见 → 加购出现在购物列表 → 停推 → 房间回 IDLE
- 前端：Playwright 冒烟（登录、房间列表、创建房间、进房、加购）

## 9. 里程碑

1. **M1 链路打通**：SRS 容器 + ffmpeg 推流 + srs_player 播放验证
2. **M2 live-service 核心**：认证 SPI（JWT+dev-token）+ 房间 CRUD + 回调状态机 + WS 弹幕
3. **M3 电商域**：商品/小黄车/购物车（ACL 自建实现）+ product_update 推送
4. **M4 管理与内容安全**：主播工具、平台后台、敏感词/频控/禁言/封禁
5. **M5 web 前端**：全部页面（登录、列表、直播间、购物车、后台）
6. **M6 编排**：docker-compose 一键起 + Playwright 冒烟

## 10. 非目标（YAGNI）

- 不做真实支付/订单/库存扣减（购物列表仅做同步展示，下单经 ACL 留给现有系统）
- 不做多租户
- 不做弹幕持久化、消息漫游
- 不做录像 DVR、转码、连麦、跨平台转发
- 不做 CDN 分发与集群（SRS 单机足够 demo）
- 不做美颜/滤镜等推流端增强
- 管理后台不做细粒度 RBAC（仅 HOST/ADMIN 两级）
