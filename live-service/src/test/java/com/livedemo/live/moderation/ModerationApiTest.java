package com.livedemo.live.moderation;

import com.livedemo.live.auth.TestTokens;
import com.livedemo.live.auth.AuthUser;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("demo")
class ModerationApiTest {

    @Autowired MockMvc mvc;
    @Autowired TestTokens tokens;

    private AuthUser hostOf(String id) { return new AuthUser(id, "host-" + id, java.util.Set.of("HOST")); }

    @Test
    void onlyOwnerOrAdminCanModerate() throws Exception {
        String owner = tokens.sign(hostOf("h1"));
        String stranger = tokens.sign(hostOf("h2"));
        String viewer = tokens.sign(new AuthUser("v1", "viewer-v1", java.util.Set.of("VIEWER")));
        String admin = tokens.sign(new AuthUser("a1", "admin-a1", java.util.Set.of("ADMIN")));

        String roomResp = mvc.perform(post("/api/rooms").header("Authorization", "Bearer " + owner)
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andReturn().getResponse().getContentAsString();
        Integer roomId = com.jayway.jsonpath.JsonPath.read(roomResp, "$.data.id");

        String muteBody = "{\"userId\":\"v1\",\"durationSec\":60}";

        mvc.perform(post("/api/rooms/" + roomId + "/mutes").header("Authorization", "Bearer " + viewer)
                        .contentType("application/json").content(muteBody))
                .andExpect(status().isForbidden());   // 观众无权限
        mvc.perform(post("/api/rooms/" + roomId + "/mutes").header("Authorization", "Bearer " + stranger)
                        .contentType("application/json").content(muteBody))
                .andExpect(status().isForbidden());   // 非房主
        mvc.perform(post("/api/rooms/" + roomId + "/mutes").header("Authorization", "Bearer " + owner)
                        .contentType("application/json").content(muteBody))
                .andExpect(status().isOk());          // 房主
        mvc.perform(post("/api/rooms/" + roomId + "/mutes").header("Authorization", "Bearer " + admin)
                        .contentType("application/json").content(muteBody))
                .andExpect(status().isOk());          // 管理员
        mvc.perform(delete("/api/rooms/" + roomId + "/mutes/v1").header("Authorization", "Bearer " + owner))
                .andExpect(status().isOk());

        // 删不存在的弹幕 → 404
        mvc.perform(delete("/api/rooms/" + roomId + "/messages/no-such-id")
                        .header("Authorization", "Bearer " + owner))
                .andExpect(status().isNotFound());
    }
}
