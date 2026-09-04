import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../api/types';
import { nickColor } from './nickColor';

interface ActiveDanmaku extends ChatMessage { track: number; }

const TRACKS = 4;

/** 消费增量消息 → 弹幕轨道随机分配，动画结束自动移除 */
export default function DanmakuLayer({ messages }: { messages: ChatMessage[] }) {
  // 按 messageId 幂等去重消费：消息数组会因删除/重连 history 重建而收缩位移，
  // 按数组下标切片的游标会错位漏渲染新弹幕，不能按下标记进度
  const seenRef = useRef<Set<string>>(new Set());
  const [active, setActive] = useState<ActiveDanmaku[]>([]);
  const counterRef = useRef(0);

  useEffect(() => {
    const fresh = messages
      .filter(m => !seenRef.current.has(m.messageId))
      .map(m => {
        seenRef.current.add(m.messageId);
        return { ...m, track: (counterRef.current++ % TRACKS) + 1 };
      });
    if (fresh.length) setActive(list => [...list, ...fresh]);
  }, [messages]);

  return (
    <div className="danmaku-layer">
      {active.map(m => (
        <span key={m.messageId} className="danmaku-item"
          style={{ top: `${(m.track - 1) * 24 + 8}px` }}
          onAnimationEnd={() => setActive(list => list.filter(x => x.messageId !== m.messageId))}>
          <span style={{ color: nickColor(m.nickname) }}>{m.nickname}</span>：{m.content}
        </span>
      ))}
    </div>
  );
}
