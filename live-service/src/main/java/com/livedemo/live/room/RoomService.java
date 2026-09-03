package com.livedemo.live.room;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.common.BusinessException;
import com.livedemo.live.config.LiveProps;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class RoomService {
    private static final SecureRandom RANDOM = new SecureRandom();

    private final RoomRepository repo;
    private final ObjectProvider<PresenceProvider> presenceProvider;
    private final ApplicationEventPublisher events;
    private final LiveProps props;
    private final ObjectProvider<ShelfCountProvider> shelfCountProvider;

    public Room create(String title, AuthUser host) {
        Room room = Room.builder()
                .title(title)
                .ownerId(host.userId())
                .ownerName(host.nickname())
                .streamKey("room-" + randomKey())
                .status(RoomStatus.IDLE)
                .createdAt(LocalDateTime.now())
                .build();
        return repo.save(room);
    }

    public Room get(long id) {
        return repo.findById(id).orElseThrow(() -> BusinessException.notFound("房间不存在"));
    }

    public List<Room> list(RoomStatus status) {
        return status == null ? repo.findAll() : repo.findByStatus(status);
    }

    public Room update(long id, String title, AuthUser user) {
        Room room = get(id);
        assertOwner(room, user);
        room.setTitle(title);
        return repo.save(room);
    }

    public Room end(long id, AuthUser user) {
        Room room = get(id);
        assertOwner(room, user);
        room.setStatus(RoomStatus.IDLE);
        Room saved = repo.save(room);
        events.publishEvent(new RoomStatusChangedEvent(saved.getId(), saved.getStatus()));
        return saved;
    }

    public void delete(long id, AuthUser user) {
        Room room = get(id);
        if (!room.getOwnerId().equals(user.userId())) {
            user.requireRole("ADMIN");
        }
        repo.delete(room);
    }

    /** 平台后台强制关播（管理员），记录操作人 */
    public Room forceClose(long id, String operatorId) {
        Room room = get(id);
        room.setStatus(RoomStatus.IDLE);
        Room saved = repo.save(room);
        events.publishEvent(new RoomStatusChangedEvent(saved.getId(), RoomStatus.IDLE));
        log.info("房间 {} 已被管理员 {} 强制关播", id, operatorId);
        return saved;
    }

    public Room markLiving(String streamKey) {
        Room room = repo.findByStreamKey(streamKey)
                .orElseThrow(() -> BusinessException.forbidden("非法推流键"));
        room.setStatus(RoomStatus.LIVING);
        Room saved = repo.save(room);
        events.publishEvent(new RoomStatusChangedEvent(saved.getId(), RoomStatus.LIVING));
        return saved;
    }

    public Room markIdle(String streamKey) {
        return repo.findByStreamKey(streamKey).map(room -> {
            room.setStatus(RoomStatus.IDLE);
            Room saved = repo.save(room);
            events.publishEvent(new RoomStatusChangedEvent(saved.getId(), RoomStatus.IDLE));
            return saved;
        }).orElse(null);   // 未知流的 unpublish 静默忽略（如 M1 的 test 流）
    }

    public void assertOwner(Room room, AuthUser user) {
        if (!room.getOwnerId().equals(user.userId())) {
            throw BusinessException.forbidden("仅房主可操作");
        }
    }

    public String pushUrl(Room room) {
        return "rtmp://%s:%d/live/%s".formatted(props.getSrs().getPublicHost(), props.getSrs().getRtmpPort(), room.getStreamKey());
    }

    public int viewers(long roomId) {
        PresenceProvider p = presenceProvider.getIfAvailable();
        return p == null ? 0 : p.viewers(roomId);
    }

    public int productCount(long roomId) {
        ShelfCountProvider p = shelfCountProvider.getIfAvailable();
        return p == null ? 0 : p.activeCount(roomId);
    }

    private String randomKey() {
        byte[] buf = new byte[4];
        RANDOM.nextBytes(buf);
        return HexFormat.of().formatHex(buf);
    }
}
