package com.livedemo.live.commerce;

import com.livedemo.live.auth.TestTokens;
import com.livedemo.live.auth.AuthUser;
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
class CommerceApiTest {

    @Autowired MockMvc mvc;
    @Autowired TestTokens tokens;

    private String hostToken() {
        return tokens.sign(new AuthUser("h1", "主播甲", java.util.Set.of("HOST")));
    }

    private String viewerToken() {
        return tokens.sign(new AuthUser("v1", "观众甲", java.util.Set.of("VIEWER")));
    }

    private String adminToken() {
        return tokens.sign(new AuthUser("a1", "管理员", java.util.Set.of("ADMIN")));
    }

    @Test
    void fullCommerceFlow() throws Exception {
        String host = hostToken();
        // 1. 建房间（主播）+ 建商品（平台库，仅 ADMIN）
        String roomResp = mvc.perform(post("/api/rooms").header("Authorization", "Bearer " + host)
                        .contentType("application/json").content("{\"title\":\"带货间\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        Integer roomId = com.jayway.jsonpath.JsonPath.read(roomResp, "$.data.id");
        String productResp = mvc.perform(post("/api/products").header("Authorization", "Bearer " + adminToken())
                        .contentType("application/json")
                        .content("{\"title\":\"测试卫衣\",\"price\":99.9,\"stock\":10}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        Integer productId = com.jayway.jsonpath.JsonPath.read(productResp, "$.data.id");

        // 2. 挂载到房间
        mvc.perform(post("/api/rooms/" + roomId + "/products").header("Authorization", "Bearer " + host)
                        .contentType("application/json")
                        .content("{\"productId\":" + productId + ",\"sort\":1}"))
                .andExpect(status().isOk());

        // 3. 观众公开看小黄车
        mvc.perform(get("/api/rooms/" + roomId + "/products"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].title").value("测试卫衣"));

        // 4. 观众加购（带 roomId 校验货架）→ 购物列表可见
        mvc.perform(post("/api/cart/items").header("Authorization", "Bearer " + viewerToken())
                        .contentType("application/json")
                        .content("{\"productId\":" + productId + ",\"qty\":1,\"roomId\":" + roomId + "}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/cart").header("Authorization", "Bearer " + viewerToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].title").value("测试卫衣"))
                .andExpect(jsonPath("$.data[0].qty").value(1));

        // 5. 摘除后，同房间再加购返回 400
        mvc.perform(delete("/api/rooms/" + roomId + "/products/" + productId)
                        .header("Authorization", "Bearer " + host))
                .andExpect(status().isOk());
        mvc.perform(post("/api/cart/items").header("Authorization", "Bearer " + viewerToken())
                        .contentType("application/json")
                        .content("{\"productId\":" + productId + ",\"qty\":1,\"roomId\":" + roomId + "}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void viewerCannotCreateProductOrMount() throws Exception {
        String viewer = viewerToken();
        mvc.perform(post("/api/products").header("Authorization", "Bearer " + viewer)
                        .contentType("application/json").content("{\"title\":\"x\",\"price\":1}"))
                .andExpect(status().isForbidden());
    }
}
