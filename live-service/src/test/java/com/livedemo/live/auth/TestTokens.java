package com.livedemo.live.auth;

import com.livedemo.live.config.LiveProps;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
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
            jwt.sign(new MACSigner(secret));
            return jwt.serialize();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
