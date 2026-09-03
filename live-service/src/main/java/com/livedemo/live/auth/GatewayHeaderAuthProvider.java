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
