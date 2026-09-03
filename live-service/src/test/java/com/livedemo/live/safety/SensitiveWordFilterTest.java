package com.livedemo.live.safety;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@TestPropertySource(properties = {
        "live.safety.words-file=classpath:sensitive-words-test.txt",
        "live.safety.word-action=replace"
})
class SensitiveWordFilterTest {

    @Autowired SensitiveWordFilter filter;

    @Test
    void masksKnownWords() {
        SensitiveWordFilter.SafetyResult r = filter.check("这是赌博广告");
        assertThat(r.blocked()).isTrue();
        assertThat(r.content()).isEqualTo("这是**广告");
    }

    @Test
    void longestMatchWins() {
        // 词库同时含 "外挂" 与 "免费外挂"，应整体命中最长词（4 字 → 4 个星号）
        SensitiveWordFilter.SafetyResult r = filter.check("免费外挂下载");
        assertThat(r.content()).isEqualTo("****下载");
    }

    @Test
    void cleanTextUntouched() {
        SensitiveWordFilter.SafetyResult r = filter.check("主播讲得真好");
        assertThat(r.blocked()).isFalse();
        assertThat(r.content()).isEqualTo("主播讲得真好");
    }
}
