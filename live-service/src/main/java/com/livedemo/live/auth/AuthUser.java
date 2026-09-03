package com.livedemo.live.auth;

import com.livedemo.live.common.BusinessException;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public record AuthUser(String userId, String nickname, Set<String> roles) {

    public static final String VIEWER = "VIEWER";
    public static final String HOST = "HOST";
    public static final String ADMIN = "ADMIN";

    public boolean hasRole(String role) { return roles.contains(role); }

    public void requireRole(String... anyOf) {
        for (String role : anyOf) {
            if (roles.contains(role)) return;
        }
        throw BusinessException.forbidden("权限不足");
    }

    /** roles 声明兼容 List / 逗号分隔字符串；为空默认 VIEWER */
    public static Set<String> rolesOf(Object raw) {
        List<String> parsed = new ArrayList<>();
        if (raw instanceof List<?> list) {
            list.forEach(item -> parsed.add(String.valueOf(item)));
        } else if (raw instanceof String s && !s.isBlank()) {
            for (String part : s.split(",")) parsed.add(part.trim());
        }
        if (parsed.isEmpty()) parsed.add(VIEWER);
        Set<String> result = new LinkedHashSet<>();
        for (String role : parsed) {
            String upper = role.toUpperCase();
            if (Set.of(VIEWER, HOST, ADMIN).contains(upper)) result.add(upper);
        }
        return result.isEmpty() ? Set.of(VIEWER) : Collections.unmodifiableSet(result);
    }
}
