package com.livedemo.live.commerce;

import com.livedemo.live.auth.TestTokens;
import com.livedemo.live.auth.AuthUser;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class PlatformCatalogTest {

    @Autowired MockMvc mvc;
    @Autowired TestTokens tokens;

    private String tokenOf(String id, String role) {
        return tokens.sign(new AuthUser(id, "用户" + id, java.util.Set.of(role)));
    }

    @Test
    void hostCannotCreateButCanList() throws Exception {
        String host = tokenOf("pc-h" + System.currentTimeMillis(), "HOST");
        mvc.perform(post("/api/products").header("Authorization", "Bearer " + host)
                        .contentType("application/json").content("{\"title\":\"x\",\"price\":1}"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/products").header("Authorization", "Bearer " + host))
                .andExpect(status().isOk());
    }

    @Test
    void adminCrudAndCascadeUnmount() throws Exception {
        String admin = tokenOf("pc-a" + System.currentTimeMillis(), "ADMIN");
        String host = tokenOf("pc-h2" + System.currentTimeMillis(), "HOST");
        String resp = mvc.perform(post("/api/products").header("Authorization", "Bearer " + admin)
                        .contentType("application/json")
                        .content("{\"title\":\"平台商品-" + System.currentTimeMillis() + "\",\"price\":19.9}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        Integer pid = com.jayway.jsonpath.JsonPath.read(resp, "$.data.id");

        String roomResp = mvc.perform(post("/api/rooms").header("Authorization", "Bearer " + host)
                        .contentType("application/json").content("{\"title\":\"t\"}"))
                .andReturn().getResponse().getContentAsString();
        Integer roomId = com.jayway.jsonpath.JsonPath.read(roomResp, "$.data.id");
        mvc.perform(post("/api/rooms/" + roomId + "/products").header("Authorization", "Bearer " + host)
                        .contentType("application/json").content("{\"productId\":" + pid + ",\"sort\":1}"))
                .andExpect(status().isOk());

        mvc.perform(patch("/api/products/" + pid).header("Authorization", "Bearer " + admin)
                        .contentType("application/json").content("{\"title\":\"改价\",\"price\":29.9}"))
                .andExpect(status().isOk());

        mvc.perform(delete("/api/products/" + pid).header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk());
        mvc.perform(get("/api/rooms/" + roomId + "/products"))
                .andExpect(jsonPath("$.data.length()").value(0));   // 级联摘除
    }
}
