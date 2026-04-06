// GROOVE GUI — Agent Chat Tab
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useRef, useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';

export default function AgentChat({ agent }) {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState(null);
  const scrollRef = useRef();

  const activityLog = useGrooveStore((s) => s.activityLog);
  const instructAgent = useGrooveStore((s) => s.instructAgent);
  const queryAgent = useGrooveStore((s) => s.queryAgent);
  const showStatus = useGrooveStore((s) => s.showStatus);
  const chatHistory = useGrooveStore((s) => s.chatHistory);

  const activity = activityLog[agent.id] || [];
  const chats = chatHistory[agent.id] || [];

  const timeline = buildTimeline(chats, activity);
  const isAlive = agent.status === 'running' || agent.status === 'starting';

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [timeline.length]);

  async function handleSubmit() {
    const text = input.trim();
    if (!text || status) return;

    const isQuery = text.startsWith('?');
    const message = isQuery ? text.slice(1).trim() : text;
    if (!message) return;

    setInput('');

    if (isQuery && isAlive) {
      // Query — one-shot read-only question, agent keeps running
      setStatus('querying...');
      try {
        await queryAgent(agent.id, message);
      } catch { /* handled in store */ }
      setStatus(null);
    } else {
      // Instruct — works for both alive (rotation) and dead (continuation) agents
      setStatus(isAlive ? 'sending...' : 'continuing...');
      try {
        await instructAgent(agent.id, message);
      } catch (err) {
        showStatus(`failed: ${err.message}`);
      }
      setStatus(null);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div style={styles.container}>
      {/* Timeline */}
      <div ref={scrollRef} style={styles.timeline}>
        {timeline.length === 0 && (
          <div style={styles.hint}>
            {isAlive
              ? 'Type a message to instruct this agent. Prefix with ? to query without disrupting.'
              : 'Agent finished. Reply to continue the conversation.'}
          </div>
        )}
        {timeline.map((entry, i) => (
          <div key={i} style={styles.entry}>
            {entry.from === 'user' && (
              <div style={styles.userMsg}>
                <span style={styles.userLabel}>
                  {entry.isQuery ? '? you' : '> you'}
                </span>
                <div style={styles.userText}>{entry.text}</div>
              </div>
            )}
            {entry.from === 'agent' && (
              <div style={styles.agentMsg}>
                <span style={styles.agentLabel}>{agent.name}</span>
                <div style={styles.agentText}>{entry.text}</div>
              </div>
            )}
            {entry.from === 'system' && (
              <div style={styles.systemMsg}>{entry.text}</div>
            )}
            <span style={styles.time}>
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
          </div>
        ))}
        {status && (
          <div style={styles.statusMsg}>{status}</div>
        )}
      </div>

      {/* Input — always enabled */}
      <div style={styles.inputRow}>
        <input
          style={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isAlive ? 'message or ?query...' : 'reply to continue...'}
          disabled={!!status}
          spellCheck={false}
        />
        <button
          onClick={handleSubmit}
          disabled={!!status || !input.trim()}
          style={{
            ...styles.sendBtn,
            opacity: (!!status || !input.trim()) ? 0.3 : 1,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

function parseActivityText(text) {
  if (!text) return '';
  // Try to parse stream-json entries and extract readable text
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      return data
        .map((item) => {
          if (item.type === 'text' && item.text) return item.text;
          if (item.type === 'thinking' && item.thinking) return null; // skip thinking
          if (item.type === 'tool_use') return null; // skip tool calls
          return null;
        })
        .filter(Boolean)
        .join('\n') || null;
    }
    if (data.type === 'text' && data.text) return data.text;
    if (data.type === 'result' && data.result) return data.result;
    return null;
  } catch {
    // Not JSON — return as-is if it's meaningful
    if (text.length > 5) return text;
    return null;
  }
}

function buildTimeline(chats, activity) {
  const items = [];

  for (const msg of chats) {
    items.push({
      timestamp: msg.timestamp,
      from: msg.from,
      text: msg.text,
      isQuery: msg.isQuery,
    });
  }

  // Parse and add meaningful activity entries
  for (const a of activity.slice(-30)) {
    const parsed = parseActivityText(a.text);
    if (!parsed) continue;

    // Skip if we have a chat entry near this time from the agent
    const hasChatNear = items.some((it) =>
      Math.abs(it.timestamp - a.timestamp) < 2000 && it.from === 'agent'
    );
    if (!hasChatNear) {
      items.push({
        timestamp: a.timestamp,
        from: 'agent',
        text: parsed.slice(0, 500),
      });
    }
  }

  items.sort((a, b) => a.timestamp - b.timestamp);
  return items;
}

const styles = {
  container: {
    flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  timeline: {
    flex: 1, overflowY: 'auto', padding: '10px 0',
  },
  hint: {
    color: 'var(--text-dim)', fontSize: 11, padding: '20px 4px',
    textAlign: 'center', lineHeight: 1.6,
  },
  entry: {
    padding: '4px 0', position: 'relative',
  },
  userMsg: {
    display: 'flex', flexDirection: 'column', gap: 2,
  },
  userLabel: {
    fontSize: 10, fontWeight: 600, color: 'var(--accent)',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  userText: {
    fontSize: 12, color: 'var(--text-bright)', lineHeight: 1.5,
    padding: '4px 8px', background: 'var(--bg-surface)',
    borderRadius: 2, border: '1px solid var(--border)',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
  agentMsg: {
    display: 'flex', flexDirection: 'column', gap: 2,
  },
  agentLabel: {
    fontSize: 10, fontWeight: 600, color: 'var(--green)',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  agentText: {
    fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5,
    padding: '4px 8px', background: 'var(--bg-base)',
    borderRadius: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
  systemMsg: {
    fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic',
    padding: '2px 0',
  },
  time: {
    position: 'absolute', top: 4, right: 0,
    fontSize: 9, color: 'var(--text-muted)',
  },
  statusMsg: {
    fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic',
    padding: '6px 0',
  },
  inputRow: {
    display: 'flex', gap: 6, padding: '8px 0 0',
    borderTop: '1px solid var(--border)',
  },
  input: {
    flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 2, padding: '8px 10px',
    color: 'var(--text-primary)', fontSize: 12,
    fontFamily: 'var(--font)', outline: 'none',
  },
  sendBtn: {
    padding: '8px 14px',
    background: 'transparent', border: '1px solid var(--accent)',
    borderRadius: 2,
    color: 'var(--accent)', fontSize: 11, fontWeight: 600,
    fontFamily: 'var(--font)', cursor: 'pointer',
  },
};
