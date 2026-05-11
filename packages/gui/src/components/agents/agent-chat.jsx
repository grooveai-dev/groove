// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, MessageSquare, HelpCircle, ArrowRight, Paperclip, Square, FileCode, Terminal as TerminalIcon, X } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { ThinkingIndicator } from '../ui/thinking-indicator';
import { TableTree } from '../ui/table-tree';
import { timeAgo } from '../../lib/format';

const EMPTY = [];

function parseSegments(text) {
  const lines = text.split('\n');
  const segments = [];
  let i = 0;
  let textLines = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line.includes('|') && i + 1 < lines.length && /^\|?\s*[-:]+/.test(lines[i + 1])) {
      if (textLines.length > 0) {
        segments.push({ type: 'text', content: textLines.join('\n') });
        textLines = [];
      }
      const headers = line.split('|').map((c) => c.trim()).filter(Boolean);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(lines[i].split('|').map((c) => c.trim()).filter(Boolean));
        i++;
      }
      segments.push({ type: 'table', headers, rows });
    } else {
      textLines.push(line);
      i++;
    }
  }
  if (textLines.length > 0) segments.push({ type: 'text', content: textLines.join('\n') });
  return segments;
}

function highlightKeeper(text) {
  const parts = text.split(/(\[(?:save|append|update|delete|view|doc|link|read|instruct)\]|#[\w/.-]+)/gi);
  return parts.map((part, i) => {
    if (/^\[(?:save|append|update|delete|view|doc|link|read|instruct)\]$/i.test(part)) {
      return <span key={i} className="px-1 py-0.5 rounded bg-accent/15 text-accent font-semibold font-mono text-2xs">{part}</span>;
    }
    if (/^#[\w/.-]+$/.test(part)) {
      return <span key={i} className="text-accent font-medium">{part}</span>;
    }
    return part;
  });
}

function FormattedText({ text }) {
  if (!text) return null;
  const segments = parseSegments(text);
  return (
    <>
      {segments.map((seg, idx) => {
        if (seg.type === 'table') {
          return <TableTree key={idx} headers={seg.headers} rows={seg.rows} />;
        }
        const parts = seg.content.split(/(```[\s\S]*?```|`[^`]+`)/g);
        return (
          <span key={idx}>
            {parts.map((part, i) => {
              if (part.startsWith('```') && part.endsWith('```')) {
                const code = part.slice(3, -3).replace(/^\w+\n/, '');
                return <pre key={i} className="my-2 p-3 rounded-md bg-surface-0 text-xs font-mono text-text-1 overflow-x-auto whitespace-pre-wrap">{code}</pre>;
              }
              if (part.startsWith('`') && part.endsWith('`')) {
                return <code key={i} className="px-1.5 py-0.5 rounded bg-surface-0 text-xs font-mono text-accent">{part.slice(1, -1)}</code>;
              }
              return <span key={i}>{part.split(/(\*\*[^*]+\*\*)/g).map((s, j) =>
                s.startsWith('**') && s.endsWith('**')
                  ? <strong key={j} className="font-semibold text-text-0">{s.slice(2, -2)}</strong>
                  : <span key={j}>{highlightKeeper(s)}</span>
              )}</span>;
            })}
          </span>
        );
      })}
    </>
  );
}

function UserMessage({ msg }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%]">
        {msg.isQuery && (
          <div className="flex items-center gap-1 justify-end mb-1">
            <HelpCircle size={10} className="text-info" />
            <span className="text-2xs text-info font-sans">Query</span>
          </div>
        )}
        <div className={cn(
          'px-3 py-2 rounded-xl rounded-br-sm',
          msg.isQuery ? 'bg-info/10 border border-info/15' : 'bg-accent/10 border border-accent/15',
        )}>
          <p className="text-xs text-text-0 font-sans whitespace-pre-wrap break-words leading-relaxed">
            <FormattedText text={msg.text} />
          </p>
        </div>
        <div className="text-2xs text-text-4 font-sans mt-0.5 text-right">{timeAgo(msg.timestamp)}</div>
      </div>
    </div>
  );
}

function AgentMessage({ msg, agent }) {
  return (
    <div>
      <div className="text-2xs text-text-3 font-sans mb-0.5 font-medium">{agent?.name}</div>
      <div className="border-l-2 border-accent/40 pl-3 py-0.5">
        <div className="text-xs text-text-1 font-sans whitespace-pre-wrap break-words leading-relaxed">
          <FormattedText text={msg.text} />
        </div>
      </div>
      <div className="text-2xs text-text-4 font-sans mt-0.5">{timeAgo(msg.timestamp)}</div>
    </div>
  );
}

function SystemMessage({ msg }) {
  return (
    <div className="flex justify-center py-1">
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-4/50">
        <ArrowRight size={10} className="text-text-4" />
        <span className="text-2xs text-text-3 font-sans">{msg.text}</span>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="border-l-2 border-accent/40 pl-3 py-2">
      <div className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-text-3 animate-pulse" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-text-3 animate-pulse" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-text-3 animate-pulse" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}

function SnippetTag({ snippet, onRemove }) {
  const isCode = snippet.type === 'code';
  const Icon = isCode ? FileCode : TerminalIcon;
  const lines = snippet.code.split('\n').length;
  let label;
  if (isCode && snippet.filePath) {
    const fileName = snippet.filePath.split('/').pop();
    label = `${fileName}:${snippet.lineStart}-${snippet.lineEnd}`;
  } else {
    label = `${isCode ? '' : 'Terminal · '}${lines} line${lines !== 1 ? 's' : ''}`;
  }
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/10 border border-accent/20 text-accent">
      <Icon size={11} className="flex-shrink-0" />
      <span className="text-2xs font-sans font-medium truncate max-w-[160px]">{label}</span>
      {snippet.instruction && (
        <span className="text-2xs text-accent/60 truncate max-w-[100px]">· {snippet.instruction}</span>
      )}
      <button onClick={onRemove} className="p-0.5 rounded hover:bg-accent/20 cursor-pointer flex-shrink-0">
        <X size={9} />
      </button>
    </div>
  );
}

export function AgentChat({ agent }) {
  const chatHistory = useGrooveStore((s) => s.chatHistory[agent.id]) || EMPTY;
  const activityLog = useGrooveStore((s) => s.activityLog[agent.id]) || EMPTY;
  const instructAgent = useGrooveStore((s) => s.instructAgent);
  const isThinking = useGrooveStore((s) => s.thinkingAgents?.has(agent.id));

  const pendingSnippet = useGrooveStore((s) => s.editorPendingSnippet);
  const clearSnippet = useGrooveStore((s) => s.clearSnippet);

  const storeInput = useGrooveStore((s) => s.chatInputs[agent.id] || '');
  const setStoreInput = (val) => useGrooveStore.setState((s) => ({ chatInputs: { ...s.chatInputs, [agent.id]: val } }));
  const input = storeInput;
  const setInput = setStoreInput;
  const [sending, setSending] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    if (pendingSnippet) inputRef.current?.focus();
  }, [pendingSnippet]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function handleScroll() {
      isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    }
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory.length, activityLog.length, sending, isThinking]);

  function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    // Use webkitRelativePath or name — files from input have path info
    const paths = files.map((f) => f.name);
    setAttachedFiles((prev) => [...prev, ...paths]);
    // Also add file paths to the prompt so the agent knows about them
    const pathList = files.map((f) => f.name).join(', ');
    setInput((prev) => prev + (prev ? '\n' : '') + `[Attached files: ${pathList}]`);
    e.target.value = '';
  }

  async function handleSend() {
    const text = input.trim();
    if ((!text && !pendingSnippet) || sending) return;
    const parts = [];
    if (text) parts.push(text);
    if (pendingSnippet) {
      const s = pendingSnippet;
      if (s.type === 'code' && s.filePath) {
        if (s.instruction && !text) parts.push(s.instruction);
        parts.push(`File: ${s.filePath} (lines ${s.lineStart}-${s.lineEnd})`);
        parts.push('```\n' + s.code + '\n```');
      } else if (s.code) {
        parts.push('```\n' + s.code + '\n```');
      }
    }
    const message = parts.join('\n\n');
    setInput('');
    setAttachedFiles([]);
    clearSnippet();
    setSending(true);
    isAtBottomRef.current = true;
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
    try {
      await instructAgent(agent.id, message);
    } catch { /* toast handles */ }
    setSending(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const isAlive = agent.status === 'running' || agent.status === 'starting';

  // Build merged timeline
  const recentActivity = activityLog.slice(-8).map((a, i) => ({
    from: 'agent', text: a.text, timestamp: a.timestamp, key: `act-${i}`,
  }));
  const messages = chatHistory.length > 0 ? chatHistory : recentActivity;

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-12 h-12 rounded-full bg-accent/8 flex items-center justify-center mb-4">
              <MessageSquare size={20} className="text-accent" />
            </div>
            <p className="text-sm font-medium text-text-1 font-sans">
              {isAlive ? 'Agent is running' : 'Agent finished'}
            </p>
            <p className="text-xs text-text-3 font-sans mt-1 max-w-[240px]">
              {isAlive
                ? 'Send a message to guide this agent. Use the stop button to interrupt.'
                : 'Reply to continue the conversation — a new session starts with full context.'}
            </p>
          </div>
        )}
        {messages.map((msg, i) => {
          if (msg.from === 'user') return <UserMessage key={msg.key || i} msg={msg} />;
          if (msg.from === 'system') return <SystemMessage key={msg.key || i} msg={msg} />;
          return <AgentMessage key={msg.key || i} msg={msg} agent={agent} />;
        })}
        {(sending || isThinking) && <ThinkingIndicator className="ml-8 py-1" />}
      </div>

      {/* ── Input area ──────────────────────────────────── */}
      <div className="border-t border-border-subtle px-3 py-2 bg-surface-1">
        {pendingSnippet && (
          <div className="mb-1.5">
            <SnippetTag snippet={pendingSnippet} onRemove={clearSnippet} />
          </div>
        )}
        {input && /\[(?:save|append|update|delete|view|doc|link|read|instruct)\]/i.test(input) && (() => {
          const cmdMatch = input.match(/\[(save|append|update|delete|view|doc|link|read|instruct)\]/i);
          const tags = (input.match(/#[\w/.-]+/g) || []);
          return (
            <div className="flex items-center gap-1.5 px-3 py-1 mb-1.5 rounded-md bg-accent/5 border border-accent/10">
              <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent font-semibold font-mono text-2xs">{cmdMatch[0]}</span>
              {tags.map((tag, i) => <span key={i} className="text-accent font-medium text-2xs">{tag}</span>)}
              <span className="text-2xs text-text-4 ml-auto">memory command</span>
            </div>
          );
        })()}
        <div className="flex items-end gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.gif,.svg,.csv,.txt,.md,.json,.yaml,.yml,.docx,.pptx,.xlsx"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-text-4 hover:text-text-1 hover:bg-surface-3 transition-colors cursor-pointer flex-shrink-0"
            title="Attach file"
          >
            <Paperclip size={14} />
          </button>
          <div className="flex-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={pendingSnippet ? 'Add a message (optional)...' : isAlive ? 'Instruct this agent...' : 'Continue conversation...'}
              rows={1}
              className={cn(
                'w-full resize-none rounded-lg px-3 py-1.5 text-xs',
                'bg-surface-0 border font-sans',
                'placeholder:text-text-4',
                'focus:outline-none focus:ring-1',
                'min-h-[32px] max-h-[120px]',
                'border-border focus:ring-accent/40',
                input && /\[(?:save|append|update|delete|view|doc|link|read|instruct)\]/i.test(input)
                  ? 'text-accent'
                  : 'text-text-0',
              )}
            />
          </div>
          {isAlive && (
            <button
              onClick={() => useGrooveStore.getState().stopAgent(agent.id)}
              title="Stop agent"
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-all cursor-pointer bg-danger/80 text-white hover:bg-danger flex-shrink-0"
            >
              <Square size={12} fill="currentColor" />
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={(!input.trim() && !pendingSnippet) || sending}
            className={cn(
              'w-8 h-8 flex items-center justify-center rounded-lg transition-all cursor-pointer flex-shrink-0',
              'disabled:opacity-20 disabled:cursor-not-allowed',
              (input.trim() || pendingSnippet)
                ? 'bg-accent/15 text-accent hover:bg-accent/25 border border-accent/25'
                : 'bg-surface-4 text-text-4',
            )}
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
