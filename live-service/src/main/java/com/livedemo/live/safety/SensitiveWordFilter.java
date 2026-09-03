package com.livedemo.live.safety;

import com.livedemo.live.config.LiveProps;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
@RequiredArgsConstructor
public class SensitiveWordFilter {

    public record SafetyResult(boolean blocked, String content) {}

    private static final class Node {
        final Map<Character, Node> children = new HashMap<>();
        boolean end;
    }

    private final LiveProps props;
    private final ResourceLoader resourceLoader;
    private volatile Node root = new Node();
    private volatile Set<String> words = Set.of();

    @PostConstruct
    public synchronized void reload() {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                resourceLoader.getResource(props.getSafety().getWordsFile()).getInputStream(), StandardCharsets.UTF_8))) {
            Set<String> loaded = new HashSet<>();
            String line;
            while ((line = reader.readLine()) != null) {
                String word = line.trim();
                if (!word.isEmpty()) loaded.add(word);
            }
            this.words = loaded;
            this.root = buildTrie(loaded);
        } catch (Exception e) {
            throw new IllegalStateException("敏感词库加载失败: " + props.getSafety().getWordsFile(), e);
        }
    }

    /** 返回掩码后内容与是否命中；word-action=reject 时 blocked 由调用方决定拒绝 */
    public SafetyResult check(String text) {
        Node trie = root;
        StringBuilder sb = new StringBuilder(text.length());
        boolean hit = false;
        int i = 0;
        while (i < text.length()) {
            int matchLen = matchAt(trie, text, i);
            if (matchLen > 0) {
                hit = true;
                sb.append("*".repeat(matchLen));
                i += matchLen;
            } else {
                sb.append(text.charAt(i));
                i++;
            }
        }
        return new SafetyResult(hit, sb.toString());
    }

    public boolean isRejectMode() {
        return "reject".equalsIgnoreCase(props.getSafety().getWordAction());
    }

    public List<String> currentWords() { return List.copyOf(words); }

    private int matchAt(Node trie, String text, int start) {
        Node node = trie;
        int longest = 0;
        for (int j = start; j < text.length(); j++) {
            node = node.children.get(text.charAt(j));
            if (node == null) break;
            if (node.end) longest = j - start + 1;   // 贪心保留最长命中
        }
        return longest;
    }

    private Node buildTrie(Set<String> loaded) {
        Node trie = new Node();
        for (String word : loaded) {
            Node cur = trie;
            for (int i = 0; i < word.length(); i++) {
                cur = cur.children.computeIfAbsent(word.charAt(i), c -> new Node());
            }
            cur.end = true;
        }
        return trie;
    }
}
