# M2: live-service 核心实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Spring Boot 3 微服务：JWT 认证（含 demo 签发）、房间 CRUD 与播放地址、SRS 回调房间状态机、WebSocket 弹幕/在线人数，并接入 SRS http_hook 完成全链路验证。

**Architecture:** 单体微服务 `live-service`（端口 8081）。认证走 `AuthProvider` SPI（jwt / gateway 两实现，过滤器统一解析）；房间状态变更以 Spring 事件解耦，WS 层监听事件广播；弹幕/在线人数为内存态（不落库）。SRS 通过 `on_publish`/`on_unpublish` 回调驱动房间状态机，非法推流键回调返回 403 拒绝。

**Tech Stack:** Spring Boot 3.3 / Java 17 / Spring WebSocket / Spring Security（无状态过滤器）/ Nimbus JOSE+JWT / H2(JPA) / JUnit5 + Mockito。

**前置条件：** M1 完成（SRS 容器可用）。

**验收标准（对应设计 §9 M2）:**
- `mvn test` 全绿（房间状态机、回调、认证、弹幕历史）
- compose 起服务后：dev-token 签发 → 创建房间 → ffmpeg 按 streamKey 推流 → 房间转 LIVING → 停推 → 回 IDLE

---

## 文件结构总览（本计划最终形态）

```
live-service/
├── Dockerfile
├── pom.xml
└── src
    ├── main/java/com/livedemo/live/
    │   ├── LiveServiceApplication.java
    │   ├── common/            ApiResponse, BusinessException, GlobalExceptionHandler
    │   ├── config/            LiveProps
    │   ├── auth/              AuthUser, AuthMode, AuthProvider, InvalidTokenException,
    │   │                      JwtAuthProvider, GatewayHeaderAuthProvider, TokenAuthFilter,
    │   │                      SecurityConfig, DevTokenController
    │   ├── room/              RoomStatus, Room, RoomRepository, RoomStatusChangedEvent,
    │   │                      PresenceProvider, RoomDto, CreateRoomRequest, RoomService, RoomController
    │   ├── hook/              SrsHookController
    │   ├── chat/              ChatMessage, ChatService
    │   └── ws/                WsConfig, RoomSessionRegistry, WsEventSender, RoomSocketHandler, RoomStatusListener
    ├── main/resources/application.yml
    └── test/java/com/livedemo/live/   各域测试
```

---

### Task 1: Maven 脚手架与公共层

**Files:**
- Create: `live-service/pom.xml`
- Create: `live-service/src/main/resources/application.yml`
- Create: `live-service/src/main/java/com/livedemo/live/LiveServiceApplication.java`
- Create: `live-service/src/main/java/com/livedemo/live/common/ApiResponse.java`
- Create: `live-service/src/main/java/com/livedemo/live/common/BusinessException.java`
- Create: `live-service/src/main/java/com/livedemo/live/common/GlobalExceptionHandler.java`
- Create: `live-service/src/main/java/com/livedemo/live/config/LiveProps.java`

- [ ] **Step 1: pom.xml**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.3.4</version>
        <relativePath/>
    </parent>
    <groupId>com.livedemo</groupId>
    <artifactId>live-service</artifactId>
    <version>0.1.0</version>
    <name>live-service</name>

    <properties>
        <java.version>17</java.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-websocket</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-security</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-validation</artifactId>
        </dependency>
        <dependency>
            <groupId>com.nimbusds</groupId>
            <artifactId>nimbus-jose-jwt</artifactId>
        </dependency>
        <dependency>
            <groupId>com.h2database</groupId>
            <artifactId>h2</artifactId>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
                <configuration>
                    <excludes>
                        <exclude>
                            <groupId>org.projectlombok</groupId>
                            <artifactId>lombok</artifactId>
                        </exclude>
                    </excludes>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
```

- [ ] **Step 2: application.yml**

```yaml
spring:
  application:
    name: live-service
  datasource:
    url: jdbc:h2:file:./data/live;AUTO_SERVER=TRUE
    driver-class-name: org.h2.Driver
    username: sa
    password: ""
  jpa:
    hibernate:
      ddl-auto: update
    open-in-view: false

server:
  port: 8081

live:
  auth:
    mode: jwt                # jwt | gateway
    jwt:
      # Base64 的 32 字节密钥（demo 默认值，生产必须通过环境变量覆盖）
      secret: ${LIVE_JWT_SECRET:ZGVtb19kZW1vX2RlbW9fZGVtb19kZW1vX2RlbW8xMjM0NQ==}
      # RS256 模式配置后优先生效，例如 https://id.example.com/.well-known/jwks.json
      jwk-set-uri: ""
  srs:
    public-host: localhost
    rtmp-port: 1935
    api-port: 1985
    http-port: 8080

logging:
  level:
    com.livedemo: DEBUG
```

- [ ] **Step 3: 启动类与公共层**

`LiveServiceApplication.java`：

```java
package com.livedemo.live;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class LiveServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(LiveServiceApplication.class, args);
    }
}
```

`common/ApiResponse.java`：

```java
package com.livedemo.live.common;

public record ApiResponse<T>(String code, String message, T data) {
    public static <T> ApiResponse<T> ok(T data) { return new ApiResponse<>("0", "ok", data); }
    public static ApiResponse<Void> error(String code, String message) { return new ApiResponse<>(code, message, null); }
}
```

`common/BusinessException.java`：

```java
package com.livedemo.live.common;

import lombok.Getter;

@Getter
public class BusinessException extends RuntimeException {
    private final int status;
    public BusinessException(int status, String message) {
        super(message);
        this.status = status;
    }
    public static BusinessException notFound(String message) { return new BusinessException(404, message); }
    public static BusinessException forbidden(String message) { return new BusinessException(403, message); }
    public static BusinessException badRequest(String message) { return new BusinessException(400, message); }
}
```

`common/GlobalExceptionHandler.java`：

```java
package com.livedemo.live.common;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiResponse<Void>> business(BusinessException e) {
        return ResponseEntity.status(e.getStatus()).body(ApiResponse.error(String.valueOf(e.getStatus()), e.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> invalid(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .findFirst().map(f -> f.getField() + " " + f.getDefaultMessage()).orElse("参数错误");
        return ResponseEntity.badRequest().body(ApiResponse.error("400", msg));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> unknown(Exception e) {
        log.error("未处理异常", e);
        return ResponseEntity.internalServerError().body(ApiResponse.error("500", "服务器内部错误"));
    }
}
```

`config/LiveProps.java`：

```java
package com.livedemo.live.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Data
@ConfigurationProperties(prefix = "live")
public class LiveProps {
    private Auth auth = new Auth();
    private Srs srs = new Srs();

    @Data
    public static class Auth {
        private String mode = "jwt";
        private Jwt jwt = new Jwt();
    }

    @Data
    public static class Jwt {
        private String secret;
        private String jwkSetUri = "";
    }

    @Data
    public static class Srs {
        private String publicHost = "localhost";
        private int rtmpPort = 1935;
        private int apiPort = 1985;
        private int httpPort = 8080;
    }
}
```

- [ ] **Step 4: 编译验证**

```bash
cd live-service
mvn -B compile
```

预期：`BUILD SUCCESS`。

- [ ] **Step 5: Commit**

```bash
git add live-service/
git commit -m "feat(live-service): Maven 脚手架与公共响应层"
```

---

### Task 2: 房间域（实体/服务/事件）

**Files:**
- Create: `live-service/src/main/java/com/livedemo/live/room/RoomStatus.java`
- Create: `live-service/src/main/java/com/livedemo/live/room/Room.java`
- Create: `live-service/src/main/java/com/livedemo/live/room/RoomRepository.java`
- Create: `live-service/src/main/java/com/livedemo/live/room/RoomStatusChangedEvent.java`
- Create: `live-service/src/main/java/com/livedemo/live/room/PresenceProvider.java`
- Create: `live-service/src/main/java/com/livedemo/live/room/RoomDto.java`
- Create: `live-service/src/main/java/com/livedemo/live/room/CreateRoomRequest.java`
- Create: `live-service/src/main/java/com/livedemo/live/room/RoomService.java`
- Test: `live-service/src/test/java/com/livedemo/live/room/RoomServiceTest.java`

- [ ] **Step 1: 写失败测试**

`RoomServiceTest.java`：

```java
package com.livedemo.live.room;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.common.BusinessException;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class RoomServiceTest {

    private final RoomRepository repo = mock(RoomRepository.class);
    @SuppressWarnings("unchecked")
    private final ObjectProvider<PresenceProvider> presence = mock(ObjectProvider.class);
    private final RoomService service = new RoomService(repo, presence);

    private final AuthUser host = new AuthUser("u1", "主播甲", java.util.Set.of("HOST"));

    @Test
    void create_generatesStreamKeyAndSavesIdle() {
        when(repo.save(any())).thenAnswer(inv -> inv.getArgument(0));
        Room room = service.create("测试直播间", host);
        assertThat(room.getStreamKey()).matches("room-[0-9a-f]{8}");
        assertThat(room.getStatus()).isEqualTo(RoomStatus.IDLE);
        assertThat(room.getOwnerId()).isEqualTo("u1");
    }

    @Test
    void markLiving_unknownKey_throws403() {
        when(repo.findByStreamKey("bad")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.markLiving("bad"))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getStatus()).isEqualTo(403);
        verify(repo, never()).save(any());
    }

    @Test
    void markLiving_setsLivingAndPublishesEvent() {
        Room room = new Room(); room.setId(1L); room.setStreamKey("room-abc"); room.setStatus(RoomStatus.IDLE);
        when(repo.findByStreamKey("room-abc")).thenReturn(Optional.of(room));
        service.markLiving("room-abc");
        ArgumentCaptor<Room> captor = ArgumentCaptor.forClass(Room.class);
        verify(repo).save(captor.capture());
        assertThat(captor.getValue().getStatus()).isEqualTo(RoomStatus.LIVING);
    }

    @Test
    void markIdle_setsIdle() {
        Room room = new Room(); room.setId(1L); room.setStreamKey("room-abc"); room.setStatus(RoomStatus.LIVING);
        when(repo.findByStreamKey("room-abc")).thenReturn(Optional.of(room));
        service.markIdle("room-abc");
        verify(repo).save(argThat(r -> r.getStatus() == RoomStatus.IDLE));
    }

    @Test
    void end_requiresOwner() {
        Room room = new Room(); room.setId(1L); room.setOwnerId("u9");
        assertThatThrownBy(() -> service.end(room, host))
                .isInstanceOf(BusinessException.class);
    }
}
```

- [ ] **Step 2: 运行确认编译失败**

```bash
mvn -B test -pl . -Dtest=RoomServiceTest
```

预期：编译错误（`Room`/`RoomService` 等不存在）。

- [ ] **Step 3: 最小实现**

`room/RoomStatus.java`：

```java
package com.livedemo.live.room;

public enum RoomStatus { IDLE, LIVING }
```

`room/Room.java`：

```java
package com.livedemo.live.room;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "room")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Room {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 128)
    private String title;

    @Column(name = "owner_id", nullable = false, length = 64)
    private String ownerId;

    @Column(name = "owner_name", nullable = false, length = 64)
    private String ownerName;

    @Column(name = "stream_key", nullable = false, unique = true, length = 64)
    private String streamKey;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    @Builder.Default
    private RoomStatus status = RoomStatus.IDLE;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;
}
```

`room/RoomRepository.java`：

```java
package com.livedemo.live.room;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RoomRepository extends JpaRepository<Room, Long> {
    Optional<Room> findByStreamKey(String streamKey);
    List<Room> findByStatus(RoomStatus status);
}
```

`room/RoomStatusChangedEvent.java`：

```java
package com.livedemo.live.room;

public record RoomStatusChangedEvent(Long roomId, RoomStatus status) {}
```

`room/PresenceProvider.java`：

```java
package com.livedemo.live.room;

import java.util.List;

/** 在线人数来源，由 ws 层实现（Task 6）；无实现时按 0 人处理 */
public interface PresenceProvider {
    int viewers(long roomId);
    List<String> nicknames(long roomId);
}
```

`room/RoomDto.java`：

```java
package com.livedemo.live.room;

import java.time.LocalDateTime;

public record RoomDto(Long id, String title, String ownerId, String ownerName,
                      String streamKey, String pushUrl, RoomStatus status,
                      int viewerCount, int productCount, LocalDateTime createdAt) {

    public static RoomDto of(Room r, String pushUrl, boolean includeKey, int viewers) {
        return new RoomDto(r.getId(), r.getTitle(), r.getOwnerId(), r.getOwnerName(),
                includeKey ? r.getStreamKey() : null, pushUrl, r.getStatus(), viewers, 0, r.getCreatedAt());
    }
}
```

注：`productCount` 字段为 M3 电商域预留（本阶段恒为 0，M3 Task 会替换为真实计数），避免 M3 再改 DTO 结构导致前端契约变化。

`room/CreateRoomRequest.java`：

```java
package com.livedemo.live.room;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateRoomRequest(
        @NotBlank @Size(max = 128) String title) {}
```

`room/RoomService.java`：

```java
package com.livedemo.live.room;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.common.BusinessException;
import com.livedemo.live.config.LiveProps;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.List;

@Service
@RequiredArgsConstructor
public class RoomService {
    private static final SecureRandom RANDOM = new SecureRandom();

    private final RoomRepository repo;
    private final ObjectProvider<PresenceProvider> presenceProvider;
    private final ApplicationEventPublisher events;
    private final LiveProps props;

    public Room create(String title, AuthUser host) {
        Room room = Room.builder()
                .title(title)
                .ownerId(host.userId())
                .ownerName(host.nickname())
                .streamKey("room-" + randomKey())
                .status(RoomStatus.IDLE)
                .createdAt(LocalDateTime.now())
                .build();
        return repo.save(room);
    }

    public Room get(long id) {
        return repo.findById(id).orElseThrow(() -> BusinessException.notFound("房间不存在"));
    }

    public List<Room> list(RoomStatus status) {
        return status == null ? repo.findAll() : repo.findByStatus(status);
    }

    public Room update(long id, String title, AuthUser user) {
        Room room = get(id);
        assertOwner(room, user);
        room.setTitle(title);
        return repo.save(room);
    }

    public Room end(long id, AuthUser user) {
        Room room = get(id);
        assertOwner(room, user);
        room.setStatus(RoomStatus.IDLE);
        Room saved = repo.save(room);
        events.publishEvent(new RoomStatusChangedEvent(saved.getId(), saved.getStatus()));
        return saved;
    }

    public void delete(long id, AuthUser user) {
        Room room = get(id);
        if (!room.getOwnerId().equals(user.userId())) {
            user.requireRole("ADMIN");
        }
        repo.delete(room);
    }

    public Room markLiving(String streamKey) {
        Room room = repo.findByStreamKey(streamKey)
                .orElseThrow(() -> BusinessException.forbidden("非法推流键"));
        room.setStatus(RoomStatus.LIVING);
        Room saved = repo.save(room);
        events.publishEvent(new RoomStatusChangedEvent(saved.getId(), RoomStatus.LIVING));
        return saved;
    }

    public Room markIdle(String streamKey) {
        return repo.findByStreamKey(streamKey).map(room -> {
            room.setStatus(RoomStatus.IDLE);
            Room saved = repo.save(room);
            events.publishEvent(new RoomStatusChangedEvent(saved.getId(), RoomStatus.IDLE));
            return saved;
        }).orElse(null);   // 未知流的 unpublish 静默忽略（如 M1 的 test 流）
    }

    public void assertOwner(Room room, AuthUser user) {
        if (!room.getOwnerId().equals(user.userId())) {
            throw BusinessException.forbidden("仅房主可操作");
        }
    }

    public String pushUrl(Room room) {
        return "rtmp://%s:%d/live/%s".formatted(props.getSrs().getPublicHost(), props.getSrs().getRtmpPort(), room.getStreamKey());
    }

    public int viewers(long roomId) {
        PresenceProvider p = presenceProvider.getIfAvailable();
        return p == null ? 0 : p.viewers(roomId);
    }

    private String randomKey() {
        byte[] buf = new byte[4];
        RANDOM.nextBytes(buf);
        return HexFormat.of().formatHex(buf);
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
mvn -B test -Dtest=RoomServiceTest
```

预期：`Tests run: 5, Failures: 0, Errors: 0`。

- [ ] **Step 5: Commit**

```bash
git add live-service/
git commit -m "feat(live-service): 房间域实体与服务（含 SRS 状态机与事件）"
```

---

### Task 3: 认证域（AuthProvider SPI / JWT / 网关头 / 过滤器）

**Files:**
- Create: `live-service/src/main/java/com/livedemo/live/auth/AuthUser.java`
- Create: `live-service/src/main/java/com/livedemo/live/auth/AuthMode.java`
- Create: `live-service/src/main/java/com/livedemo/live/auth/AuthProvider.java`
- Create: `live-service/src/main/java/com/livedemo/live/auth/InvalidTokenException.java`
- Create: `live-service/src/main/java/com/livedemo/live/auth/JwtAuthProvider.java`
- Create: `live-service/src/main/java/com/livedemo/live/auth/GatewayHeaderAuthProvider.java`
- Create: `live-service/src/main/java/com/livedemo/live/auth/DevTokenController.java`

- [ ] **Step 1: SPI 与实体**

`auth/AuthUser.java`：

```java
package com.livedemo.live.auth;

import com.livedemo.live.common.BusinessException;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public record AuthUser(String userId, String nickname, Set<String> roles) {

    public static final String VIEWER = "VIEWER";
    public static final String HOST = "HOST";
    public static final String ADMIN = "ADMIN";

    public boolean hasRole(String role) { return roles.contains(role); }

    public void requireRole(String... anyOf) {
        for (String role : anyOf) {
            if (roles.contains(role)) return;
        }
        throw BusinessException.forbidden("权限不足");
    }

    /** roles 声明兼容 List / 逗号分隔字符串；为空默认 VIEWER */
    public static Set<String> rolesOf(Object raw) {
        List<String> parsed = new ArrayList<>();
        if (raw instanceof List<?> list) {
            list.forEach(item -> parsed.add(String.valueOf(item)));
        } else if (raw instanceof String s && !s.isBlank()) {
            for (String part : s.split(",")) parsed.add(part.trim());
        }
        if (parsed.isEmpty()) parsed.add(VIEWER);
        Set<String> result = new LinkedHashSet<>();
        for (String role : parsed) {
            String upper = role.toUpperCase();
            if (Set.of(VIEWER, HOST, ADMIN).contains(upper)) result.add(upper);
        }
        return result.isEmpty() ? Set.of(VIEWER) : Collections.unmodifiableSet(result);
    }
}
```

`auth/AuthMode.java`：

```java
package com.livedemo.live.auth;

public enum AuthMode { JWT, GATEWAY_HEADER }
```

`auth/AuthProvider.java`：

```java
package com.livedemo.live.auth;

/** 认证 SPI：接入现有系统时按其机制新增实现并切换 live.auth.mode */
public interface AuthProvider {
    /** 校验凭证并返回用户；失败抛 InvalidTokenException */
    AuthUser authenticate(String credential);
    AuthMode mode();
}
```

`auth/InvalidTokenException.java`：

```java
package com.livedemo.live.auth;

public class InvalidTokenException extends RuntimeException {
    public InvalidTokenException(String message) { super(message); }
}
```

- [ ] **Step 2: JwtAuthProvider（HS256 密钥与 RS256 JWK Set 双支持）**

`auth/JwtAuthProvider.java`：

```java
package com.livedemo.live.auth;

import com.livedemo.live.config.LiveProps;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.RemoteJWKSet;
import com.nimbusds.jose.proc.DefaultJWTProcessor;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.proc.ConfigurableJWTProcessor;
import com.nimbusds.jwt.proc.DefaultJWTClaimsVerifier;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.net.MalformedURLException;
import java.net.URL;
import java.util.Base64;
import java.util.Set;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

@Component
@RequiredArgsConstructor
public class JwtAuthProvider implements AuthProvider {

    private final LiveProps props;
    private volatile ConfigurableJWTProcessor<SecurityContext> cached;

    @Override
    public AuthUser authenticate(String credential) {
        try {
            JWTClaimsSet claims = processor().process(credential, null);
            String nickname = claims.getStringClaim("nickname");
            return new AuthUser(
                    claims.getSubject(),
                    nickname == null || nickname.isBlank() ? claims.getSubject() : nickname,
                    AuthUser.rolesOf(claims.getClaim("roles")));
        } catch (Exception e) {
            throw new InvalidTokenException("token 校验失败: " + e.getMessage());
        }
    }

    @Override
    public AuthMode mode() { return AuthMode.JWT; }

    private ConfigurableJWTProcessor<SecurityContext> processor() {
        if (cached != null) return cached;
        synchronized (this) {
            if (cached != null) return cached;
            LiveProps.Jwt cfg = props.getAuth().getJwt();
            DefaultJWTProcessor<SecurityContext> p = new DefaultJWTProcessor<>();
            JWKSource<SecurityContext> source;
            Set<JWSAlgorithm> algs;
            if (cfg.getJwkSetUri() != null && !cfg.getJwkSetUri().isBlank()) {
                algs = Set.of(JWSAlgorithm.RS256, JWSAlgorithm.RS384, JWSAlgorithm.RS512);
                try {
                    source = new RemoteJWKSet<>(new URL(cfg.getJwkSetUri()));
                } catch (MalformedURLException e) {
                    throw new IllegalStateException("jwk-set-uri 非法", e);
                }
            } else {
                algs = Set.of(JWSAlgorithm.HS256, JWSAlgorithm.HS384, JWSAlgorithm.HS512);
                SecretKey key = new SecretKeySpec(Base64.getDecoder().decode(cfg.getSecret()), "HmacSHA256");
                source = new ImmutableSecret<>(key);
            }
            p.setJWSKeySelector(new JWSVerificationKeySelector<>(algs, source));
            p.setJWTClaimsSetVerifier(new DefaultJWTClaimsVerifier<>(
                    new JWTClaimsSet.Builder().build(), Set.of("exp", "sub")));
            cached = p;
            return p;
        }
    }
}
```

- [ ] **Step 3: GatewayHeaderAuthProvider**

约定：网关认证后透传 `X-User-Id`（必填）、`X-User-Name`、`X-User-Roles`（逗号分隔）。过滤器将三值拼为 `userId|name|roles` 作为 credential。

`auth/GatewayHeaderAuthProvider.java`：

```java
package com.livedemo.live.auth;

import org.springframework.stereotype.Component;

@Component
public class GatewayHeaderAuthProvider implements AuthProvider {

    @Override
    public AuthUser authenticate(String credential) {
        String[] parts = credential.split("\\|", -1);
        if (parts.length < 1 || parts[0].isBlank()) {
            throw new InvalidTokenException("缺少网关身份头");
        }
        String nickname = parts.length > 1 && !parts[1].isBlank() ? parts[1] : parts[0];
        Object roles = parts.length > 2 ? parts[2] : null;
        return new AuthUser(parts[0], nickname, AuthUser.rolesOf(roles));
    }

    @Override
    public AuthMode mode() { return AuthMode.GATEWAY_HEADER; }
}
```

- [ ] **Step 4: DevTokenController（仅 demo profile）**

`auth/DevTokenController.java`：

```java
package com.livedemo.live.auth;

import com.livedemo.live.common.ApiResponse;
import com.livedemo.live.common.BusinessException;
import com.livedemo.live.config.LiveProps;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.HMACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.*;

import java.util.Base64;
import java.util.Date;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/auth")
@Profile("demo")
@RequiredArgsConstructor
public class DevTokenController {

    public static final long TTL_SECONDS = 12 * 3600;

    private final LiveProps props;

    @Data
    public static class DevTokenRequest {
        @NotBlank private String userId;
        @NotBlank private String nickname;
        private java.util.List<String> roles;
    }

    @PostMapping("/dev-token")
    public ApiResponse<Map<String, Object>> issue(@RequestBody DevTokenRequest req) {
        try {
            byte[] secret = Base64.getDecoder().decode(props.getAuth().getJwt().getSecret());
            long now = System.currentTimeMillis() / 1000;
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .subject(req.getUserId())
                    .claim("nickname", req.getNickname())
                    .claim("roles", AuthUser.rolesOf(req.getRoles()).stream().toList())
                    .issueTime(new Date(now * 1000))
                    .expirationTime(new Date((now + TTL_SECONDS) * 1000))
                    .jwtID(UUID.randomUUID().toString())
                    .build();
            SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
            jwt.sign(new HMACSigner(secret));
            return ApiResponse.ok(Map.of("token", jwt.serialize(), "expiresIn", TTL_SECONDS));
        } catch (Exception e) {
            throw new BusinessException(500, "签发失败: " + e.getMessage());
        }
    }
}
```

- [ ] **Step 5: Commit**

```bash
git add live-service/
git commit -m "feat(live-service): AuthProvider SPI 与 JWT/网关头双实现 + demo 签发"
```

---

### Task 4: 安全过滤链与房间 REST API

**Files:**
- Create: `live-service/src/main/java/com/livedemo/live/auth/TokenAuthFilter.java`
- Create: `live-service/src/main/java/com/livedemo/live/auth/SecurityConfig.java`
- Create: `live-service/src/main/java/com/livedemo/live/room/RoomController.java`
- Modify: `live-service/src/main/resources/application.yml`（追加 demo profile）
- Test: `live-service/src/test/java/com/livedemo/live/auth/AuthFlowTest.java`
- Test: `live-service/src/test/java/com/livedemo/live/room/RoomControllerTest.java`

- [ ] **Step 1: 写失败测试**

`AuthFlowTest.java`（整链路：签发→访问→拒绝）：

```java
package com.livedemo.live.auth;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("demo")
class AuthFlowTest {

    @Autowired MockMvc mvc;

    private String tokenOf(String userId, String nickname, List<String> roles) throws Exception {
        String body = new com.fasterxml.jackson.databind.ObjectMapper()
                .writeValueAsString(Map.of("userId", userId, "nickname", nickname, "roles", roles));
        String resp = mvc.perform(post("/api/auth/dev-token").contentType("application/json").content(body))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return String.valueOf(com.jayway.jsonpath.JsonPath.read(resp, "$.data.token"));
    }

    @Test
    void devToken_grantsAccess() throws Exception {
        String token = tokenOf("u1", "主播甲", List.of("HOST"));
        // 列表接口公开，用创建接口验证鉴权链
        mvc.perform(post("/api/rooms").header("Authorization", "Bearer " + token)
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.streamKey").value(org.hamcrest.Matchers.matchesPattern("room-[0-9a-f]{8}")));
    }

    @Test
    void missingToken_returns401() throws Exception {
        mvc.perform(post("/api/rooms").contentType("application/json").content("{\"title\":\"t\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void garbageToken_returns401() throws Exception {
        mvc.perform(post("/api/rooms").header("Authorization", "Bearer garbage")
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void viewerCannotCreateRoom() throws Exception {
        String token = tokenOf("u2", "观众甲", List.of("VIEWER"));
        mvc.perform(post("/api/rooms").header("Authorization", "Bearer " + token)
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andExpect(status().isForbidden());
    }
}
```

`RoomControllerTest.java`（公开接口与房间操作权限）：

```java
package com.livedemo.live.room;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.auth.DevTokenController;
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
class RoomControllerTest {

    @Autowired MockMvc mvc;
    @Autowired DevTokenController devTokenController;

    private String token(AuthUser user) {
        // 复用 JwtAuthProvider 密钥直接构造，走完整验签链路
        return new TestTokens().sign(user);
    }

    @Test
    void listRooms_isPublic() throws Exception {
        mvc.perform(get("/api/rooms")).andExpect(status().isOk()).andExpect(jsonPath("$.code").value("0"));
    }

    @Test
    void hostCanCreateAndViewOwnRoom() throws Exception {
        String token = token(new AuthUser("h1", "主播甲", java.util.Set.of("HOST")));
        String resp = mvc.perform(post("/api/rooms").header("Authorization", "Bearer " + token)
                        .contentType("application/json").content("{\"title\":\"我的房间\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        Integer id = com.jayway.jsonpath.JsonPath.read(resp, "$.data.id");
        mvc.perform(get("/api/rooms/" + id)).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.title").value("我的房间"));
    }

    @Test
    void nonOwnerCannotEndRoom() throws Exception {
        String owner = token(new AuthUser("h1", "主播甲", java.util.Set.of("HOST")));
        String other = token(new AuthUser("h2", "主播乙", java.util.Set.of("HOST")));
        String resp = mvc.perform(post("/api/rooms").header("Authorization", "Bearer " + owner)
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andReturn().getResponse().getContentAsString();
        Integer id = com.jayway.jsonpath.JsonPath.read(resp, "$.data.id");
        mvc.perform(post("/api/rooms/" + id + "/end").header("Authorization", "Bearer " + other))
                .andExpect(status().isForbidden());
    }
}
```

`TestTokens.java`（测试工具类，用同一密钥签发）：

```java
package com.livedemo.live.auth;

import com.livedemo.live.config.LiveProps;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.HMACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.Base64;
import java.util.Date;

@Component
public class TestTokens {
    @Autowired LiveProps props;

    public String sign(AuthUser user) {
        try {
            byte[] secret = Base64.getDecoder().decode(props.getAuth().getJwt().getSecret());
            long now = System.currentTimeMillis() / 1000;
            SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256),
                    new JWTClaimsSet.Builder()
                            .subject(user.userId())
                            .claim("nickname", user.nickname())
                            .claim("roles", user.roles().stream().toList())
                            .expirationTime(new Date((now + 3600) * 1000))
                            .build());
            jwt.sign(new HMACSigner(secret));
            return jwt.serialize();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
```

- [ ] **Step 2: 运行确认失败**

```bash
mvn -B test -Dtest='AuthFlowTest,RoomControllerTest'
```

预期：编译失败（`TokenAuthFilter`/`SecurityConfig`/`RoomController` 不存在）。

- [ ] **Step 3: 实现 TokenAuthFilter 与 SecurityConfig**

`auth/TokenAuthFilter.java`：

```java
package com.livedemo.live.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

@RequiredArgsConstructor
public class TokenAuthFilter extends OncePerRequestFilter {

    public static final String ATTR = "authUser";

    private final List<AuthProvider> providers;
    private final AuthMode mode;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String credential = extract(request);
        if (credential != null) {
            AuthProvider provider = providers.stream().filter(p -> p.mode() == mode).findFirst()
                    .orElseThrow(() -> new IllegalStateException("未找到 mode=" + mode + " 的 AuthProvider"));
            try {
                request.setAttribute(ATTR, provider.authenticate(credential));
            } catch (InvalidTokenException e) {
                response.setStatus(401);
                response.setContentType("application/json;charset=UTF-8");
                response.getWriter().write("{\"code\":\"401\",\"message\":\"" + e.getMessage() + "\"}");
                return;
            }
        }
        chain.doFilter(request, response);
    }

    private String extract(HttpServletRequest request) {
        if (mode == AuthMode.GATEWAY_HEADER) {
            String userId = request.getHeader("X-User-Id");
            if (userId == null || userId.isBlank()) return null;
            return String.join("|", userId,
                    request.getHeader("X-User-Name") == null ? "" : request.getHeader("X-User-Name"),
                    request.getHeader("X-User-Roles") == null ? "" : request.getHeader("X-User-Roles"));
        }
        String auth = request.getHeader("Authorization");
        if (auth == null || !auth.startsWith("Bearer ")) return null;
        return auth.substring(7).trim();
    }
}
```

`auth/SecurityConfig.java`：

```java
package com.livedemo.live.auth;

import com.livedemo.live.config.LiveProps;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

import java.util.List;
import java.util.Map;

@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final List<AuthProvider> providers;
    private final LiveProps props;
    private final ObjectMapper om;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.GET, "/api/rooms", "/api/rooms/*", "/api/rooms/*/play-urls").permitAll()
                .requestMatchers("/api/auth/**", "/api/v1/srs/hooks", "/ws").permitAll()
                .anyRequest().authenticated())
            .exceptionHandling(e -> e
                .authenticationEntryPoint((req, res, ex) -> write(res, 401, "未认证"))
                .accessDeniedHandler((req, res, ex) -> write(res, 403, "权限不足")))
            .addFilterBefore(new TokenAuthFilter(providers, AuthMode.valueOf(props.getAuth().getMode())),
                    UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    private void write(HttpServletResponse res, int status, String message) throws java.io.IOException {
        res.setStatus(status);
        res.setContentType("application/json;charset=UTF-8");
        res.getWriter().write(om.writeValueAsString(Map.of("code", String.valueOf(status), "message", message)));
    }
}
```

- [ ] **Step 4: 实现 RoomController**

`room/RoomController.java`：

```java
package com.livedemo.live.room;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.auth.TokenAuthFilter;
import com.livedemo.live.common.ApiResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/rooms")
@RequiredArgsConstructor
public class RoomController {

    private final RoomService service;

    public record UpdateRoomRequest(String title) {}

    @PostMapping
    public ApiResponse<RoomDto> create(@RequestBody @Valid CreateRoomRequest req,
                                       @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        user.requireRole(AuthUser.HOST, AuthUser.ADMIN);
        Room room = service.create(req.title(), user);
        return ApiResponse.ok(RoomDto.of(room, service.pushUrl(room), true, 0));
    }

    @GetMapping
    public ApiResponse<List<RoomDto>> list(@RequestParam(required = false) RoomStatus status) {
        return ApiResponse.ok(service.list(status).stream()
                .map(r -> RoomDto.of(r, null, false, service.viewers(r.getId())))
                .toList());
    }

    @GetMapping("/{id}")
    public ApiResponse<RoomDto> detail(@PathVariable long id) {
        Room room = service.get(id);
        return ApiResponse.ok(RoomDto.of(room, service.pushUrl(room), false, service.viewers(id)));
    }

    @PatchMapping("/{id}")
    public ApiResponse<RoomDto> update(@PathVariable long id, @RequestBody UpdateRoomRequest req,
                                       @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        return ApiResponse.ok(RoomDto.of(service.update(id, req.title(), user), null, false, 0));
    }

    @PostMapping("/{id}/end")
    public ApiResponse<RoomDto> end(@PathVariable long id,
                                    @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        return ApiResponse.ok(RoomDto.of(service.end(id, user), null, false, 0));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable long id,
                                    @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        service.delete(id, user);
        return ApiResponse.ok(null);
    }

    @GetMapping("/{id}/play-urls")
    public ApiResponse<PlayUrls> playUrls(@PathVariable long id) {
        Room room = service.get(id);
        String host = host();
        return ApiResponse.ok(new PlayUrls(
                "http://%s:%d/rtc/v1/whep/?app=live&stream=%s".formatted(host, apiPort(), room.getStreamKey()),
                "http://%s:%d/live/%s.flv".formatted(host, httpPort(), room.getStreamKey()),
                "http://%s:%d/live/%s.m3u8".formatted(host, httpPort(), room.getStreamKey())));
    }

    public record PlayUrls(String webrtc, String flv, String hls) {}

    private String host() { return com.livedemo.live.config.SpringEnv.props().getSrs().getPublicHost(); }
    private int apiPort() { return com.livedemo.live.config.SpringEnv.props().getSrs().getApiPort(); }
    private int httpPort() { return com.livedemo.live.config.SpringEnv.props().getSrs().getHttpPort(); }
}
```

注意：上面 `SpringEnv` 是伪代码占位，**实现时直接注入 `LiveProps`**。最终正确版本：

```java
package com.livedemo.live.room;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.auth.TokenAuthFilter;
import com.livedemo.live.common.ApiResponse;
import com.livedemo.live.config.LiveProps;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/rooms")
@RequiredArgsConstructor
public class RoomController {

    private final RoomService service;
    private final LiveProps props;

    public record UpdateRoomRequest(String title) {}
    public record PlayUrls(String webrtc, String flv, String hls) {}

    @PostMapping
    public ApiResponse<RoomDto> create(@RequestBody @Valid CreateRoomRequest req,
                                       @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        user.requireRole(AuthUser.HOST, AuthUser.ADMIN);
        Room room = service.create(req.title(), user);
        return ApiResponse.ok(RoomDto.of(room, service.pushUrl(room), true, 0));
    }

    @GetMapping
    public ApiResponse<List<RoomDto>> list(@RequestParam(required = false) RoomStatus status) {
        return ApiResponse.ok(service.list(status).stream()
                .map(r -> RoomDto.of(r, null, false, service.viewers(r.getId())))
                .toList());
    }

    @GetMapping("/{id}")
    public ApiResponse<RoomDto> detail(@PathVariable long id) {
        Room room = service.get(id);
        return ApiResponse.ok(RoomDto.of(room, service.pushUrl(room), false, service.viewers(id)));
    }

    @PatchMapping("/{id}")
    public ApiResponse<RoomDto> update(@PathVariable long id, @RequestBody UpdateRoomRequest req,
                                       @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        return ApiResponse.ok(RoomDto.of(service.update(id, req.title(), user), null, false, 0));
    }

    @PostMapping("/{id}/end")
    public ApiResponse<RoomDto> end(@PathVariable long id,
                                    @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        return ApiResponse.ok(RoomDto.of(service.end(id, user), null, false, 0));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable long id,
                                    @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        service.delete(id, user);
        return ApiResponse.ok(null);
    }

    @GetMapping("/{id}/play-urls")
    public ApiResponse<PlayUrls> playUrls(@PathVariable long id) {
        Room room = service.get(id);
        String host = props.getSrs().getPublicHost();
        String key = room.getStreamKey();
        return ApiResponse.ok(new PlayUrls(
                "http://%s:%d/rtc/v1/whep/?app=live&stream=%s".formatted(host, props.getSrs().getApiPort(), key),
                "http://%s:%d/live/%s.flv".formatted(host, props.getSrs().getHttpPort(), key),
                "http://%s:%d/live/%s.m3u8".formatted(host, props.getSrs().getHttpPort(), key)));
    }
}
```

（`TestTokens` 与 `AuthFlowTest` 中 `devTokenController` 字段未使用可删除；保留 `TestTokens` 即可。）

- [ ] **Step 5: application.yml 追加 demo profile**

在 `application.yml` 末尾追加：

```yaml
---
spring:
  config:
    activate:
      on-profile: demo
logging:
  level:
    com.livedemo.live.auth: DEBUG
```

- [ ] **Step 6: 运行测试确认通过**

```bash
mvn -B test -Dtest='AuthFlowTest,RoomControllerTest,RoomServiceTest'
```

预期：全部 PASS（AuthFlowTest 4 个、RoomControllerTest 3 个、RoomServiceTest 5 个）。

- [ ] **Step 7: Commit**

```bash
git add live-service/
git commit -m "feat(live-service): 安全过滤链(JWT/网关头) + 房间 REST API + play-urls"
```

---

### Task 5: SRS 回调接口

**Files:**
- Create: `live-service/src/main/java/com/livedemo/live/hook/SrsHookController.java`
- Test: `live-service/src/test/java/com/livedemo/live/hook/SrsHookControllerTest.java`

- [ ] **Step 1: 写失败测试**

`SrsHookControllerTest.java`：

```java
package com.livedemo.live.hook;

import com.livedemo.live.room.RoomService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(SrsHookController.class)
@Import(SrsHookControllerTest.HookPermitAll.class)
class SrsHookControllerTest {

    @Autowired MockMvc mvc;
    @MockBean RoomService roomService;

    @TestConfiguration
    @EnableWebSecurity
    static class HookPermitAll {
        @Bean
        public SecurityFilterChain hookChain(HttpSecurity http) throws Exception {
            http.csrf(c -> c.disable()).authorizeHttpRequests(a -> a.anyRequest().permitAll());
            return http.build();
        }
    }

    private String body(String action, String stream) {
        return "{\"action\":\"%s\",\"app\":\"live\",\"stream\":\"%s\",\"param\":\"\"}".formatted(action, stream);
    }

    @Test
    void onPublish_ok() throws Exception {
        mvc.perform(post("/api/v1/srs/hooks").contentType(MediaType.APPLICATION_JSON)
                        .content(body("on_publish", "room-ab12cd34")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
    }

    @Test
    void onPublish_unknownKey_returns403() throws Exception {
        doThrow(new com.livedemo.live.common.BusinessException(403, "非法推流键"))
                .when(roomService).markLiving("bad");
        mvc.perform(post("/api/v1/srs/hooks").contentType(MediaType.APPLICATION_JSON)
                        .content(body("on_publish", "bad")))
                .andExpect(status().isForbidden());
    }

    @Test
    void onUnpublish_ok() throws Exception {
        mvc.perform(post("/api/v1/srs/hooks").contentType(MediaType.APPLICATION_JSON)
                        .content(body("on_unpublish", "room-ab12cd34")))
                .andExpect(status().isOk());
    }
}
```

- [ ] **Step 2: 运行确认失败**

```bash
mvn -B test -Dtest=SrsHookControllerTest
```

预期：编译失败（`SrsHookController` 不存在）。

- [ ] **Step 3: 实现**

`hook/SrsHookController.java`：

```java
package com.livedemo.live.hook;

import com.livedemo.live.room.RoomService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/v1/srs")
@RequiredArgsConstructor
public class SrsHookController {

    private final RoomService roomService;

    /** SRS http_hook 回调入口：on_publish 校验推流键并置 LIVING，on_unpublish 置 IDLE */
    @PostMapping("/hooks")
    public ResponseEntity<Map<String, Object>> onHook(@RequestBody Map<String, Object> body) {
        String action = String.valueOf(body.get("action"));
        String stream = String.valueOf(body.get("stream"));
        log.debug("SRS hook: action={} stream={}", action, stream);
        switch (action) {
            case "on_publish" -> roomService.markLiving(stream);
            case "on_unpublish" -> roomService.markIdle(stream);
            default -> log.debug("忽略回调 {}", action);
        }
        return ResponseEntity.ok(Map.of("code", 0));
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
mvn -B test -Dtest=SrsHookControllerTest
```

预期：`Tests run: 3, Failures: 0`。

- [ ] **Step 5: Commit**

```bash
git add live-service/
git commit -m "feat(live-service): SRS http_hook 回调驱动房间状态机"
```

---

### Task 6: WebSocket 弹幕与在线人数

**Files:**
- Create: `live-service/src/main/java/com/livedemo/live/chat/ChatMessage.java`
- Create: `live-service/src/main/java/com/livedemo/live/chat/ChatService.java`
- Create: `live-service/src/main/java/com/livedemo/live/ws/RoomSessionRegistry.java`
- Create: `live-service/src/main/java/com/livedemo/live/ws/WsEventSender.java`
- Create: `live-service/src/main/java/com/livedemo/live/ws/RoomSocketHandler.java`
- Create: `live-service/src/main/java/com/livedemo/live/ws/WsConfig.java`
- Create: `live-service/src/main/java/com/livedemo/live/ws/RoomStatusListener.java`
- Modify: `live-service/src/main/java/com/livedemo/live/ws/RoomSessionRegistry.java`（实现 PresenceProvider）
- Test: `live-service/src/test/java/com/livedemo/live/chat/ChatServiceTest.java`

- [ ] **Step 1: 写失败测试**

`ChatServiceTest.java`：

```java
package com.livedemo.live.chat;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ChatServiceTest {

    private final ChatService service = new ChatService();

    @Test
    void history_keepsNewest50() {
        for (int i = 1; i <= 60; i++) {
            service.append(1L, "u1", "n", "msg-" + i);
        }
        List<ChatMessage> history = service.history(1L);
        assertThat(history).hasSize(50);
        assertThat(history.get(0).content()).isEqualTo("msg-11");   // 最早的被淘汰
        assertThat(history.get(49).content()).isEqualTo("msg-60");  // 最新在尾部
    }

    @Test
    void append_assignsUniqueIds() {
        ChatMessage a = service.append(1L, "u1", "n", "a");
        ChatMessage b = service.append(1L, "u1", "n", "b");
        assertThat(a.messageId()).isNotEqualTo(b.messageId());
    }

    @Test
    void rooms_areIsolated() {
        service.append(1L, "u1", "n", "a");
        assertThat(service.history(2L)).isEmpty();
    }

    @Test
    void removeMessage_deletesFromHistory() {
        ChatMessage m = service.append(1L, "u1", "n", "bad");
        assertThat(service.removeMessage(1L, m.messageId())).isTrue();
        assertThat(service.history(1L)).isEmpty();
        assertThat(service.removeMessage(1L, "nope")).isFalse();
    }
}
```

- [ ] **Step 2: 运行确认失败**

```bash
mvn -B test -Dtest=ChatServiceTest
```

预期：编译失败。

- [ ] **Step 3: 实现聊天与 WS 层**

`chat/ChatMessage.java`：

```java
package com.livedemo.live.chat;

public record ChatMessage(String messageId, String userId, String nickname, String content, long ts) {}
```

`chat/ChatService.java`：

```java
package com.livedemo.live.chat;

import org.springframework.stereotype.Service;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class ChatService {

    static final int HISTORY_MAX = 50;

    private final Map<Long, Deque<ChatMessage>> historyByRoom = new ConcurrentHashMap<>();

    public List<ChatMessage> history(long roomId) {
        Deque<ChatMessage> deque = historyByRoom.get(roomId);
        if (deque == null) return List.of();
        synchronized (deque) {
            return List.copyOf(deque);
        }
    }

    public ChatMessage append(long roomId, String userId, String nickname, String content) {
        ChatMessage message = new ChatMessage(UUID.randomUUID().toString(), userId, nickname, content,
                System.currentTimeMillis());
        Deque<ChatMessage> deque = historyByRoom.computeIfAbsent(roomId, k -> new ArrayDeque<>());
        synchronized (deque) {
            deque.addLast(message);
            while (deque.size() > HISTORY_MAX) deque.pollFirst();
        }
        return message;
    }

    /** 主播/管理员删弹幕用；返回是否找到并删除 */
    public boolean removeMessage(long roomId, String messageId) {
        Deque<ChatMessage> deque = historyByRoom.get(roomId);
        if (deque == null) return false;
        synchronized (deque) {
            for (Iterator<ChatMessage> it = deque.iterator(); it.hasNext(); ) {
                if (it.next().messageId().equals(messageId)) {
                    it.remove();
                    return true;
                }
            }
        }
        return false;
    }
}
```

`ws/RoomSessionRegistry.java`：

```java
package com.livedemo.live.ws;

import com.livedemo.live.room.PresenceProvider;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

@Component
public class RoomSessionRegistry implements PresenceProvider {

    private final Map<Long, List<SessionInfo>> byRoom = new ConcurrentHashMap<>();
    private final Map<String, List<SessionInfo>> byUser = new ConcurrentHashMap<>();

    public record SessionInfo(WebSocketSession session, String userId, String nickname) {}

    public void add(long roomId, SessionInfo info) {
        byRoom.computeIfAbsent(roomId, k -> new CopyOnWriteArrayList<>()).add(info);
        byUser.computeIfAbsent(info.userId(), k -> new CopyOnWriteArrayList<>()).add(info);
    }

    public void remove(long roomId, WebSocketSession session) {
        var list = byRoom.get(roomId);
        if (list != null) list.removeIf(info -> info.session().getId().equals(session.getId()));
        byUser.values().forEach(l -> l.removeIf(info -> info.session().getId().equals(session.getId())));
    }

    public List<SessionInfo> sessions(long roomId) {
        var list = byRoom.get(roomId);
        if (list == null) return List.of();
        return list.stream().filter(i -> i.session().isOpen()).toList();
    }

    /** 平台封禁：踢掉该用户全部连接 */
    public List<SessionInfo> closeAllOf(String userId) {
        var list = byUser.getOrDefault(userId, List.of());
        list.forEach(info -> {
            try { info.session().close(); } catch (Exception ignored) {}
        });
        return list;
    }

    @Override
    public int viewers(long roomId) { return sessions(roomId).size(); }

    @Override
    public List<String> nicknames(long roomId) {
        return sessions(roomId).stream().map(SessionInfo::nickname).toList();
    }
}
```

`ws/WsEventSender.java`：

```java
package com.livedemo.live.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

@Slf4j
@Component
@RequiredArgsConstructor
public class WsEventSender {

    private final RoomSessionRegistry registry;
    private final ObjectMapper om;

    public void send(WebSocketSession session, Object payload) {
        try {
            session.sendMessage(new TextMessage(om.writeValueAsString(payload)));
        } catch (Exception e) {
            log.warn("WS 发送失败: {}", e.getMessage());
        }
    }

    public void broadcast(long roomId, Object payload) {
        String json = toJson(payload);
        registry.sessions(roomId).forEach(info -> {
            try {
                synchronized (info.session()) {
                    info.session().sendMessage(new TextMessage(json));
                }
            } catch (Exception e) {
                log.warn("WS 广播失败: {}", e.getMessage());
            }
        });
    }

    public void broadcastPresence(long roomId) {
        broadcast(roomId, java.util.Map.of(
                "type", "presence",
                "viewers", registry.viewers(roomId),
                "users", registry.nicknames(roomId)));
    }

    private String toJson(Object payload) {
        try { return om.writeValueAsString(payload); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
}
```

`ws/RoomSocketHandler.java`：

```java
package com.livedemo.live.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.livedemo.live.chat.ChatMessage;
import com.livedemo.live.chat.ChatService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class RoomSocketHandler extends TextWebSocketHandler {

    public static final String ATTR_ROOM_ID = "roomId";
    public static final String ATTR_USER_ID = "userId";
    public static final String ATTR_NICKNAME = "nickname";

    private final RoomSessionRegistry registry;
    private final WsEventSender sender;
    private final ChatService chatService;
    private final ObjectMapper om;

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        long roomId = roomId(session);
        registry.add(roomId, new RoomSessionRegistry.SessionInfo(session,
                (String) session.getAttributes().get(ATTR_USER_ID),
                (String) session.getAttributes().get(ATTR_NICKNAME)));
        sender.send(session, Map.of("type", "history", "messages", chatService.history(roomId)));
        sender.broadcastPresence(roomId);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        long roomId = roomId(session);
        String userId = (String) session.getAttributes().get(ATTR_USER_ID);
        String nickname = (String) session.getAttributes().get(ATTR_NICKNAME);
        try {
            JsonNode node = om.readTree(message.getPayload());
            if (!"chat".equals(node.path("type").asText())) return;
            String content = node.path("content").asText("").trim();
            if (content.isEmpty()) return;
            ChatMessage msg = chatService.append(roomId, userId, nickname, content);
            sender.broadcast(roomId, Map.of(
                    "type", "chat",
                    "messageId", msg.messageId(),
                    "userId", msg.userId(),
                    "nickname", msg.nickname(),
                    "content", msg.content(),
                    "ts", msg.ts()));
            sender.broadcastPresence(roomId);
        } catch (Exception e) {
            log.warn("WS 消息处理失败: {}", e.getMessage());
            sender.send(session, Map.of("type", "error", "code", "E_FORMAT", "message", "消息格式错误"));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        long roomId = roomId(session);
        registry.remove(roomId, session);
        sender.broadcastPresence(roomId);
    }

    private long roomId(WebSocketSession session) {
        return ((Number) session.getAttributes().get(ATTR_ROOM_ID)).longValue();
    }
}
```

`ws/WsConfig.java`（含握手鉴权拦截器）：

```java
package com.livedemo.live.ws;

import com.livedemo.live.auth.AuthMode;
import com.livedemo.live.auth.AuthProvider;
import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.auth.InvalidTokenException;
import com.livedemo.live.config.LiveProps;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.util.List;
import java.util.Map;

@Configuration
@EnableWebSocket
@RequiredArgsConstructor
public class WsConfig implements WebSocketConfigurer {

    private final RoomSocketHandler handler;
    private final List<AuthProvider> providers;
    private final LiveProps props;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/ws")
                .addInterceptors(new AuthHandshakeInterceptor())
                .setAllowedOriginPatterns("*");
    }

    /** 浏览器原生 WebSocket 无法带自定义头：JWT 走 token 查询参数；gateway 模式信任反代注入的头 */
    class AuthHandshakeInterceptor implements HandshakeInterceptor {
        @Override
        public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                       WebSocketHandler wsHandler, Map<String, Object> attributes) {
            if (!(request instanceof ServletServerHttpRequest servlet)) return false;
            var req = servlet.getServletRequest();
            long roomId;
            try {
                roomId = Long.parseLong(req.getParameter("roomId"));
            } catch (Exception e) {
                return false;
            }
            AuthUser user;
            if (props.getAuth().getMode().equalsIgnoreCase("gateway")) {
                String userId = req.getHeader("X-User-Id");
                if (userId == null || userId.isBlank()) return false;
                user = new AuthUser(userId,
                        req.getHeader("X-User-Name") == null ? userId : req.getHeader("X-User-Name"),
                        AuthUser.rolesOf(req.getHeader("X-User-Roles")));
            } else {
                String token = req.getParameter("token");
                if (token == null || token.isBlank()) return false;
                AuthProvider provider = providers.stream()
                        .filter(p -> p.mode() == AuthMode.JWT).findFirst().orElseThrow();
                try {
                    user = provider.authenticate(token);
                } catch (InvalidTokenException e) {
                    return false;
                }
            }
            attributes.put(RoomSocketHandler.ATTR_ROOM_ID, roomId);
            attributes.put(RoomSocketHandler.ATTR_USER_ID, user.userId());
            attributes.put(RoomSocketHandler.ATTR_NICKNAME, user.nickname());
            return true;
        }

        @Override
        public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Exception exception) {}
    }
}
```

`ws/RoomStatusListener.java`：

```java
package com.livedemo.live.ws;

import com.livedemo.live.room.RoomStatusChangedEvent;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.util.Map;

@Component
@RequiredArgsConstructor
public class RoomStatusListener {

    private final WsEventSender sender;

    @EventListener
    public void on(RoomStatusChangedEvent event) {
        sender.broadcast(event.roomId(), Map.of("type", "room_status", "status", event.status().name()));
    }
}
```

- [ ] **Step 4: 运行全部测试**

```bash
mvn -B test
```

预期：全部 PASS（含 Task 6 的 ChatServiceTest 4 个）。

- [ ] **Step 5: Commit**

```bash
git add live-service/
git commit -m "feat(live-service): WebSocket 弹幕/在线人数/房间状态广播"
```

---

### Task 7: Dockerfile 与 compose 接入

**Files:**
- Create: `live-service/Dockerfile`
- Modify: `docker-compose.yml`（追加 live-service 服务）

- [ ] **Step 1: Dockerfile（多阶段构建）**

```dockerfile
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -B dependency:go-offline
COPY src ./src
RUN mvn -B package -DskipTests

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /src/target/live-service-0.1.0.jar app.jar
EXPOSE 8081
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

- [ ] **Step 2: docker-compose.yml 追加服务**

在 `services:` 下追加（与 srs 平级），并在文件尾追加 volumes 声明：

```yaml
  live-service:
    build: ./live-service
    container_name: livedemo-api
    restart: unless-stopped
    ports:
      - "8081:8081"
    environment:
      - SPRING_PROFILES_ACTIVE=demo
      - LIVE_JWT_SECRET=${LIVE_JWT_SECRET:-ZGVtb19kZW1vX2RlbW9fZGVtb19kZW1vX2RlbW8xMjM0NQ==}
    volumes:
      - livedemo-data:/app/data

volumes:
  livedemo-data:
```

- [ ] **Step 3: 构建并启动验证**

```bash
docker compose up -d --build live-service
curl -s http://localhost:8081/api/rooms
```

预期：`{"code":"0","message":"ok","data":[]}`。

- [ ] **Step 4: Commit**

```bash
git add live-service/Dockerfile docker-compose.yml
git commit -m "feat(live-service): 容器化并接入 compose"
```

---

### Task 8: SRS 回调接入与全链路验证

**Files:**
- Modify: `srs/srs.conf`（http_api 内追加 http_hook）
- Modify: `docker-compose.yml`（srs 增加对 live-service 的依赖说明，无需 depends_on——回调失败由 SRS 重试）

- [ ] **Step 1: srs.conf 的 http_api 块追加 http_hook**

```conf
http_api {
    enabled         on;
    listen          1985;
    http_hook {
        enabled         on;
        on_publish      http://live-service:8081/api/v1/srs/hooks;
        on_unpublish    http://live-service:8081/api/v1/srs/hooks;
    }
}
```

- [ ] **Step 2: 重启全栈**

```bash
docker compose up -d --build
```

注意：SRS 容器需能解析 `live-service` 主机名——两服务同在 compose 默认网络，天然可解析。

- [ ] **Step 3: PowerShell 全链路验证（开播）**

```powershell
# 1. 签发主播 token
$resp = Invoke-RestMethod -Method Post -Uri http://localhost:8081/api/auth/dev-token `
  -ContentType "application/json" -Body '{"userId":"host1","nickname":"主播甲","roles":["HOST"]}'
$token = $resp.data.token

# 2. 创建房间
$room = Invoke-RestMethod -Method Post -Uri http://localhost:8081/api/rooms `
  -Headers @{Authorization = "Bearer $token"} `
  -ContentType "application/json" -Body '{"title":"验证直播间"}'
$key = $room.data.streamKey
"streamKey = $key"

# 3. ffmpeg 推流（另开终端，或后台任务）
# ffmpeg -re -f lavfi -i "testsrc2=size=1280x720:rate=30" -f lavfi -i "sine=frequency=1000" -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p -c:a aac -f flv "rtmp://localhost:1935/live/$key"

# 4. 推流后 5 秒内查询
(Invoke-RestMethod http://localhost:8081/api/rooms).data | ConvertTo-Json
```

预期：房间 `status` 为 `LIVING`。

- [ ] **Step 4: 停推验证（关播）**

停止 ffmpeg 后 10 秒内再查 `GET /api/rooms`，预期 `status` 回到 `IDLE`。

- [ ] **Step 5: 非法推流键验证**

```bash
ffmpeg -re -f lavfi -i "testsrc2=size=640x360:rate=25" -c:v libx264 -t 3 -f flv rtmp://localhost:1935/live/not-a-key
```

预期：推流被 SRS 拒绝（SRS 日志出现 `callback ... on_publish` 相关错误），live-service 日志出现 403 记录。

- [ ] **Step 6: WS 冒烟（浏览器控制台）**

```js
// 1. 取 token
const r = await fetch("http://localhost:8081/api/auth/dev-token", {method:"POST",
  headers:{"Content-Type":"application/json"},
  body: JSON.stringify({userId:"v1", nickname:"观众甲", roles:["VIEWER"]})});
const token = (await r.json()).data.token;
// 2. 连房间 1 的 WS（roomId 换成实际房间 id）
const ws = new WebSocket(`ws://localhost:8081/ws?roomId=1&token=${token}`);
ws.onmessage = e => console.log(JSON.parse(e.data));
// 3. 发一条弹幕
ws.send(JSON.stringify({type:"chat", content:"你好直播间"}));
```

预期：控制台先收到 `history`、`presence`，发送后收到回显 `chat` 消息。

- [ ] **Step 7: Commit**

```bash
git add srs/srs.conf
git commit -m "feat(srs): 接入 live-service 回调，完成开播/关播状态机闭环"
```

---

## 自审记录

- 设计覆盖：§3 认证 SPI/JWT/dev-token ✓（gateway 模式为代码实现，验证靠单测与头模拟）；§5.1 room 表 ✓；§5.3 房间 API+play-urls+hooks ✓；§5.4 状态机 ✓（on_close 有意不用）；§5.5 WS（history/chat/presence/room_status）✓（product_update/message_deleted/muted 在 M3/M4 计划）；频控与敏感词归 M4 ✓
- 类型一致性：`AuthUser.rolesOf` / `TokenAuthFilter.ATTR` / `PresenceProvider` 跨任务签名一致 ✓
- 无占位符：RoomController 两个版本已明确以注入 LiveProps 的版本为准 ✓
