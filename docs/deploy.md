# 公网部署指南（宝塔 / 1Panel 兼容）

目标：把 LiveDemo 部署到一台有公网 IP 的服务器，用域名 + HTTPS 对外提供服务。TLS 证书由宝塔/1Panel 面板的反向代理承担，**容器内不做 TLS**，面板只代理一个端口 `3000`。

> 无备案域名时可直接用 `https://服务器IP` + 自签证书对外服务，见[第 8 节](#8-无备案-ip-直连模式自签-ip-证书)。

流量模型：

```
观众浏览器 ──https://你的域名──► 宝塔/1Panel(443) ──http://127.0.0.1:3000──► web 容器(nginx)
                                                                    ├─ /     → 前端静态页
                                                                    ├─ /api  → live-service:8081
                                                                    ├─ /ws   → live-service:8081 (WebSocket)
                                                                    ├─ /rtc  → srs:1985 (WHEP 信令)
                                                                    └─ /live → srs:8080 (FLV/HLS)
主播 OBS   ──rtmp://服务器IP:1935──► srs 容器（直连，不过面板）
WebRTC 媒体 ──udp 8000──► srs 容器（直连，不过面板）
```

播放地址同源化：`.env` 设 `LIVE_PLAY_URL_MODE=base` + `LIVE_PUBLIC_BASE_URL=https://你的域名` 后，前端拿到的播放地址都是 `https://你的域名/rtc/...`、`https://你的域名/live/...`，页面不会再出现 HTTP 混合内容告警。

## 1. 前置

| 项目 | 要求 |
|---|---|
| 服务器 | 一台有公网 IP 的 Linux（2C4G 起，Ubuntu/Debian/CentOS 均可） |
| 域名 | 一条 A 记录指向服务器公网 IP，如 `live.example.com` |
| 安全组/防火墙放行 | `443/tcp`（HTTPS）、`1935/tcp`（RTMP 推流）、`8000/udp`（WebRTC 媒体） |
| **不开放公网** | `1985`、`8080`、`3000`、`8081`（1985/8080 只绑 127.0.0.1；3000/8081 由 compose 绑定 127.0.0.1 或由面板内网访问） |

> 端口原则：**对外只暴露 443/tcp、1935/tcp、8000/udp，其余一律不暴露公网。** 云服务器还需在厂商控制台的"安全组"里做同样放行（系统防火墙和安全组是两层，都要配）。

## 2. 安装与启动

```bash
# 安装 Docker + Compose 插件（以 Ubuntu/Debian 为例）
curl -fsSL https://get.docker.com | bash
systemctl enable --now docker

# 拉代码
git clone <你的仓库地址> /opt/livedemo && cd /opt/livedemo

# 准备环境变量
cp .env.example .env
```

编辑 `.env`（base 模式示例，按实际情况替换域名/密码）：

```bash
# WebRTC 候选地址：必须填服务器公网 IP，否则观众端 WebRTC 黑屏
SRS_CANDIDATE=203.0.113.10

# JWT 签发密钥：服务器上执行 openssl rand -base64 32，把输出贴进来
LIVE_JWT_SECRET=xK9fQ2mB7pL0vN3cR8sT5wY1uE6iO4aZ+dGhJkQmNbC=

# 管理员引导账号（internal 模式，服务首次启动时自动创建）
LIVE_ADMIN_USER=admin
LIVE_ADMIN_PASSWORD=换成强密码

# 播放地址模式：公网部署用 base，播放地址全部同源走 https 域名
LIVE_PLAY_URL_MODE=base
LIVE_PUBLIC_BASE_URL=https://live.example.com
```

> `LIVE_JWT_SECRET` 和 `LIVE_ADMIN_PASSWORD` 未设置时容器会拒绝启动，这是故意的防呆设计。

启动：

```bash
docker compose up -d --build
docker compose ps        # 确认 livedemo-srs / livedemo-api / livedemo-web 三容器 Up
```

本地自检（可选，都在服务器本机执行）：

```bash
curl -s http://127.0.0.1:3000/api/rooms          # 经 web 反代调 API，应返回 {"code":"0",...}
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://127.0.0.1:3000/rtc/v1/whep/?app=live&stream=x" \
  -H "Content-Type: application/sdp" --data "v=0"   # 非 404 即说明 /rtc 反代已通
```

## 3. 宝塔面板反代配置

1. **添加站点**：左侧「网站」→「添加站点」→ 域名填 `live.example.com` → PHP 版本选「纯静态」→ 不创建数据库/FTP → 提交。
2. **签发证书**：站点列表点击该站点 →「SSL」标签页 → 选「Let's Encrypt」→ 勾选域名 →「申请」→ 申请成功后打开右上角「强制 HTTPS」开关。
3. **配置反向代理**：站点 →「反向代理」→「添加反向代理」→ 代理名称随意（如 `livedemo`）→ 目标 URL 填 `http://127.0.0.1:3000` → 发送域名 `$host` → 保存。
4. **开启 WebSocket（关键，弹幕全靠它）**：仍在「反向代理」页 → 点该代理的「配置文件」→ 确认配置中包含以下三行（宝塔新版本反代模板默认带 WebSocket 支持，缺哪行补哪行）：

   ```nginx
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   proxy_read_timeout 3600s;
   ```

   同时确认有 `proxy_set_header Host $host;`。改完保存，宝塔会自动 reload nginx。
5. 宝塔 7.x/8.x 老版本若「反向代理」页有「WebSocket」独立开关，打开即可，效果等价。

## 4. 1Panel 反代配置

1. **创建反代网站**：左侧「网站」→「创建网站」→ 类型选「反向代理」→ 主域名填 `live.example.com` → 代理地址填 `http://127.0.0.1:3000` → 代理名称随意 → 创建。
2. **签发证书**：网站列表点击该网站 →「HTTPS」→ 选择「申请证书」（Let's Encrypt / ACME 账号）→ 勾选域名 → 申请成功后开启「强制 HTTPS」并保存。
3. **开启 WebSocket（关键）**：网站 →「反向代理」编辑该代理，若界面有 WebSocket 开关则打开；若没有，进入「配置文件」（或「设置 → 配置文件」），在 `location /` 代理段中加入：

   ```nginx
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   proxy_read_timeout 3600s;
   ```

   并确认有 `proxy_set_header Host $host;`。保存后 1Panel 自动重载 OpenResty。
4. **放行面板防火墙**：1Panel「主机 → 防火墙」以及云安全组都放行 `443/tcp`、`1935/tcp`、`8000/udp`。

## 5. 验证清单

按顺序过一遍，全部通过即部署完成：

1. 浏览器打开 `https://你的域名`，地址栏出现证书锁标，**F12 控制台无混合内容（Mixed Content）告警**。
2. 注册一个 HOST 账号 → 创建房间，拿到推流地址和推流码。
3. OBS 设置：服务器 `rtmp://服务器公网IP:1935/live`，推流码填 streamKey → 开始推流 → 房间自动变「直播中」。
4. 另开浏览器（或无痕窗口）注册 VIEWER 账号进入直播间：
   - WebRTC 播放正常（延迟 <1s）；WHEP 请求走 `https://域名/rtc/...`（F12 网络面板确认，无 1985 端口字样）
   - FLV 降级地址走 `https://域名/live/...`（无 8080 端口字样）
   - 弹幕能发能收（`wss://域名/ws` 连接为 101 Switching Protocols）
5. 主播挂商品 → 观众小黄车实时出现 → 加购 → 购物车角标变化。
6. 停止 OBS 推流 → 房间自动回「未开播」。

## 6. 常见问题

| 现象 | 原因与处理 |
|---|---|
| 观众端 WebRTC 黑屏，FLV 正常 | ① `.env` 的 `SRS_CANDIDATE` 不是服务器公网 IP → 改后 `docker compose up -d` 重建 srs；② 云安全组没放行 `8000/udp`；③ 运营商拦截 UDP → 前端会自动降级 FLV，可接受 |
| 弹幕发不出去/收不到，`/ws` 一直 pending | 面板反代没开 WebSocket → 按上文补 `Upgrade`/`Connection`/`read_timeout` 三行 |
| 页面有混合内容告警，播放地址是 `http://...:8080` | `.env` 没切 base 模式 → 设 `LIVE_PLAY_URL_MODE=base`、`LIVE_PUBLIC_BASE_URL=https://你的域名` 后 `docker compose up -d` 重建 api |
| 推流被拒绝（OBS 报错，日志见「非法推流键」） | 推流码不对：必须是房间详情里的 streamKey 原文（`room-xxxxxxxx`），SRS 回调会校验 |
| `docker compose up` 报 `LIVE_JWT_SECRET is required` | `.env` 没填密钥/密码 → 这两个值是必填的防呆设计，填上即可 |
| 证书续期 | Let's Encrypt 证书由面板自动续期（宝塔/1Panel 均内置定时任务），无需手动处理；续期后面板自动 reload，不用动容器 |
| 想看容器日志 | `docker compose logs -f api`（后端）、`logs -f srs`（流媒体） |
| 开播台报"打开设备失败"/摄像头黑屏 | 页面不是 HTTPS 安全上下文（`http://IP` 下 `getUserMedia` 被禁用）→ 改用 `https://服务器IP` 并信任自签证书，或配置域名 |

## 7. 数据与升级

- 房间、商品、购物车、用户账号存在 live-service 的 H2 数据库中，落在 Docker 卷 `livedemo-data`，`docker compose down` 不丢数据；**不要** `down -v`。
- 弹幕、在线人数为内存态，重启即清空（demo 语义，不持久）。
- 升级版本：`git pull && docker compose up -d --build`。

## 8. 无备案 IP 直连模式（自签 IP 证书）

没有备案域名时，可以直接用 `https://服务器IP` 对外提供服务。正规 CA 不给裸 IP 签发免费证书，做法是面板**自签 IP 证书**，代价是访客首次访问需手动信任一次。

### 8.1 安全上下文约束（先读）

浏览器只在 **HTTPS 安全上下文**开放以下能力，`http://IP` 页面下直接禁用：

| 能力 | API | 受限影响 |
|---|---|---|
| 摄像头/麦克风 | `getUserMedia` | 网页开播台不可用 |
| 屏幕共享 | `getDisplayMedia` | 同上 |
| WebRTC 收发 | `RTCPeerConnection`（WHIP 推流 / WHEP 看播） | 网页开播与低延迟看播不可用 |

HTTP-FLV 兜底不受证书影响：`http://IP/live/...` 在普通 http 页面可用，弹幕 WebSocket 经 `ws://` 也可用——**不信任证书的观众走 `http://服务器IP:3000` 仍能看 FLV 画面、发弹幕**，只是没有低延迟 WebRTC 链路和开播能力。

### 8.2 自签证书

1Panel：「网站 → 证书 → 自签证书」（或 openssl 生成后以「其他证书/自定义证书」导入），签发对象填服务器公网 IP，绑定到站点 443。**不要开「强制 HTTPS」**——保留 http 入口给不信任证书的观众走 FLV 兜底。

openssl 生成（CN 与 SAN 都填公网 IP，浏览器只校验 SAN）：

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout ip.key -out ip.crt \
  -subj "/CN=203.0.113.10" -addext "subjectAltName=IP:203.0.113.10"
```

把 `ip.crt`/`ip.key` 粘贴进面板证书配置；站点反代目标仍是 `http://127.0.0.1:3000`，WebSocket 三行、端口放行（443/tcp、1935/tcp、8000/udp）与第 3/4 节完全一致。

### 8.3 `.env` 差异

```bash
SRS_CANDIDATE=203.0.113.10                  # 公网 IP，与域名模式相同
LIVE_PLAY_URL_MODE=base
LIVE_PUBLIC_BASE_URL=https://203.0.113.10   # 注意是 https://IP，让 FLV/WHEP 地址同源走 443
```

> base 模式下页面拿到的播放地址全部是 `https://IP/...`，无混合内容告警；面板 443 站点同时承接页面、API、WS、`/rtc`、`/live` 反代。

### 8.4 访客体验与到期备份

1. 首次打开 `https://服务器IP` → 浏览器提示"您的连接不是私密连接" → 点「高级 → 继续前往」一次即可，之后该浏览器正常访问（每个浏览器各信任一次）。
2. 主播进自己房间页 → 开播台「预览」→「开始直播」即可网页开播（WHIP，零配置）；OBS RTMP 通道照常可用。
3. 不信任证书的观众：打开 `http://服务器IP:3000`，走 FLV 播放入口观看。
4. **到期备份**：按月付费的临时服务器到期前，导出 `.env`（JWT 密钥/管理员密码）与数据卷：

   ```bash
   docker run --rm -v livedemo-data:/data -v "$PWD":/backup alpine \
     tar czf /backup/livedemo-data.tgz /data
   ```

## 9. 本地开发

本地不需要域名与 TLS：保持 `.env` 中 `LIVE_PLAY_URL_MODE=host`（或干脆不建 `.env`，但此时需在 shell 里提供 JWT 密钥与管理员密码），播放地址按 `localhost:端口` 拼装，行为与 M7 之前完全一致。
