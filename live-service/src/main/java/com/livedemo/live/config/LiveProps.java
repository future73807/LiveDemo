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
        /** internal | jwt | gateway */
        private String mode = "jwt";
        private Jwt jwt = new Jwt();
        /** internal 模式管理员引导：环境变量注入，留空跳过 */
        private String adminUsername;
        private String adminPassword;
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
        /** host=按 public-host:port 拼地址（本地开发）；base=按 public-base-url 拼同源地址（公网 HTTPS） */
        private String playUrlMode = "host";
        private String publicBaseUrl = "";
    }
}
