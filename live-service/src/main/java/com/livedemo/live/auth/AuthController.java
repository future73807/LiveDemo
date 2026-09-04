package com.livedemo.live.auth;

import com.livedemo.live.common.ApiResponse;
import com.livedemo.live.common.BusinessException;
import com.livedemo.live.safety.BanService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.Set;

/** internal 模式自有账号体系；jwt/gateway 模式下本控制器不装配（SSO 对接语义） */
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
@ConditionalOnProperty(name = "live.auth.mode", havingValue = "internal")
public class AuthController {

    public static final long TTL_SECONDS = 12 * 3600;

    private final UserAccountRepository users;
    private final org.springframework.security.crypto.password.PasswordEncoder encoder;
    private final JwtIssuer issuer;
    private final BanService banService;
    private final LoginGuard guard;

    public record AuthConfig(String mode, boolean registrationEnabled) {}
    public record AuthPayload(String token, long expiresIn, AuthUser user) {}

    @Data
    public static class RegisterRequest {
        @NotBlank @Pattern(regexp = "^[a-zA-Z0-9_]{4,32}$", message = "用户名 4-32 位字母数字下划线")
        private String username;
        @NotBlank @Size(min = 6, max = 64) private String password;
        @NotBlank @Size(max = 64) private String nickname;
        @NotBlank private String role;
    }

    @Data
    public static class LoginRequest {
        @NotBlank private String username;
        @NotBlank private String password;
    }

    /** 前端自适应依据：模式与是否开放注册（任意模式可访问） */
    @GetMapping("/config")
    public ApiResponse<AuthConfig> config() {
        return ApiResponse.ok(new AuthConfig("internal", true));
    }

    @PostMapping("/register")
    public ApiResponse<AuthPayload> register(@RequestBody @jakarta.validation.Valid RegisterRequest req) {
        if (!Set.of(AuthUser.VIEWER, AuthUser.HOST).contains(req.getRole().toUpperCase())) {
            throw BusinessException.badRequest("role 仅支持 VIEWER/HOST");
        }
        if (users.existsById(req.getUsername())) {
            throw BusinessException.badRequest("用户名已存在");
        }
        users.save(UserAccount.builder()
                .userId(req.getUsername())
                .password(encoder.encode(req.getPassword()))
                .nickname(req.getNickname())
                .role(req.getRole().toUpperCase())
                .createdAt(LocalDateTime.now())
                .build());
        return ApiResponse.ok(payload(req.getUsername(), req.getNickname(), req.getRole().toUpperCase()));
    }

    @PostMapping("/login")
    public ApiResponse<AuthPayload> login(@RequestBody @jakarta.validation.Valid LoginRequest req,
                                          HttpServletRequest request) {
        String ip = clientIp(request);
        if (!guard.allow(ip)) {
            throw new BusinessException(429, "登录过于频繁，请稍后再试");
        }
        UserAccount account = users.findById(req.getUsername())
                .orElseThrow(() -> new BusinessException(401, "用户名或密码错误"));
        if (!encoder.matches(req.getPassword(), account.getPassword())) {
            throw new BusinessException(401, "用户名或密码错误");
        }
        if (banService.isBanned(account.getUserId())) {
            throw BusinessException.forbidden("账号已被封禁");
        }
        return ApiResponse.ok(payload(account.getUserId(), account.getNickname(), account.getRole()));
    }

    private AuthPayload payload(String userId, String nickname, String role) {
        Set<String> roles = Set.of(role);
        String token = issuer.issue(userId, nickname, roles, TTL_SECONDS);
        return new AuthPayload(token, TTL_SECONDS, new AuthUser(userId, nickname, roles));
    }

    private String clientIp(HttpServletRequest request) {
        String real = request.getHeader("X-Real-IP");
        return real == null || real.isBlank() ? request.getRemoteAddr() : real;
    }
}
