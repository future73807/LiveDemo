package com.livedemo.live.hook;

import com.livedemo.live.room.RoomService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(SrsHookController.class)
@Import(SrsHookControllerTest.HookPermitAll.class)
class SrsHookControllerTest {

    @Autowired MockMvc mvc;
    @MockBean RoomService roomService;

    @TestConfiguration
    @EnableWebSecurity
    static class HookPermitAll {
        @Bean
        public SecurityFilterChain hookChain(HttpSecurity http) throws Exception {
            http.csrf(c -> c.disable()).authorizeHttpRequests(a -> a.anyRequest().permitAll());
            return http.build();
        }
    }

    private String body(String action, String stream) {
        return "{\"action\":\"%s\",\"app\":\"live\",\"stream\":\"%s\",\"param\":\"\"}".formatted(action, stream);
    }

    @Test
    void onPublish_ok() throws Exception {
        mvc.perform(post("/api/v1/srs/hooks").contentType(MediaType.APPLICATION_JSON)
                        .content(body("on_publish", "room-ab12cd34")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
    }

    @Test
    void onPublish_unknownKey_returns403() throws Exception {
        doThrow(new com.livedemo.live.common.BusinessException(403, "非法推流键"))
                .when(roomService).markLiving("bad");
        mvc.perform(post("/api/v1/srs/hooks").contentType(MediaType.APPLICATION_JSON)
                        .content(body("on_publish", "bad")))
                .andExpect(status().isForbidden());
    }

    @Test
    void onUnpublish_ok() throws Exception {
        mvc.perform(post("/api/v1/srs/hooks").contentType(MediaType.APPLICATION_JSON)
                        .content(body("on_unpublish", "room-ab12cd34")))
                .andExpect(status().isOk());
    }
}
