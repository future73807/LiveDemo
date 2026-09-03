package com.livedemo.live.safety;

import com.livedemo.live.auth.TestTokens;
import com.livedemo.live.auth.AuthUser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("demo")
class BanFlowTest {

    @Autowired MockMvc mvc;
    @Autowired TestTokens tokens;
    @Autowired BanService banService;

    @BeforeEach
    void cleanResidue() {
        // 测试库为持久 H2，跨运行可能残留封禁记录，先解封保证幂等
        banService.unban("bad1");
    }

    @Test
    void bannedUserGets403EvenWithValidToken() throws Exception {
        String token = tokens.sign(new AuthUser("bad1", "坏人", java.util.Set.of("HOST")));

        // 封禁前：有效 token 建房正常（自建数据，不依赖固定 id）
        mvc.perform(post("/api/rooms").header("Authorization", "Bearer " + token)
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andExpect(status().isOk());

        banService.ban("bad1", "刷屏");

        // 封禁后：同一有效 token 被 HTTP 层拒绝
        mvc.perform(post("/api/rooms").header("Authorization", "Bearer " + token)
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andExpect(status().isForbidden());

        banService.unban("bad1");
    }
}
