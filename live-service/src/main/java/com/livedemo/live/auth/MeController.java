package com.livedemo.live.auth;

import com.livedemo.live.common.ApiResponse;
import com.livedemo.live.common.BusinessException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RestController;

/**
 * 当前登录身份查询：任意认证模式可用（需有效凭证），嵌入模式注入 token 后拉取。
 * 注意 /api/auth/** 在 SecurityConfig 中整体 permitAll，故此处自行校验凭证缺失并返回 401。
 */
@RestController
public class MeController {

    @GetMapping("/api/auth/me")
    public ApiResponse<AuthUser> me(@RequestAttribute(value = TokenAuthFilter.ATTR, required = false) AuthUser user) {
        if (user == null) {
            throw new BusinessException(401, "未认证");
        }
        return ApiResponse.ok(user);
    }
}
