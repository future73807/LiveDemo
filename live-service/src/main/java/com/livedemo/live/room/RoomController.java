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
    public record PublishUrls(String whip, String rtmp, String streamKey) {}

    private String srsBase() {
        if ("base".equalsIgnoreCase(props.getSrs().getPlayUrlMode())) {
            return props.getSrs().getPublicBaseUrl().replaceAll("/+$", "");
        }
        return "http://%s:%d".formatted(props.getSrs().getPublicHost(), props.getSrs().getApiPort());
    }

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
        String key = room.getStreamKey();
        String base = srsBase();
        String flvHlsBase = "base".equalsIgnoreCase(props.getSrs().getPlayUrlMode())
                ? base : "http://%s:%d".formatted(props.getSrs().getPublicHost(), props.getSrs().getHttpPort());
        return ApiResponse.ok(new PlayUrls(
                base + "/rtc/v1/whep/?app=live&stream=" + key,
                flvHlsBase + "/live/" + key + ".flv",
                flvHlsBase + "/live/" + key + ".m3u8"));
    }

    @GetMapping("/{id}/publish-urls")
    public ApiResponse<PublishUrls> publishUrls(@PathVariable long id,
                                                @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        Room room = service.get(id);
        service.assertOwner(room, user);
        String key = room.getStreamKey();
        String whip = srsBase() + "/rtc/v1/whip/?app=live&stream=" + key;
        return ApiResponse.ok(new PublishUrls(whip, service.pushUrl(room), key));
    }
}
