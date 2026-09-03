package com.livedemo.live.auth;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("demo")
class AuthFlowTest {

    @Autowired MockMvc mvc;

    private String tokenOf(String userId, String nickname, List<String> roles) throws Exception {
        String body = new com.fasterxml.jackson.databind.ObjectMapper()
                .writeValueAsString(Map.of("userId", userId, "nickname", nickname, "roles", roles));
        String resp = mvc.perform(post("/api/auth/dev-token").contentType("application/json").content(body))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return (String) com.jayway.jsonpath.JsonPath.read(resp, "$.data.token");
    }

    @Test
    void devToken_grantsAccess() throws Exception {
        String token = tokenOf("u1", "主播甲", List.of("HOST"));
        // 列表接口公开，用创建接口验证鉴权链
        mvc.perform(post("/api/rooms").header("Authorization", "Bearer " + token)
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.streamKey").value(org.hamcrest.Matchers.matchesPattern("room-[0-9a-f]{8}")));
    }

    @Test
    void missingToken_returns401() throws Exception {
        mvc.perform(post("/api/rooms").contentType("application/json").content("{\"title\":\"t\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void garbageToken_returns401() throws Exception {
        mvc.perform(post("/api/rooms").header("Authorization", "Bearer garbage")
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void viewerCannotCreateRoom() throws Exception {
        String token = tokenOf("u2", "观众甲", List.of("VIEWER"));
        mvc.perform(post("/api/rooms").header("Authorization", "Bearer " + token)
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andExpect(status().isForbidden());
    }
}
