package com.livedemo.live.admin;

import com.livedemo.live.auth.TestTokens;
import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.safety.BanService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("demo")
class AdminApiTest {

    @Autowired MockMvc mvc;
    @Autowired TestTokens tokens;
    @Autowired BanService banService;

    @BeforeEach
    void cleanResidue() {
        // 测试库为持久 H2，跨运行可能残留封禁记录，先解封保证幂等
        banService.unban("u999");
    }

    private String tokenOf(String userId, String... roles) {
        return tokens.sign(new AuthUser(userId, "user-" + userId, java.util.Set.of(roles)));
    }

    @Test
    void adminOnlyEndpoints() throws Exception {
        String admin = tokenOf("a1", "ADMIN");
        String host = tokenOf("h1", "HOST");
        String body = "{\"title\":\"t\"}";
        String roomResp = mvc.perform(post("/api/rooms").header("Authorization", "Bearer " + host)
                        .contentType("application/json").content(body))
                .andReturn().getResponse().getContentAsString();
        Integer roomId = com.jayway.jsonpath.JsonPath.read(roomResp, "$.data.id");

        mvc.perform(get("/api/admin/rooms").header("Authorization", "Bearer " + host))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/rooms").header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value("0"));

        mvc.perform(post("/api/admin/rooms/" + roomId + "/force-close")
                        .header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk());
        mvc.perform(get("/api/rooms/" + roomId))
                .andExpect(jsonPath("$.data.status").value("IDLE"));

        mvc.perform(post("/api/admin/users/u999/ban").header("Authorization", "Bearer " + admin)
                        .contentType("application/json").content("{\"reason\":\"test\"}"))
                .andExpect(status().isOk());
        mvc.perform(delete("/api/admin/users/u999/ban").header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk());

        mvc.perform(post("/api/admin/sensitive-words/reload").header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk());
    }
}
