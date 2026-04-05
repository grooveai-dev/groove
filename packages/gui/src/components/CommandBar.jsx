// GROOVE GUI — Global Command Bar
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useRef, useCallback } from 'react';
import { useGrooveStore } from '../stores/groove';

export default function CommandBar() {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState(null); // { text, type: 'info'|'error' }
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef();

  const agents = useGrooveStore((s) => s.agents);
  const detailPanel = useGrooveStore((s) => s.detailPanel);
  const instructAgent = useGrooveStore((s) => s.instructAgent);
  const commandHistory = useGrooveStore((s) => s.commandHistory);
  const addCommand = useGrooveStore((s) => s.addCommand);
  const connected = useGrooveStore((s) => s.connected);

  const selectedAgentId = detailPanel?.type === 'agent' ? detailPanel.agentId : null;

  const resolveTarget = useCallback((text) => {
    // Check for @agent-name prefix
    const match = text.match(/^@(\S+)\s+(.*)/s);
    if (match) {
      const name = match[1];
      const message = match[2].trim();
      const agent = agents.find((a) => a.name === name || a.id === name || a.id.startsWith(name));
      if (agent) return { agent, message };
      return { error: `agent "${name}" not found` };
    }

    // No @-prefix — use selected agent
    if (selectedAgentId) {
      const agent = agents.find((a) => a.id === selectedAgentId);
      if (agent) return { agent, message: text.trim() };
    }

    return { error: 'select an agent or use @agent-name' };
  }, [agents, selectedAgentId]);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text) return;

    const result = resolveTarget(text);

    if (result.error) {
      setStatus({ text: result.error, type: 'error' });
      setTimeout(() => setStatus(null), 3000);
      return;
    }

    addCommand(text);
    setInput('');
    setHistoryIndex(-1);
    setStatus({ text: `@${result.agent.name} rotating...`, type: 'info' });

    try {
      await instructAgent(result.agent.id, result.message);
      setStatus({ text: `@${result.agent.name} instruction delivered`, type: 'info' });
      setTimeout(() => setStatus(null), 4000);
    } catch (err) {
      setStatus({ text: `failed: ${err.message}`, type: 'error' });
      setTimeout(() => setStatus(null), 5000);
    }
  }, [input, resolveTarget, instructAgent, addCommand]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const next = historyIndex + 1;
      if (next < commandHistory.length) {
        setHistoryIndex(next);
        setInput(commandHistory[commandHistory.length - 1 - next]);
      }
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex <= 0) {
        setHistoryIndex(-1);
        setInput('');
      } else {
        const next = historyIndex - 1;
        setHistoryIndex(next);
        setInput(commandHistory[commandHistory.length - 1 - next]);
      }
    }
  }, [handleSubmit, commandHistory, historyIndex]);

  if (!connected) return null;

  const selectedAgent = selectedAgentId ? agents.find((a) => a.id === selectedAgentId) : null;
  const placeholder = selectedAgent
    ? `> instruct ${selectedAgent.name}...`
    : '> @agent-name message...';

  return (
    <div style={styles.bar}>
      <span style={styles.prompt}>{'>'}</span>
      {status ? (
        <span style={{
          ...styles.status,
          color: status.type === 'error' ? 'var(--red)' : 'var(--text-dim)',
        }}>
          {status.text}
        </span>
      ) : (
        <input
          ref={inputRef}
          style={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          spellCheck={false}
        />
      )}
    </div>
  );
}

const styles = {
  bar: {
    height: 40, flexShrink: 0,
    background: 'var(--bg-chrome)',
    borderTop: '1px solid var(--border)',
    display: 'flex', alignItems: 'center',
    padding: '0 12px', gap: 8,
  },
  prompt: {
    color: 'var(--accent)', fontSize: 14, fontWeight: 700,
    flexShrink: 0,
  },
  input: {
    flex: 1, background: 'transparent', border: 'none',
    color: 'var(--text-primary)', fontSize: 12,
    fontFamily: 'var(--font)', outline: 'none',
  },
  status: {
    flex: 1, fontSize: 11, fontStyle: 'italic',
  },
};
