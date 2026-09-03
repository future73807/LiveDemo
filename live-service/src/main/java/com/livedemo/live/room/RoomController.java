package com.livedemo.live.room;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.auth.TokenAuthFilter;
import com.livedemo.live.common.ApiResponse;
import com.livedemo.live.config.LiveProps;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/rooms")
@RequiredArgsConstructor
public class RoomController {

    private final RoomService service;
    private final LiveProps props;

    public record UpdateRoomRequest(String title) {}
    public record PlayUrls(String webrtc, String flv, String hls) {}

    @PostMapping
    public ApiResponse<RoomDto> create(@RequestBody @Valid CreateRoomRequest req,
                                       @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        user.requireRole(AuthUser.HOST, AuthUser.ADMIN);
        Room room = service.create(req.title(), user);
        return ApiResponse.ok(RoomDto.of(room, service.pushUrl(room), true, 0, 0));
    }

    @GetMapping
    public ApiResponse<List<RoomDto>> list(@RequestParam(required = false) RoomStatus status) {
        return ApiResponse.ok(service.list(status).stream()
                .map(r -> RoomDto.of(r, null, false, service.viewers(r.getId()), service.productCount(r.getId())))
                .toList());
    }

    @GetMapping("/{id}")
    public ApiResponse<RoomDto> detail(@PathVariable long id) {
        Room room = service.get(id);
        return ApiResponse.ok(RoomDto.of(room, service.pushUrl(room), false, service.viewers(id), service.productCount(id)));
    }

    @PatchMapping("/{id}")
    public ApiResponse<RoomDto> update(@PathVariable long id, @RequestBody UpdateRoomRequest req,
                                       @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        return ApiResponse.ok(RoomDto.of(service.update(id, req.title(), user), null, false, 0, 0));
    }

    @PostMapping("/{id}/end")
    public ApiResponse<RoomDto> end(@PathVariable long id,
                                    @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        return ApiResponse.ok(RoomDto.of(service.end(id, user), null, false, 0, 0));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable long id,
                                    @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        service.delete(id, user);
        return ApiResponse.ok(null);
    }

    @GetMapping("/{id}/play-urls")
    public ApiResponse<PlayUrls> playUrls(@PathVariable long id) {
        Room room = service.get(id);
        String host = props.getSrs().getPublicHost();
        String key = room.getStreamKey();
        return ApiResponse.ok(new PlayUrls(
                "http://%s:%d/rtc/v1/whep/?app=live&stream=%s".formatted(host, props.getSrs().getApiPort(), key),
                "http://%s:%d/live/%s.flv".formatted(host, props.getSrs().getHttpPort(), key),
                "http://%s:%d/live/%s.m3u8".formatted(host, props.getSrs().getHttpPort(), key)));
    }
}
