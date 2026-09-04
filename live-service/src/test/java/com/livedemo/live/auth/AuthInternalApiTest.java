package com.livedemo.live.auth;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class AuthInternalApiTest {

    @Autowired MockMvc mvc;

    private String register(String username, String role) throws Exception {
        String body = ("{\"username\":\"%s\",\"password\":\"pass123456\",\"nickname\":\"昵-%s\",\"role\":\"%s\"}")
                .formatted(username, username, role);
        String resp = mvc.perform(post("/api/auth/register").contentType("application/json").content(body))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return (String) com.jayway.jsonpath.JsonPath.read(resp, "$.data.token");
    }

    @Test
    void registerThenLoginThenCreateRoom() throws Exception {
        String username = "u" + System.currentTimeMillis();
        String token = register(username, "HOST");

        // 用注册返回的 token 直接建房（证明签发的 JWT 走通验签链）
        mvc.perform(post("/api/rooms").header("Authorization", "Bearer " + token)
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andExpect(status().isOk());

        // 再次登录
        mvc.perform(post("/api/auth/login").contentType("application/json")
                        .content("{\"username\":\"" + username + "\",\"password\":\"pass123456\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.user.userId").value(username));
    }

    @Test
    void duplicateUsernameRejected() throws Exception {
        String username = "d" + System.currentTimeMillis();
        register(username, "VIEWER");
        mvc.perform(post("/api/auth/register").contentType("application/json")
                        .content(("{\"username\":\"%s\",\"password\":\"pass123456\",\"nickname\":\"n\",\"role\":\"VIEWER\"}").formatted(username)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void weakPasswordAndBadRoleRejected() throws Exception {
        mvc.perform(post("/api/auth/register").contentType("application/json")
                        .content("{\"username\":\"weakuser1\",\"password\":\"123\",\"nickname\":\"n\",\"role\":\"VIEWER\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/auth/register").contentType("application/json")
                        .content("{\"username\":\"badrole1\",\"password\":\"pass123456\",\"nickname\":\"n\",\"role\":\"SUPER\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void wrongPasswordReturns401() throws Exception {
        String username = "w" + System.currentTimeMillis();
        register(username, "VIEWER");
        mvc.perform(post("/api/auth/login").contentType("application/json")
                        .content("{\"username\":\"" + username + "\",\"password\":\"wrongpass\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void configEndpointReportsInternalMode() throws Exception {
        mvc.perform(get("/api/auth/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.mode").value("internal"))
                .andExpect(jsonPath("$.data.registrationEnabled").value(true));
    }
}
