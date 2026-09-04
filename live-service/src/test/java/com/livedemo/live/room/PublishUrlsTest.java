package com.livedemo.live.room;

import com.livedemo.live.auth.TestTokens;
import com.livedemo.live.auth.AuthUser;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class PublishUrlsTest {

    @Autowired MockMvc mvc;
    @Autowired TestTokens tokens;

    private long createRoom(String user) throws Exception {
        String resp = mvc.perform(post("/api/rooms")
                        .header("Authorization", "Bearer " + tokens.sign(
                                new AuthUser(user, "主播", java.util.Set.of("HOST"))))
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andReturn().getResponse().getContentAsString();
        return ((Number) com.jayway.jsonpath.JsonPath.read(resp, "$.data.id")).longValue();
    }

    @Test
    void nonOwnerForbidden() throws Exception {
        long id = createRoom("po" + System.currentTimeMillis());
        mvc.perform(get("/api/rooms/" + id + "/publish-urls")
                        .header("Authorization", "Bearer " + tokens.sign(
                                new AuthUser("other" + id, "别人", java.util.Set.of("HOST")))))
                .andExpect(status().isForbidden());
    }

    @Test
    void ownerReceivesWhipAndRtmp() throws Exception {
        String user = "pw" + System.currentTimeMillis();
        long id = createRoom(user);
        mvc.perform(get("/api/rooms/" + id + "/publish-urls")
                        .header("Authorization", "Bearer " + tokens.sign(
                                new AuthUser(user, "主播", java.util.Set.of("HOST")))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.whip").value(
                        org.hamcrest.Matchers.containsString("/rtc/v1/whip/?app=live&stream=room-")))
                .andExpect(jsonPath("$.data.rtmp").value(
                        org.hamcrest.Matchers.startsWith("rtmp://localhost:1935/live/")));
    }
}
