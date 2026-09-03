package com.livedemo.live.auth;

/** 认证 SPI：接入现有系统时按其机制新增实现并切换 live.auth.mode */
public interface AuthProvider {
    /** 校验凭证并返回用户；失败抛 InvalidTokenException */
    AuthUser authenticate(String credential);
    AuthMode mode();
}
