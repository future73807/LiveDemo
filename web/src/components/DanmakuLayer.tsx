import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../api/types';

interface ActiveDanmaku extends ChatMessage { track: number; }

const TRACKS = 4;

/** 消费增量消息 → 弹幕轨道随机分配，动画结束自动移除 */
export default function DanmakuLayer({ messages, deletedIds }: {
  messages: ChatMessage[];
  deletedIds: Set<string>;
}) {
  const lastRef = useRef(0);
  const [active, setActive] = useState<ActiveDanmaku[]>([]);
  const counterRef = useRef(0);

  useEffect(() => {
    const fresh = messages.slice(lastRef.current)
      .filter(m => !deletedIds.has(m.messageId))
      .map(m => ({ ...m, track: (counterRef.current++ % TRACKS) + 1 }));
    lastRef.current = messages.length;
    if (fresh.length) setActive(list => [...list, ...fresh]);
  }, [messages, deletedIds]);

  return (
    <div className="danmaku-layer">
      {active.map(m => (
        <span key={m.messageId} className="danmaku-item"
          style={{ top: `${(m.track - 1) * 24 + 8}px` }}
          onAnimationEnd={() => setActive(list => list.filter(x => x.messageId !== m.messageId))}>
          {m.nickname}：{m.content}
        </span>
      ))}
    </div>
  );
}
