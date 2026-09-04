package com.livedemo.live.auth;

import com.livedemo.live.common.ApiResponse;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
@Profile("demo")
@RequiredArgsConstructor
public class DevTokenController {

    public static final long TTL_SECONDS = 12 * 3600;

    private final JwtIssuer issuer;

    @Data
    public static class DevTokenRequest {
        @NotBlank private String userId;
        @NotBlank private String nickname;
        private java.util.List<String> roles;
    }

    @PostMapping("/dev-token")
    public ApiResponse<Map<String, Object>> issue(@RequestBody DevTokenRequest req) {
        String token = issuer.issue(req.getUserId(), req.getNickname(),
                AuthUser.rolesOf(req.getRoles()), TTL_SECONDS);
        return ApiResponse.ok(Map.of("token", token, "expiresIn", TTL_SECONDS));
    }
}
