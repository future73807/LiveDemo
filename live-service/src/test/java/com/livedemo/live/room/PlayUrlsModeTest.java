package com.livedemo.live.room;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.auth.TestTokens;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("demo")
@TestPropertySource(properties = {
        "live.srs.play-url-mode=base",
        "live.srs.public-base-url=https://live.example.com"
})
class PlayUrlsModeTest {

    @Autowired MockMvc mvc;
    @Autowired TestTokens tokens;

    @Test
    void baseModeEmitsSameOriginUrls() throws Exception {
        String roomResp = mvc.perform(post("/api/rooms")
                        .header("Authorization", "Bearer " + tokens.sign(
                                new AuthUser("pb" + System.currentTimeMillis(), "主播", java.util.Set.of("HOST"))))
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andReturn().getResponse().getContentAsString();
        Integer id = com.jayway.jsonpath.JsonPath.read(roomResp, "$.data.id");

        String resp = mvc.perform(get("/api/rooms/" + id + "/play-urls"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat((String) com.jayway.jsonpath.JsonPath.read(resp, "$.data.webrtc"))
                .startsWith("https://live.example.com/rtc/v1/whep/?app=live&stream=");
        assertThat((String) com.jayway.jsonpath.JsonPath.read(resp, "$.data.flv"))
                .startsWith("https://live.example.com/live/").endsWith(".flv");
        assertThat((String) com.jayway.jsonpath.JsonPath.read(resp, "$.data.hls"))
                .startsWith("https://live.example.com/live/").endsWith(".m3u8");
    }
}
