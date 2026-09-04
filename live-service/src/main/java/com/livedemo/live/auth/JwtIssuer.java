package com.livedemo.live.auth;

import com.livedemo.live.config.LiveProps;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Base64;
import java.util.Date;
import java.util.Set;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class JwtIssuer {

    private final LiveProps props;

    public String issue(String userId, String nickname, Set<String> roles, long ttlSeconds) {
        try {
            byte[] secret = Base64.getDecoder().decode(props.getAuth().getJwt().getSecret());
            long now = System.currentTimeMillis() / 1000;
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .subject(userId)
                    .claim("nickname", nickname)
                    .claim("roles", roles.stream().toList())
                    .issueTime(new Date(now * 1000))
                    .expirationTime(new Date((now + ttlSeconds) * 1000))
                    .jwtID(UUID.randomUUID().toString())
                    .build();
            SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
            jwt.sign(new MACSigner(secret));
            return jwt.serialize();
        } catch (Exception e) {
            throw new IllegalStateException("JWT 签发失败", e);
        }
    }
}
