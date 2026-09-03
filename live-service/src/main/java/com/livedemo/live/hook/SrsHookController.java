package com.livedemo.live.hook;

import com.livedemo.live.room.RoomService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/v1/srs")
@RequiredArgsConstructor
public class SrsHookController {

    private final RoomService roomService;

    /** SRS http_hook 回调入口：on_publish 校验推流键并置 LIVING，on_unpublish 置 IDLE */
    @PostMapping("/hooks")
    public ResponseEntity<Map<String, Object>> onHook(@RequestBody Map<String, Object> body) {
        String action = String.valueOf(body.get("action"));
        String stream = String.valueOf(body.get("stream"));
        log.debug("SRS hook: action={} stream={}", action, stream);
        switch (action) {
            case "on_publish" -> roomService.markLiving(stream);
            case "on_unpublish" -> roomService.markIdle(stream);
            default -> log.debug("忽略回调 {}", action);
        }
        return ResponseEntity.ok(Map.of("code", 0));
    }
}
