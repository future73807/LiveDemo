package com.livedemo.live.auth;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class LoginGuardTest {

    @Test
    void allowsUpToLimitPerWindow() {
        LoginGuard guard = new LoginGuard();
        long start = 1_000_000L;
        for (int i = 0; i < 10; i++) {
            assertThat(guard.allow("1.2.3.4", start + i * 1000)).isTrue();
        }
        assertThat(guard.allow("1.2.3.4", start + 10_000)).isFalse();   // 第 11 次
        assertThat(guard.allow("5.6.7.8", start + 10_000)).isTrue();    // 其他 IP 不受影响
    }

    @Test
    void windowSlides() {
        LoginGuard guard = new LoginGuard();
        long start = 2_000_000L;
        for (int i = 0; i < 10; i++) guard.allow("ip", start + i);
        assertThat(guard.allow("ip", start + 10)).isFalse();            // 窗口内
        assertThat(guard.allow("ip", start + 60_001)).isTrue();         // 窗口滑过后放行
    }
}
