package com.livedemo.live.safety;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.fail;

class RateLimiterTest {

    @Test
    void allowsUpToLimitPerSecond() {
        RateLimiter limiter = new RateLimiter();
        for (int attempt = 0; attempt < 10; attempt++) {
            long second = System.currentTimeMillis() / 1000;
            boolean[] allowed = new boolean[6];
            for (int i = 0; i < 6; i++) allowed[i] = limiter.allow("u1", 5);
            if (System.currentTimeMillis() / 1000 != second) {
                limiter = new RateLimiter();   // 序列跨秒导致窗口自然重置，换新窗口重试
                continue;
            }
            for (int i = 0; i < 5; i++) assertThat(allowed[i]).isTrue();
            assertThat(allowed[5]).isFalse();   // 第 6 次拒绝
            assertThat(limiter.allow("u2", 5)).isTrue();    // 其他用户不受影响
            return;
        }
        fail("连续 10 次跨越秒边界，无法在同一秒内完成断言");
    }

    @Test
    void evictResetsWindow() {
        for (int attempt = 0; attempt < 10; attempt++) {
            RateLimiter limiter = new RateLimiter();
            long second = System.currentTimeMillis() / 1000;
            for (int i = 0; i < 5; i++) limiter.allow("u1", 5);
            boolean rejected = limiter.allow("u1", 5);
            limiter.evict("u1");
            boolean afterEvict = limiter.allow("u1", 5);
            if (System.currentTimeMillis() / 1000 != second) continue;   // 序列跨秒导致窗口自然重置，重试
            assertThat(rejected).isFalse();
            assertThat(afterEvict).isTrue();
            return;
        }
        fail("连续 10 次跨越秒边界，无法在同一秒内完成断言");
    }
}
