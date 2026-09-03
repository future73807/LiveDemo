# M4: 管理与内容安全实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现主播管理工具（删弹幕/禁言/结束直播）、平台管理后台（全量房间/强制关播/封禁）与内容安全（DFA 敏感词、频控、禁言、封禁联动）。

**Architecture:** 内容安全在 WS 消息管道中按「封禁→禁言→频控→敏感词」顺序前置校验，全部失败路径通过 WS `error` 事件反馈；平台封禁落库（banned_user）并在 HTTP 认证过滤器与 WS 握手双重拦截 + 踢在线连接；房间级禁言为内存态随房间生命周期。管理操作权限统一「房主本人或 ADMIN」。

**Tech Stack:** 沿用 M2/M3 工程栈。

**前置条件：** M2、M3 完成。

**验收标准（对应设计 §9 M4）:**
- `mvn test` 全绿（DFA、频控、禁言、封禁联动、管理权限）
- 全链路：主播禁言观众 → 其发言收 `error(MUTED)`；删弹幕 → 双端消息消失；ADMIN 封禁 → 用户 HTTP 403 且 WS 被踢；强制关播 → 房间回 IDLE

---

### Task 1: 敏感词 DFA 过滤器

**Files:**
- Create: `live-service/src/main/java/com/livedemo/live/safety/SensitiveWordFilter.java`
- Create: `live-service/src/main/resources/sensitive-words.txt`
- Modify: `live-service/src/main/resources/application.yml`（追加 live.safety 配置）
- Modify: `live-service/src/main/java/com/livedemo/live/config/LiveProps.java`（追加 Safety 节点）
- Test: `live-service/src/test/java/com/livedemo/live/safety/SensitiveWordFilterTest.java`

- [ ] **Step 1: 写失败测试**

`SensitiveWordFilterTest.java`：

```java
package com.livedemo.live.safety;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@TestPropertySource(properties = {
        "live.safety.words-file=classpath:sensitive-words-test.txt",
        "live.safety.word-action=replace"
})
class SensitiveWordFilterTest {

    @Autowired SensitiveWordFilter filter;

    @Test
    void masksKnownWords() {
        SensitiveWordFilter.SafetyResult r = filter.check("这是赌博广告");
        assertThat(r.blocked()).isTrue();
        assertThat(r.content()).isEqualTo("这是**广告");
    }

    @Test
    void longestMatchWins() {
        // 词库同时含 "外挂" 与 "免费外挂"，应整体命中最长词
        SensitiveWordFilter.SafetyResult r = filter.check("免费外挂下载");
        assertThat(r.content()).isEqualTo("******下载");
    }

    @Test
    void cleanTextUntouched() {
        SensitiveWordFilter.SafetyResult r = filter.check("主播讲得真好");
        assertThat(r.blocked()).isFalse();
        assertThat(r.content()).isEqualTo("主播讲得真好");
    }
}
```

创建测试词库 `live-service/src/test/resources/sensitive-words-test.txt`：

```text
赌博
外挂
免费外挂
```

- [ ] **Step 2: 运行确认失败**

```bash
mvn -B test -Dtest=SensitiveWordFilterTest
```

预期：编译失败（类不存在）。

- [ ] **Step 3: 实现**

`config/LiveProps.java` 追加节点：

```java
    private Safety safety = new Safety();

    @Data
    public static class Safety {
        /** 词库文件路径，支持 classpath: 与文件系统路径 */
        private String wordsFile = "classpath:sensitive-words.txt";
        /** replace=掩码 ***；reject=直接拦截 */
        private String wordAction = "replace";
    }
```

`main/resources/sensitive-words.txt`（demo 演示词库，接入期替换为正式词库）：

```text
赌博
外挂
代充
刷单
```

`safety/SensitiveWordFilter.java`：

```java
package com.livedemo.live.safety;

import com.livedemo.live.config.LiveProps;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
@RequiredArgsConstructor
public class SensitiveWordFilter {

    public record SafetyResult(boolean blocked, String content) {}

    private static final class Node {
        final Map<Character, Node> children = new HashMap<>();
        boolean end;
    }

    private final LiveProps props;
    private final ResourceLoader resourceLoader;
    private volatile Node root = new Node();
    private volatile Set<String> words = Set.of();

    @PostConstruct
    public synchronized void reload() {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                resourceLoader.getResource(props.getSafety().getWordsFile()).getInputStream(), StandardCharsets.UTF_8))) {
            Set<String> loaded = new HashSet<>();
            String line;
            while ((line = reader.readLine()) != null) {
                String word = line.trim();
                if (!word.isEmpty()) loaded.add(word);
            }
            this.words = loaded;
            this.root = buildTrie(loaded);
        } catch (Exception e) {
            throw new IllegalStateException("敏感词库加载失败: " + props.getSafety().getWordsFile(), e);
        }
    }

    /** 返回掩码后内容与是否命中；word-action=reject 时 blocked 由调用方决定拒绝 */
    public SafetyResult check(String text) {
        Node trie = root;
        StringBuilder sb = new StringBuilder(text.length());
        boolean hit = false;
        int i = 0;
        while (i < text.length()) {
            int matchLen = matchAt(trie, text, i);
            if (matchLen > 0) {
                hit = true;
                sb.append("*".repeat(matchLen));
                i += matchLen;
            } else {
                sb.append(text.charAt(i));
                i++;
            }
        }
        return new SafetyResult(hit, sb.toString());
    }

    public boolean isRejectMode() {
        return "reject".equalsIgnoreCase(props.getSafety().getWordAction());
    }

    public List<String> currentWords() { return List.copyOf(words); }

    private int matchAt(Node trie, String text, int start) {
        Node node = trie;
        int longest = 0;
        for (int j = start; j < text.length(); j++) {
            node = node.children.get(text.charAt(j));
            if (node == null) break;
            if (node.end) longest = j - start + 1;   // 贪心保留最长命中
        }
        return longest;
    }

    private Node buildTrie(Set<String> loaded) {
        Node trie = new Node();
        for (String word : loaded) {
            Node cur = trie;
            for (int i = 0; i < word.length(); i++) {
                cur = cur.children.computeIfAbsent(word.charAt(i), c -> new Node());
            }
            cur.end = true;
        }
        return trie;
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
mvn -B test -Dtest=SensitiveWordFilterTest
```

预期：`Tests run: 3, Failures: 0`。

- [ ] **Step 5: Commit**

```bash
git add live-service/
git commit -m "feat(safety): DFA 敏感词过滤器（掩码/拒绝双模式，词库可重载）"
```

---

### Task 2: 频控与禁言

**Files:**
- Create: `live-service/src/main/java/com/livedemo/live/safety/RateLimiter.java`
- Create: `live-service/src/main/java/com/livedemo/live/safety/MuteService.java`
- Test: `live-service/src/test/java/com/livedemo/live/safety/RateLimiterTest.java`
- Test: `live-service/src/test/java/com/livedemo/live/safety/MuteServiceTest.java`

- [ ] **Step 1: 写失败测试**

`RateLimiterTest.java`：

```java
package com.livedemo.live.safety;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class RateLimiterTest {

    @Test
    void allowsUpToLimitPerSecond() {
        RateLimiter limiter = new RateLimiter();
        for (int i = 0; i < 5; i++) {
            assertThat(limiter.allow("u1", 5)).isTrue();
        }
        assertThat(limiter.allow("u1", 5)).isFalse();   // 第 6 次拒绝
        assertThat(limiter.allow("u2", 5)).isTrue();    // 其他用户不受影响
    }

    @Test
    void evictResetsWindow() {
        RateLimiter limiter = new RateLimiter();
        for (int i = 0; i < 5; i++) limiter.allow("u1", 5);
        assertThat(limiter.allow("u1", 5)).isFalse();
        limiter.evict("u1");
        assertThat(limiter.allow("u1", 5)).isTrue();
    }
}
```

`MuteServiceTest.java`：

```java
package com.livedemo.live.safety;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class MuteServiceTest {

    private final MuteService service = new MuteService();

    @Test
    void muteThenRemain() {
        service.mute(1L, "u1", 60);
        long remain = service.remainingSec(1L, "u1");
        assertThat(remain).isBetween(59, 60);
        service.mute(1L, "u1", 120);   // 重复禁言覆盖
        assertThat(service.remainingSec(1L, "u1")).isGreaterThan(60);
    }

    @Test
    void unmuteAndOtherRoomIsolation() {
        service.mute(1L, "u1", 60);
        service.unmute(1L, "u1");
        assertThat(service.remainingSec(1L, "u1")).isEqualTo(0);
        assertThat(service.remainingSec(2L, "u1")).isEqualTo(0);   // 房间隔离
    }
}
```

- [ ] **Step 2: 运行确认失败**

```bash
mvn -B test -Dtest='RateLimiterTest,MuteServiceTest'
```

预期：编译失败。

- [ ] **Step 3: 实现**

`safety/RateLimiter.java`：

```java
package com.livedemo.live.safety;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** 单连接每秒发言上限（设计 §5.5：5 条/秒），按 key（userId）计数 */
@Component
public class RateLimiter {

    private record Window(long second, int count) {}

    private final Map<String, Window> windows = new ConcurrentHashMap<>();

    public boolean allow(String key, int limitPerSecond) {
        long now = System.currentTimeMillis() / 1000;
        Window w = windows.compute(key, (k, old) -> {
            if (old == null || old.second() != now) return new Window(now, 1);
            if (old.count() >= limitPerSecond) return old;   // 保持原窗口，判定为拒绝
            return new Window(now, old.count() + 1);
        });
        return w.count() <= limitPerSecond;
    }

    /** 连接关闭时清理，防内存泄漏 */
    public void evict(String key) { windows.remove(key); }
}
```

`safety/MuteService.java`：

```java
package com.livedemo.live.safety;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** 房间级禁言：内存态，随房间生命周期（设计 §5.6） */
@Component
public class MuteService {

    private final Map<Long, Map<String, Long>> mutes = new ConcurrentHashMap<>();

    public void mute(long roomId, String userId, long durationSec) {
        mutes.computeIfAbsent(roomId, k -> new ConcurrentHashMap<>())
                .put(userId, System.currentTimeMillis() + durationSec * 1000);
    }

    public void unmute(long roomId, String userId) {
        Map<String, Long> room = mutes.get(roomId);
        if (room != null) room.remove(userId);
    }

    public long remainingSec(long roomId, String userId) {
        Map<String, Long> room = mutes.get(roomId);
        if (room == null) return 0;
        Long until = room.get(userId);
        if (until == null) return 0;
        long remain = (until - System.currentTimeMillis()) / 1000;
        if (remain <= 0) {
            room.remove(userId);
            return 0;
        }
        return remain;
    }

    public void clearRoom(long roomId) { mutes.remove(roomId); }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
mvn -B test -Dtest='RateLimiterTest,MuteServiceTest'
```

预期：全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add live-service/
git commit -m "feat(safety): 发言频控与房间级禁言"
```

---

### Task 3: 平台封禁（落库 + 认证拦截 + 踢下线）

**Files:**
- Create: `live-service/src/main/java/com/livedemo/live/safety/BannedUser.java`
- Create: `live-service/src/main/java/com/livedemo/live/safety/BannedUserRepository.java`
- Create: `live-service/src/main/java/com/livedemo/live/safety/BanService.java`
- Modify: `live-service/src/main/java/com/livedemo/live/auth/TokenAuthFilter.java`（认证后校验封禁）
- Modify: `live-service/src/main/java/com/livedemo/live/auth/SecurityConfig.java`（构造过滤传入 BanService）
- Modify: `live-service/src/main/java/com/livedemo/live/ws/WsConfig.java`（握手校验封禁）
- Test: `live-service/src/test/java/com/livedemo/live/safety/BanFlowTest.java`

- [ ] **Step 1: 写失败测试**

`BanFlowTest.java`：

```java
package com.livedemo.live.safety;

import com.livedemo.live.TestTokens;
import com.livedemo.live.auth.AuthUser;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("demo")
class BanFlowTest {

    @Autowired MockMvc mvc;
    @Autowired TestTokens tokens;
    @Autowired BanService banService;

    @Test
    void bannedUserGets403EvenWithValidToken() throws Exception {
        String token = tokens.sign(new AuthUser("bad1", "坏人", java.util.Set.of("VIEWER")));
        mvc.perform(post("/api/cart/items").header("Authorization", "Bearer " + token)
                        .contentType("application/json").content("{\"productId\":1,\"qty\":1}"))
                .andExpect(status().isOk());   // 封禁前正常（商品不存在与否不影响 401/403 判定，此处应非 403-权限）

        banService.ban("bad1", "刷屏");

        mvc.perform(post("/api/cart/items").header("Authorization", "Bearer " + token)
                        .contentType("application/json").content("{\"productId\":1,\"qty\":1}"))
                .andExpect(status().isForbidden());   // 封禁后有效 token 也被拒

        banService.unban("bad1");
    }
}
```

- [ ] **Step 2: 运行确认失败**

```bash
mvn -B test -Dtest=BanFlowTest
```

预期：编译失败（BanService 不存在）。

- [ ] **Step 3: 实现**

`safety/BannedUser.java`：

```java
package com.livedemo.live.safety;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "banned_user")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class BannedUser {
    @Id
    @Column(name = "user_id", length = 64)
    private String userId;

    @Column(length = 255)
    private String reason;

    @Column(name = "banned_at", nullable = false)
    private LocalDateTime bannedAt;
}
```

`safety/BannedUserRepository.java`：

```java
package com.livedemo.live.safety;

import org.springframework.data.jpa.repository.JpaRepository;

public interface BannedUserRepository extends JpaRepository<BannedUser, String> {}
```

`safety/BanService.java`：

```java
package com.livedemo.live.safety;

import com.livedemo.live.ws.RoomSessionRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

@Slf4j
@Service
@RequiredArgsConstructor
public class BanService {

    private final BannedUserRepository repo;
    private final RoomSessionRegistry registry;

    public void ban(String userId, String reason) {
        repo.save(BannedUser.builder().userId(userId).reason(reason).bannedAt(LocalDateTime.now()).build());
        registry.closeAllOf(userId);   // 立即踢掉在线连接（设计 §5.6 封禁联动）
        log.info("用户 {} 已被封禁，原因：{}", userId, reason);
    }

    public void unban(String userId) { repo.deleteById(userId); }

    public boolean isBanned(String userId) { return repo.existsById(userId); }
}
```

`auth/TokenAuthFilter.java` 修改：构造器追加 `BanService banService`，`authenticate` 成功后追加：

```java
                AuthUser user = provider.authenticate(credential);
                if (banService.isBanned(user.userId())) {
                    response.setStatus(403);
                    response.setContentType("application/json;charset=UTF-8");
                    response.getWriter().write("{\"code\":\"403\",\"message\":\"账号已被封禁\"}");
                    return;
                }
                request.setAttribute(ATTR, user);
```

`auth/SecurityConfig.java` 修改：注入 `BanService`，过滤器构造改为：

```java
            .addFilterBefore(new TokenAuthFilter(providers, AuthMode.valueOf(props.getAuth().getMode()), banService),
                    UsernamePasswordAuthenticationFilter.class);
```

`ws/WsConfig.java` 修改：注入 `BanService`，握手成功取得 `user` 后追加：

```java
            if (banService.isBanned(user.userId())) return false;
```

（`AuthHandshakeInterceptor` 为内部类，需将 `banService` 通过外部类字段访问，内部类天然可见。）

- [ ] **Step 4: 运行全部测试确认通过**

```bash
mvn -B test
```

预期：全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add live-service/
git commit -m "feat(safety): 平台封禁（认证/WS 双拦截 + 踢下线）"
```

---

### Task 4: WS 消息安全管道

**Files:**
- Modify: `live-service/src/main/java/com/livedemo/live/ws/RoomSocketHandler.java`（接入四道校验）
- Test: `live-service/src/test/java/com/livedemo/live/ws/RoomSocketHandlerTest.java`

- [ ] **Step 1: 写失败测试**

`RoomSocketHandlerTest.java`（Mockito 模拟 WS 会话，捕获广播内容）：

```java
package com.livedemo.live.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.livedemo.live.chat.ChatService;
import com.livedemo.live.safety.MuteService;
import com.livedemo.live.safety.RateLimiter;
import com.livedemo.live.safety.SensitiveWordFilter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.net.URI;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class RoomSocketHandlerTest {

    private RoomSessionRegistry registry;
    private WsEventSender sender;
    private ChatService chatService;
    private MuteService muteService;
    private RateLimiter rateLimiter;
    private SensitiveWordFilter wordFilter;
    private RoomSocketHandler handler;

    private final ObjectMapper om = new ObjectMapper();

    @BeforeEach
    void setUp() {
        registry = new RoomSessionRegistry();
        sender = new WsEventSender(registry, om);
        chatService = new ChatService();
        muteService = mock(MuteService.class);
        rateLimiter = new RateLimiter();
        wordFilter = mock(SensitiveWordFilter.class);
        when(wordFilter.check(any())).thenAnswer(inv ->
                new SensitiveWordFilter.SafetyResult(false, inv.getArgument(0)));
        handler = new RoomSocketHandler(registry, sender, chatService, om, muteService, rateLimiter, wordFilter);
    }

    private WebSocketSession session(String id, long roomId, String userId) throws Exception {
        WebSocketSession s = mock(WebSocketSession.class);
        when(s.getId()).thenReturn(id);
        when(s.isOpen()).thenReturn(true);
        when(s.getAttributes()).thenReturn(Map.of(
                RoomSocketHandler.ATTR_ROOM_ID, roomId,
                RoomSocketHandler.ATTR_USER_ID, userId,
                RoomSocketHandler.ATTR_NICKNAME, "昵称" + userId));
        when(s.getUri()).thenReturn(new URI("ws://localhost/ws?roomId=" + roomId));
        return s;
    }

    private String received(WebSocketSession s) throws Exception {
        ArgumentCaptorOnDemand captor = new ArgumentCaptorOnDemand(s);
        return captor.last();
    }

    /** 简化捕获器：依次记录 session 收到的全部文本帧 */
    private static final class ArgumentCaptorOnDemand {
        private final WebSocketSession session;
        ArgumentCaptorOnDemand(WebSocketSession session) { this.session = session; }
        String last() throws Exception {
            org.mockito.ArgumentCaptor<TextMessage> captor = org.mockito.ArgumentCaptor.forClass(TextMessage.class);
            verify(session, atLeastOnce()).sendMessage(captor.capture());
            return captor.getValue().getPayload();
        }
    }

    @Test
    void mutedUserGetsErrorAndMessageDropped() throws Exception {
        WebSocketSession s = session("s1", 1L, "u1");
        handler.afterConnectionEstablished(s);
        when(muteService.remainingSec(1L, "u1")).thenReturn(30L);

        handler.handleTextMessage(s, new TextMessage("{\"type\":\"chat\",\"content\":\"hi\"}"));

        assertThat(received(s)).contains("\"E_MUTED\"");
        assertThat(chatService.history(1L)).isEmpty();
    }

    @Test
    void overRateLimitGetsError() throws Exception {
        WebSocketSession s = session("s1", 1L, "u1");
        handler.afterConnectionEstablished(s);
        for (int i = 0; i < 5; i++) {
            handler.handleTextMessage(s, new TextMessage("{\"type\":\"chat\",\"content\":\"m" + i + "\"}"));
        }
        handler.handleTextMessage(s, new TextMessage("{\"type\":\"chat\",\"content\":\"m5\"}"));
        assertThat(received(s)).contains("\"E_RATE_LIMITED\"");
        assertThat(chatService.history(1L)).hasSize(5);
    }

    @Test
    void sensitiveHitInRejectModeIsBlocked() throws Exception {
        when(wordFilter.check(any())).thenReturn(new SensitiveWordFilter.SafetyResult(true, "***"));
        when(wordFilter.isRejectMode()).thenReturn(true);
        WebSocketSession s = session("s1", 1L, "u1");
        handler.afterConnectionEstablished(s);

        handler.handleTextMessage(s, new TextMessage("{\"type\":\"chat\",\"content\":\"赌博信息\"}"));

        assertThat(received(s)).contains("\"E_SENSITIVE\"");
        assertThat(chatService.history(1L)).isEmpty();
    }

    @Test
    void sensitiveHitInReplaceModeIsMasked() throws Exception {
        when(wordFilter.check(any())).thenReturn(new SensitiveWordFilter.SafetyResult(true, "这是**内容"));
        when(wordFilter.isRejectMode()).thenReturn(false);
        WebSocketSession s = session("s1", 1L, "u1");
        handler.afterConnectionEstablished(s);

        handler.handleTextMessage(s, new TextMessage("{\"type\":\"chat\",\"content\":\"这是赌博内容\"}"));

        assertThat(chatService.history(1L).get(0).content()).isEqualTo("这是**内容");
    }
}
```

- [ ] **Step 2: 运行确认失败**

```bash
mvn -B test -Dtest=RoomSocketHandlerTest
```

预期：编译失败（构造器参数不符）。

- [ ] **Step 3: 修改 RoomSocketHandler**

构造器追加 `MuteService muteService, RateLimiter rateLimiter, SensitiveWordFilter wordFilter`（`@RequiredArgsConstructor` 自动生效），`handleTextMessage` 的 chat 分支改为：

```java
            if (!"chat".equals(node.path("type").asText())) return;
            String content = node.path("content").asText("").trim();
            if (content.isEmpty()) return;

            // 1. 房间级禁言
            long remain = muteService.remainingSec(roomId, userId);
            if (remain > 0) {
                sender.send(session, Map.of("type", "error", "code", "E_MUTED",
                        "message", "已被禁言", "durationSec", remain));
                return;
            }
            // 2. 频控（设计 §5.5：5 条/秒）
            if (!rateLimiter.allow(userId, 5)) {
                sender.send(session, Map.of("type", "error", "code", "E_RATE_LIMITED",
                        "message", "发言过于频繁"));
                return;
            }
            // 3. 敏感词（设计 §5.6：replace=掩码放行，reject=拒绝）
            SensitiveWordFilter.SafetyResult safety = wordFilter.check(content);
            if (safety.blocked() && wordFilter.isRejectMode()) {
                sender.send(session, Map.of("type", "error", "code", "E_SENSITIVE",
                        "message", "消息包含敏感内容"));
                return;
            }
            content = safety.content();

            ChatMessage msg = chatService.append(roomId, userId, nickname, content);
```

并在 `afterConnectionClosed` 中追加 `rateLimiter.evict((String) session.getAttributes().get(ATTR_USER_ID));`。

- [ ] **Step 4: 运行全部测试确认通过**

```bash
mvn -B test
```

预期：全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add live-service/
git commit -m "feat(safety): WS 消息管道接入禁言/频控/敏感词校验"
```

---

### Task 5: 主播管理工具 API

**Files:**
- Create: `live-service/src/main/java/com/livedemo/live/moderation/ModerationController.java`
- Modify: `live-service/src/main/java/com/livedemo/live/chat/ChatService.java`（无改动，复用 removeMessage）
- Test: `live-service/src/test/java/com/livedemo/live/moderation/ModerationApiTest.java`

- [ ] **Step 1: 写失败测试**

`ModerationApiTest.java`：

```java
package com.livedemo.live.moderation;

import com.livedemo.live.TestTokens;
import com.livedemo.live.auth.AuthUser;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("demo")
class ModerationApiTest {

    @Autowired MockMvc mvc;
    @Autowired TestTokens tokens;

    private AuthUser hostOf(String id) { return new AuthUser(id, "主播" + id, java.util.Set.of("HOST")); }

    @Test
    void onlyOwnerOrAdminCanModerate() throws Exception {
        String owner = tokens.sign(hostOf("h1"));
        String stranger = tokens.sign(hostOf("h2"));
        String viewer = tokens.sign(new AuthUser("v1", "观众", java.util.Set.of("VIEWER")));
        String admin = tokens.sign(new AuthUser("a1", "管理员", java.util.Set.of("ADMIN")));

        String roomResp = mvc.perform(post("/api/rooms").header("Authorization", "Bearer " + owner)
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andReturn().getResponse().getContentAsString();
        Integer roomId = com.jayway.jsonpath.JsonPath.read(roomResp, "$.data.id");

        String muteBody = "{\"userId\":\"v1\",\"durationSec\":60}";

        mvc.perform(post("/api/rooms/" + roomId + "/mutes").header("Authorization", "Bearer " + viewer)
                        .contentType("application/json").content(muteBody))
                .andExpect(status().isForbidden());   // 观众无权限
        mvc.perform(post("/api/rooms/" + roomId + "/mutes").header("Authorization", "Bearer " + stranger)
                        .contentType("application/json").content(muteBody))
                .andExpect(status().isForbidden());   // 非房主
        mvc.perform(post("/api/rooms/" + roomId + "/mutes").header("Authorization", "Bearer " + owner)
                        .contentType("application/json").content(muteBody))
                .andExpect(status().isOk());          // 房主
        mvc.perform(post("/api/rooms/" + roomId + "/mutes").header("Authorization", "Bearer " + admin)
                        .contentType("application/json").content(muteBody))
                .andExpect(status().isOk());          // 管理员
        mvc.perform(delete("/api/rooms/" + roomId + "/mutes/v1").header("Authorization", "Bearer " + owner))
                .andExpect(status().isOk());

        // 删不存在的弹幕 → 404
        mvc.perform(delete("/api/rooms/" + roomId + "/messages/no-such-id")
                        .header("Authorization", "Bearer " + owner))
                .andExpect(status().isNotFound());
    }
}
```

- [ ] **Step 2: 运行确认失败**

```bash
mvn -B test -Dtest=ModerationApiTest
```

预期：404。

- [ ] **Step 3: 实现**

`moderation/ModerationController.java`：

```java
package com.livedemo.live.moderation;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.auth.TokenAuthFilter;
import com.livedemo.live.chat.ChatService;
import com.livedemo.live.common.ApiResponse;
import com.livedemo.live.common.BusinessException;
import com.livedemo.live.room.Room;
import com.livedemo.live.room.RoomService;
import com.livedemo.live.safety.MuteService;
import com.livedemo.live.ws.RoomSessionRegistry;
import com.livedemo.live.ws.WsEventSender;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/rooms/{id}")
@RequiredArgsConstructor
public class ModerationController {

    private final RoomService roomService;
    private final ChatService chatService;
    private final MuteService muteService;
    private final RoomSessionRegistry registry;
    private final WsEventSender sender;

    @Data
    public static class MuteRequest {
        @jakarta.validation.constraints.NotBlank private String userId;
        private long durationSec = 600;
    }

    private Room requireModerator(long roomId, AuthUser user) {
        Room room = roomService.get(roomId);
        if (!room.getOwnerId().equals(user.userId())) {
            user.requireRole(AuthUser.ADMIN);
        }
        return room;
    }

    @DeleteMapping("/messages/{messageId}")
    public ApiResponse<Void> deleteMessage(@PathVariable long id, @PathVariable String messageId,
                                           @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        requireModerator(id, user);
        if (!chatService.removeMessage(id, messageId)) {
            throw BusinessException.notFound("弹幕不存在或已删除");
        }
        sender.broadcast(id, Map.of("type", "message_deleted", "messageId", messageId));
        return ApiResponse.ok(null);
    }

    @PostMapping("/mutes")
    public ApiResponse<Void> mute(@PathVariable long id, @RequestBody MuteRequest req,
                                  @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        requireModerator(id, user);
        muteService.mute(id, req.getUserId(), req.getDurationSec());
        // 定向通知被禁言者（设计 §5.5 muted 事件）
        registry.sessions(id).stream()
                .filter(info -> info.userId().equals(req.getUserId()))
                .forEach(info -> sender.send(info.session(),
                        Map.of("type", "muted", "durationSec", req.getDurationSec())));
        return ApiResponse.ok(null);
    }

    @DeleteMapping("/mutes/{userId}")
    public ApiResponse<Void> unmute(@PathVariable long id, @PathVariable String userId,
                                    @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        requireModerator(id, user);
        muteService.unmute(id, userId);
        return ApiResponse.ok(null);
    }
}
```

- [ ] **Step 4: 运行全部测试确认通过**

```bash
mvn -B test
```

预期：全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add live-service/
git commit -m "feat(moderation): 主播管理工具 API（删弹幕/禁言）"
```

---

### Task 6: 平台管理后台 API

**Files:**
- Create: `live-service/src/main/java/com/livedemo/live/admin/AdminController.java`
- Modify: `live-service/src/main/java/com/livedemo/live/room/RoomService.java`（追加 forceClose）
- Test: `live-service/src/test/java/com/livedemo/live/admin/AdminApiTest.java`

- [ ] **Step 1: 写失败测试**

`AdminApiTest.java`：

```java
package com.livedemo.live.admin;

import com.livedemo.live.TestTokens;
import com.livedemo.live.auth.AuthUser;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("demo")
class AdminApiTest {

    @Autowired MockMvc mvc;
    @Autowired TestTokens tokens;

    private String tokenOf(String userId, String... roles) {
        return tokens.sign(new AuthUser(userId, "用户" + userId, java.util.Set.of(roles)));
    }

    @Test
    void adminOnlyEndpoints() throws Exception {
        String admin = tokenOf("a1", "ADMIN");
        String host = tokenOf("h1", "HOST");
        String body = "{\"title\":\"t\"}";
        String roomResp = mvc.perform(post("/api/rooms").header("Authorization", "Bearer " + host)
                        .contentType("application/json").content(body))
                .andReturn().getResponse().getContentAsString();
        Integer roomId = com.jayway.jsonpath.JsonPath.read(roomResp, "$.data.id");

        mvc.perform(get("/api/admin/rooms").header("Authorization", "Bearer " + host))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/rooms").header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value("0"));

        mvc.perform(post("/api/admin/rooms/" + roomId + "/force-close")
                        .header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk());
        mvc.perform(get("/api/rooms/" + roomId))
                .andExpect(jsonPath("$.data.status").value("IDLE"));

        mvc.perform(post("/api/admin/users/u999/ban").header("Authorization", "Bearer " + admin)
                        .contentType("application/json").content("{\"reason\":\"测试\"}"))
                .andExpect(status().isOk());
        mvc.perform(delete("/api/admin/users/u999/ban").header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk());

        mvc.perform(post("/api/admin/sensitive-words/reload").header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk());
    }
}
```

- [ ] **Step 2: 运行确认失败**

```bash
mvn -B test -Dtest=AdminApiTest
```

预期：404。

- [ ] **Step 3: 实现**

`RoomService` 追加：

```java
    public Room forceClose(long id, String operatorId) {
        Room room = get(id);
        room.setStatus(RoomStatus.IDLE);
        Room saved = repo.save(room);
        events.publishEvent(new RoomStatusChangedEvent(saved.getId(), RoomStatus.IDLE));
        log.info("房间 {} 已被管理员 {} 强制关播", id, operatorId);
        return saved;
    }
```

（`RoomService` 需追加 `@Slf4j`。）

`admin/AdminController.java`：

```java
package com.livedemo.live.admin;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.auth.TokenAuthFilter;
import com.livedemo.live.common.ApiResponse;
import com.livedemo.live.room.RoomDto;
import com.livedemo.live.room.RoomService;
import com.livedemo.live.safety.BanService;
import com.livedemo.live.safety.SensitiveWordFilter;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/admin")
@RequiredArgsConstructor
public class AdminController {

    private final RoomService roomService;
    private final BanService banService;
    private final SensitiveWordFilter wordFilter;

    @Data
    public static class BanRequest { private String reason; }

    private void requireAdmin(AuthUser user) { user.requireRole(AuthUser.ADMIN); }

    @GetMapping("/rooms")
    public ApiResponse<List<RoomDto>> rooms(@RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        requireAdmin(user);
        return ApiResponse.ok(roomService.list(null).stream()
                .map(r -> RoomDto.of(r, null, false, roomService.viewers(r.getId()), roomService.productCount(r.getId())))
                .toList());
    }

    @PostMapping("/rooms/{id}/force-close")
    public ApiResponse<RoomDto> forceClose(@PathVariable long id,
                                           @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        requireAdmin(user);
        return ApiResponse.ok(RoomDto.of(roomService.forceClose(id, user.userId()), null, false, 0, 0));
    }

    @PostMapping("/users/{userId}/ban")
    public ApiResponse<Void> ban(@PathVariable String userId, @RequestBody BanRequest req,
                                 @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        requireAdmin(user);
        banService.ban(userId, req.getReason());
        return ApiResponse.ok(null);
    }

    @DeleteMapping("/users/{userId}/ban")
    public ApiResponse<Void> unban(@PathVariable String userId,
                                   @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        requireAdmin(user);
        banService.unban(userId);
        return ApiResponse.ok(null);
    }

    @PostMapping("/sensitive-words/reload")
    public ApiResponse<Map<String, Object>> reloadWords(@RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        requireAdmin(user);
        wordFilter.reload();
        return ApiResponse.ok(Map.of("count", wordFilter.currentWords().size()));
    }
}
```

- [ ] **Step 4: 运行全部测试确认通过**

```bash
mvn -B test
```

预期：全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add live-service/
git commit -m "feat(admin): 平台后台 API（全量房间/强制关播/封禁/词库重载）"
```

---

### Task 7: 全链路验证与收尾

- [ ] **Step 1: 重建服务**

```bash
docker compose up -d --build live-service
```

- [ ] **Step 2: PowerShell 验证管理链路**

```powershell
# 准备：主播/观众/管理员 token 与房间
$mk = { param($uid,$nick,$roles) (Invoke-RestMethod -Method Post -Uri http://localhost:8081/api/auth/dev-token -ContentType "application/json" -Body ('{"userId":"'+$uid+'","nickname":"'+$nick+'","roles":'+$roles+'}')).data.token }
$hostT = & $mk "host1" "主播甲" '["HOST"]'
$viewT = & $mk "view1" "观众甲" '["VIEWER"]'
$adminT = & $mk "admin1" "管理员" '["ADMIN"]'
$roomId = ((Invoke-RestMethod -Method Post -Uri http://localhost:8081/api/rooms -Headers @{Authorization="Bearer $hostT"} -ContentType "application/json" -Body '{"title":"管理验证间"}').data.id)

# 1. 主播禁言观众 → 观众 HTTP 不受限但 WS 发言被拒（WS 部分用浏览器验证）
Invoke-RestMethod -Method Post -Uri "http://localhost:8081/api/rooms/$roomId/mutes" -Headers @{Authorization="Bearer $hostT"} -ContentType "application/json" -Body '{"userId":"view1","durationSec":60}'

# 2. ADMIN 强制关播
Invoke-RestMethod -Method Post -Uri "http://localhost:8081/api/admin/rooms/$roomId/force-close" -Headers @{Authorization="Bearer $adminT"}
(Invoke-RestMethod "http://localhost:8081/api/rooms/$roomId").data.status   # 预期 IDLE

# 3. 封禁/解封
Invoke-RestMethod -Method Post -Uri "http://localhost:8081/api/admin/users/view1/ban" -Headers @{Authorization="Bearer $adminT"} -ContentType "application/json" -Body '{"reason":"刷屏"}'
try { Invoke-RestMethod -Uri http://localhost:8081/api/cart -Headers @{Authorization="Bearer $viewT"} } catch { $_.Exception.Response.StatusCode.value__ }   # 预期 403
Invoke-RestMethod -Method Delete -Uri "http://localhost:8081/api/admin/users/view1/ban" -Headers @{Authorization="Bearer $adminT"}
```

- [ ] **Step 3: WS 管道验证（浏览器控制台，两个标签页）**

- 标签页 A（主播）、标签页 B（观众）按 M2 Task 8 Step 6 方式连入同一房间
- A 调禁言接口禁 B → B 发言 → B 控制台收到 `{"type":"error","code":"E_MUTED",...}`
- B 连发 6 条 → 第 6 条返回 `E_RATE_LIMITED`
- A 在聊天列表点删除 → 双端同时收到 `{"type":"message_deleted",...}` 且消息消失

- [ ] **Step 4: Commit（如无代码改动则跳过）**

---

## 自审记录

- 设计覆盖：§5.6 内容安全四项（敏感词 DFA/频控/房间禁言/平台封禁+联动）✓；§5.3 主播管理 3 接口 + 平台后台 4 接口 + 词库重载 ✓；§5.5 error/muted/message_deleted 事件 ✓；force-close 记录操作人（日志）✓
- 类型一致性：`SafetyResult(blocked, content)`、`RateLimiter.allow/evict`、`MuteService.mute/unmute/remainingSec` 跨任务一致 ✓
- 与 M2/M3 兼容：`RoomSocketHandler` 构造器新增参数已同步到全部调用点（Spring 自动注入）✓
- 无占位符：所有修改均给出完整代码片段与位置 ✓
