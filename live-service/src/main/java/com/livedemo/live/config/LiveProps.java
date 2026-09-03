package com.livedemo.live.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Data
@ConfigurationProperties(prefix = "live")
public class LiveProps {
    private Auth auth = new Auth();
    private Srs srs = new Srs();
    private Safety safety = new Safety();

    @Data
    public static class Safety {
        /** 词库文件路径，支持 classpath: 与文件系统路径 */
        private String wordsFile = "classpath:sensitive-words.txt";
        /** replace=掩码 ***；reject=直接拦截 */
        private String wordAction = "replace";
    }

    @Data
    public static class Auth {
        private String mode = "jwt";
        private Jwt jwt = new Jwt();
    }

    @Data
    public static class Jwt {
        private String secret;
        private String jwkSetUri = "";
    }

    @Data
    public static class Srs {
        private String publicHost = "localhost";
        private int rtmpPort = 1935;
        private int apiPort = 1985;
        private int httpPort = 8080;
    }
}
