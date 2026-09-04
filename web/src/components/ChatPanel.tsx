import { useState } from 'react';
import type { ChatMessage } from '../api/types';
import { nickColor } from './nickColor';

export default function ChatPanel({ messages, canModerate, onSend, onMute, onDelete, notice }: {
  messages: ChatMessage[];
  canModerate: boolean;
  onSend: (content: string) => void;
  onMute: (userId: string) => void;
  onDelete: (messageId: string) => void;
  notice: string;
}) {
  const [draft, setDraft] = useState('');

  function send() {
    const content = draft.trim();
    if (!content) return;
    onSend(content);
    setDraft('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {notice && <div className="error-text" style={{ padding: '4px 12px' }}>{notice}</div>}
      <div className="chat-list">
        {messages.map(m => (
          <div key={m.messageId} className="chat-item">
            <span className="nick" style={{ color: nickColor(m.nickname) }}>{m.nickname}</span>
            <span>{m.content}</span>
            {canModerate && (
              <span className="mod-actions">
                <button onClick={() => onMute(m.userId)}>禁言</button>
                <button onClick={() => onDelete(m.messageId)}>删除</button>
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(); }} placeholder="发个弹幕…" />
        <button className="primary" onClick={send}>发送</button>
      </div>
    </div>
  );
}
