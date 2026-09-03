package com.livedemo.live.room;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.auth.TestTokens;
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
class RoomControllerTest {

    @Autowired MockMvc mvc;
    @Autowired TestTokens testTokens;

    private String token(AuthUser user) {
        // 复用 JwtAuthProvider 密钥直接构造，走完整验签链路
        return testTokens.sign(user);
    }

    @Test
    void listRooms_isPublic() throws Exception {
        mvc.perform(get("/api/rooms")).andExpect(status().isOk()).andExpect(jsonPath("$.code").value("0"));
    }

    @Test
    void hostCanCreateAndViewOwnRoom() throws Exception {
        String token = token(new AuthUser("h1", "主播甲", java.util.Set.of("HOST")));
        String resp = mvc.perform(post("/api/rooms").header("Authorization", "Bearer " + token)
                        .contentType("application/json").content("{\"title\":\"我的房间\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        Integer id = com.jayway.jsonpath.JsonPath.read(resp, "$.data.id");
        mvc.perform(get("/api/rooms/" + id)).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.title").value("我的房间"));
    }

    @Test
    void nonOwnerCannotEndRoom() throws Exception {
        String owner = token(new AuthUser("h1", "主播甲", java.util.Set.of("HOST")));
        String other = token(new AuthUser("h2", "主播乙", java.util.Set.of("HOST")));
        String resp = mvc.perform(post("/api/rooms").header("Authorization", "Bearer " + owner)
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andReturn().getResponse().getContentAsString();
        Integer id = com.jayway.jsonpath.JsonPath.read(resp, "$.data.id");
        mvc.perform(post("/api/rooms/" + id + "/end").header("Authorization", "Bearer " + other))
                .andExpect(status().isForbidden());
    }
}
