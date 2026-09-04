package com.livedemo.live.auth;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("demo")   // 启用 dev-token 端点（嵌入模式联调同款方式）
class MeTest {

    @Autowired MockMvc mvc;
    @Autowired TestTokens tokens;

    @Test
    void devTokenMeReturnsIdentity() throws Exception {
        String userId = "me" + System.currentTimeMillis();
        String resp = mvc.perform(post("/api/auth/dev-token")
                        .contentType("application/json")
                        .content("{\"userId\":\"" + userId + "\",\"nickname\":\"主播\",\"roles\":[\"HOST\"]}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String token = (String) com.jayway.jsonpath.JsonPath.read(resp, "$.data.token");

        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.userId").value(userId))
                .andExpect(jsonPath("$.data.roles[0]").value("HOST"));
    }

    @Test
    void signedTokenMeReturnsIdentity() throws Exception {
        String userId = "mt" + System.currentTimeMillis();
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + tokens.sign(
                        new AuthUser(userId, "我", java.util.Set.of("VIEWER")))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.userId").value(userId));
    }

    @Test
    void meWithoutCredentialsUnauthorized() throws Exception {
        mvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized());
    }
}
