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
      e.stopPropagation();
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
                <div style={styles.agentText}>
                  {/* Stream the latest agent message, show history instantly */}
                  {i === timeline.length - 1 && entry.from === 'agent' && Date.now() - entry.timestamp < 5000
                    ? <StreamingText text={entry.text} />
                    : <FormattedText text={entry.text} />
                  }
                </div>
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

      {/* Launch Team button — shown when planner completes */}
      {agent.role === 'planner' && agent.status === 'completed' && (
        <LaunchTeamButton showStatus={showStatus} />
      )}

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
          type="button"
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

// ── STREAMING TEXT — reveals text progressively for latest agent message ──

function StreamingText({ text }) {
  const [revealed, setRevealed] = useState(0);
  const textRef = useRef(text);

  useEffect(() => {
    // Reset on new text
    textRef.current = text;
    setRevealed(0);
  }, [text]);

  useEffect(() => {
    if (revealed >= text.length) return;
    // Reveal 2-4 chars at a time for a smooth streaming feel
    const chunkSize = Math.random() > 0.7 ? 4 : 2;
    const timer = setTimeout(() => {
      setRevealed((r) => Math.min(r + chunkSize, text.length));
    }, 12);
    return () => clearTimeout(timer);
  }, [revealed, text.length]);

  const visibleText = text.slice(0, revealed);
  const done = revealed >= text.length;

  return (
    <>
      <FormattedText text={visibleText} />
      {!done && <span style={styles.cursor}>|</span>}
    </>
  );
}

// ── LAUNCH TEAM BUTTON — one-click spawn from planner recommendation ──

function LaunchTeamButton({ showStatus }) {
  const [team, setTeam] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);

  useEffect(() => {
    fetch('/api/recommended-team')
      .then((r) => r.json())
      .then((d) => { if (d.exists && d.agents.length > 0) setTeam(d.agents); })
      .catch(() => {});
  }, []);

  async function handleLaunch() {
    setLaunching(true);
    try {
      const res = await fetch('/api/recommended-team/launch', { method: 'POST' });
      const data = await res.json();
      if (data.launched) {
        showStatus(`Launched ${data.launched} agents`);
        setLaunched(true);
      } else {
        showStatus(`Launch failed: ${data.error || 'unknown'}`);
      }
    } catch (err) {
      showStatus(`Launch failed: ${err.message}`);
    }
    setLaunching(false);
  }

  if (!team || launched) return null;

  return (
    <div style={styles.launchBox}>
      <div style={styles.launchHeader}>Recommended Team ({team.length} agents)</div>
      <div style={styles.launchList}>
        {team.map((a, i) => (
          <div key={i} style={styles.launchAgent}>
            <span style={styles.launchRole}>{a.role}</span>
            <span style={styles.launchPrompt}>{(a.prompt || '').slice(0, 80)}{(a.prompt || '').length > 80 ? '...' : ''}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={handleLaunch}
        disabled={launching}
        style={{ ...styles.launchBtn, opacity: launching ? 0.5 : 1 }}
      >
        {launching ? 'Launching...' : 'Launch Team'}
      </button>
    </div>
  );
}

// ── FORMATTED TEXT — renders markdown-like agent output cleanly ──

function FormattedText({ text }) {
  if (!text) return null;
  const lines = text.split('\n');

  return lines.map((line, i) => {
    // Headers: ### or ## or #
    if (/^#{1,3}\s/.test(line)) {
      const content = line.replace(/^#{1,3}\s+/, '');
      return <div key={i} style={{ fontWeight: 700, color: 'var(--text-bright)', marginTop: i > 0 ? 6 : 0, marginBottom: 2, fontSize: 11 }}>{renderInline(content)}</div>;
    }

    // Horizontal rules
    if (/^[-*_]{3,}\s*$/.test(line)) {
      return <div key={i} style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />;
    }

    // List items: - or * or numbered
    if (/^\s*[-*]\s/.test(line)) {
      const indent = line.match(/^(\s*)/)[1].length;
      const content = line.replace(/^\s*[-*]\s+/, '');
      return <div key={i} style={{ paddingLeft: 8 + indent * 6, position: 'relative' }}>
        <span style={{ position: 'absolute', left: indent * 6, color: 'var(--text-dim)' }}>-</span>
        {renderInline(content)}
      </div>;
    }
    if (/^\s*\d+\.\s/.test(line)) {
      const indent = line.match(/^(\s*)/)[1].length;
      const num = line.match(/(\d+)\./)[1];
      const content = line.replace(/^\s*\d+\.\s+/, '');
      return <div key={i} style={{ paddingLeft: 12 + indent * 6, position: 'relative' }}>
        <span style={{ position: 'absolute', left: indent * 6, color: 'var(--text-dim)' }}>{num}.</span>
        {renderInline(content)}
      </div>;
    }

    // Empty lines
    if (!line.trim()) return <div key={i} style={{ height: 4 }} />;

    // Normal text
    return <div key={i}>{renderInline(line)}</div>;
  });
}

function renderInline(text) {
  // Split on bold (**text**), code (`text`), and italic (*text*)
  const parts = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold: **text**
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)/s);
    if (boldMatch) {
      if (boldMatch[1]) parts.push(<span key={key++}>{boldMatch[1]}</span>);
      parts.push(<span key={key++} style={{ fontWeight: 700, color: 'var(--text-bright)' }}>{boldMatch[2]}</span>);
      remaining = boldMatch[3];
      continue;
    }

    // Inline code: `text`
    const codeMatch = remaining.match(/^(.*?)`(.+?)`(.*)/s);
    if (codeMatch) {
      if (codeMatch[1]) parts.push(<span key={key++}>{codeMatch[1]}</span>);
      parts.push(<span key={key++} style={{ background: 'var(--bg-base)', padding: '0 3px', borderRadius: 2, color: 'var(--accent)', fontSize: '0.95em' }}>{codeMatch[2]}</span>);
      remaining = codeMatch[3];
      continue;
    }

    // No more patterns — emit rest as plain text
    parts.push(<span key={key++}>{remaining}</span>);
    break;
  }

  return parts.length > 0 ? parts : text;
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

    // Skip raw JSON arrays (team configs, tool results)
    if (parsed.trimStart().startsWith('[') || parsed.trimStart().startsWith('{')) continue;

    // Skip if we have a chat entry near this time from the agent
    const hasChatNear = items.some((it) =>
      Math.abs(it.timestamp - a.timestamp) < 2000 && it.from === 'agent'
    );
    if (!hasChatNear) {
      items.push({
        timestamp: a.timestamp,
        from: 'agent',
        text: parsed.slice(0, 2000),
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

  // Streaming cursor
  cursor: {
    color: 'var(--accent)', fontWeight: 400, animation: 'pulse 1s infinite',
    marginLeft: 1,
  },

  // Launch team
  launchBox: {
    padding: '8px 0',
    borderTop: '1px solid var(--border)',
    flexShrink: 0,
  },
  launchHeader: {
    fontSize: 10, fontWeight: 700, color: 'var(--text-bright)',
    marginBottom: 6,
  },
  launchList: {
    display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8,
  },
  launchAgent: {
    display: 'flex', alignItems: 'baseline', gap: 6,
    fontSize: 10, padding: '2px 0',
  },
  launchRole: {
    fontWeight: 600, color: 'var(--accent)', minWidth: 60,
  },
  launchPrompt: {
    color: 'var(--text-dim)', fontSize: 9,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    flex: 1,
  },
  launchBtn: {
    width: '100%', padding: '8px',
    background: 'rgba(51, 175, 188, 0.1)', border: '1px solid var(--accent)',
    color: 'var(--accent)', fontSize: 11, fontWeight: 700,
    fontFamily: 'var(--font)', cursor: 'pointer',
    letterSpacing: 0.5,
  },
};
