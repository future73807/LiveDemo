package com.livedemo.live.safety;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class RateLimiterTest {

    @Test
    void allowsUpToLimitPerSecond() {
        RateLimiter limiter = new RateLimiter();
        for (int i = 0; i < 5; i++) {
            assertThat(limiter.allow("u1", 5)).isTrue();
        }
        assertThat(limiter.allow("u1", 5)).isFalse();   // 第 6 次拒绝
        assertThat(limiter.allow("u2", 5)).isTrue();    // 其他用户不受影响
    }

    @Test
    void evictResetsWindow() {
        RateLimiter limiter = new RateLimiter();
        for (int i = 0; i < 5; i++) limiter.allow("u1", 5);
        assertThat(limiter.allow("u1", 5)).isFalse();
        limiter.evict("u1");
        assertThat(limiter.allow("u1", 5)).isTrue();
    }
}
