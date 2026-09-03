package com.livedemo.live.safety;

import com.livedemo.live.ws.RoomSessionRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

@Slf4j
@Service
@RequiredArgsConstructor
public class BanService {

    private final BannedUserRepository repo;
    private final RoomSessionRegistry registry;

    public void ban(String userId, String reason) {
        repo.save(BannedUser.builder().userId(userId).reason(reason).bannedAt(LocalDateTime.now()).build());
        registry.closeAllOf(userId);   // 立即踢掉在线连接（设计 §5.6 封禁联动）
        log.info("用户 {} 已被封禁，原因：{}", userId, reason);
    }

    public void unban(String userId) { repo.deleteById(userId); }

    public boolean isBanned(String userId) { return repo.existsById(userId); }
}
