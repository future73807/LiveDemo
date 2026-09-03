package com.livedemo.live.safety;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class MuteServiceTest {

    private final MuteService service = new MuteService();

    @Test
    void muteThenRemain() {
        service.mute(1L, "u1", 60);
        long remain = service.remainingSec(1L, "u1");
        assertThat(remain).isBetween(59L, 60L);
        service.mute(1L, "u1", 120);   // 重复禁言覆盖
        assertThat(service.remainingSec(1L, "u1")).isGreaterThan(60);
    }

    @Test
    void unmuteAndOtherRoomIsolation() {
        service.mute(1L, "u1", 60);
        service.unmute(1L, "u1");
        assertThat(service.remainingSec(1L, "u1")).isEqualTo(0);
        assertThat(service.remainingSec(2L, "u1")).isEqualTo(0);   // 房间隔离
    }
}
