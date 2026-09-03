package com.livedemo.live.auth;

import com.livedemo.live.config.LiveProps;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.RemoteJWKSet;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.proc.ConfigurableJWTProcessor;
import com.nimbusds.jwt.proc.DefaultJWTClaimsVerifier;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
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
