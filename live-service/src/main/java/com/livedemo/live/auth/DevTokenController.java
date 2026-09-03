package com.livedemo.live.auth;

import com.livedemo.live.common.ApiResponse;
import com.livedemo.live.common.BusinessException;
import com.livedemo.live.config.LiveProps;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
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
            jwt.sign(new MACSigner(secret));
            return ApiResponse.ok(Map.of("token", jwt.serialize(), "expiresIn", TTL_SECONDS));
        } catch (Exception e) {
            throw new BusinessException(500, "签发失败: " + e.getMessage());
        }
    }
}
