// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Send, Loader2, MessageSquare, HelpCircle, ArrowRight,
  FileEdit, Search, Terminal, CheckCircle2, AlertCircle,
  RotateCw, Zap, Wrench, Eye, FileText, Code2, Bug,
  ChevronDown,
} from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { timeAgo } from '../../lib/format';

const EMPTY = [];

// ── Activity metadata ────────────────────────────────────────
function activityMeta(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('reading') || t.includes('read '))
    return { icon: Eye, color: 'text-info', label: 'Reading' };
  if (t.includes('editing') || t.includes('wrote') || t.includes('writing') || t.includes('edit '))
    return { icon: FileEdit, color: 'text-warning', label: 'Editing' };
  if (t.includes('searching') || t.includes('search') || t.includes('grep') || t.includes('glob'))
    return { icon: Search, color: 'text-purple', label: 'Searching' };
  if (t.includes('running') || t.includes('bash') || t.includes('command') || t.includes('exec'))
    return { icon: Terminal, color: 'text-orange', label: 'Running' };
  if (t.includes('test') || t.includes('pass'))
    return { icon: CheckCircle2, color: 'text-success', label: 'Testing' };
  if (t.includes('error') || t.includes('fail') || t.includes('crash'))
    return { icon: AlertCircle, color: 'text-danger', label: 'Error' };
  if (t.includes('rotat'))
    return { icon: RotateCw, color: 'text-accent', label: 'Rotating' };
  if (t.includes('spawn') || t.includes('start'))
    return { icon: Zap, color: 'text-success', label: 'Spawned' };
  if (t.includes('tool') || t.includes('function'))
    return { icon: Wrench, color: 'text-text-2', label: 'Tool' };
  if (t.includes('complet') || t.includes('done') || t.includes('finish'))
    return { icon: CheckCircle2, color: 'text-success', label: 'Done' };
  return { icon: Code2, color: 'text-text-3', label: 'Activity' };
}

// ── Markdown-lite rendering ──────────────────────────────────
function FormattedText({ text }) {
  if (!text) return null;
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const code = part.slice(3, -3).replace(/^\w+\n/, '');
          return <pre key={i} className="my-2 p-3 rounded-lg bg-black/30 text-[12px] font-mono text-text-1 overflow-x-auto whitespace-pre-wrap border border-white/[0.04] leading-relaxed">{code}</pre>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i} className="px-1 py-px rounded bg-white/[0.06] text-[12px] font-mono text-accent">{part.slice(1, -1)}</code>;
        }
        return <span key={i}>{part.split(/(\*\*[^*]+\*\*)/g).map((s, j) =>
          s.startsWith('**') && s.endsWith('**')
            ? <strong key={j} className="font-semibold text-text-0">{s.slice(2, -2)}</strong>
            : s
        )}</span>;
      })}
    </span>
  );
}

// ── Message components ───────────────────────────────────────

function UserMessage({ msg }) {
  return (
    <div className="flex justify-end pl-12">
      <div className="max-w-[85%]">
        <div className={cn(
          'px-3.5 py-2.5 rounded-lg rounded-br-sm',
          msg.isQuery
            ? 'bg-info/12 text-text-0'
            : 'bg-accent/12 text-text-0',
        )}>
          <div className="text-[13px] font-sans whitespace-pre-wrap break-words leading-relaxed">
            <FormattedText text={msg.text} />
          </div>
        </div>
        <div className="text-2xs text-text-4 font-sans mt-1 text-right">{timeAgo(msg.timestamp)}</div>
      </div>
    </div>
  );
}

function AgentMessage({ msg }) {
  return (
    <div className="pr-8">
      <div className="border-l-2 border-accent/30 pl-3.5 py-0.5">
        <div className="text-[13px] text-text-1 font-sans whitespace-pre-wrap break-words leading-relaxed">
          <FormattedText text={msg.text} />
        </div>
      </div>
      <div className="text-2xs text-text-4 font-sans mt-1 pl-4">{timeAgo(msg.timestamp)}</div>
    </div>
  );
}

function SystemMessage({ msg }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 h-px bg-border-subtle" />
      <span className="text-2xs text-text-4 font-sans flex-shrink-0">{msg.text}</span>
      <div className="flex-1 h-px bg-border-subtle" />
    </div>
  );
}

// ── Activity components ──────────────────────────────────────

function ActivityLine({ entry }) {
  const meta = activityMeta(entry.text);
  const Icon = meta.icon;
  const display = entry.text?.length > 100 ? entry.text.slice(0, 100) + '...' : entry.text;

  return (
    <div className="flex items-center gap-2 py-px group">
      <Icon size={9} className={cn(meta.color, 'flex-shrink-0 opacity-60')} />
      <p className="text-2xs text-text-3 font-sans truncate flex-1 min-w-0">{display}</p>
      <span className="text-2xs text-text-4 font-mono opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {timeAgo(entry.timestamp)}
      </span>
    </div>
  );
}

function ActivityGroup({ entries }) {
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 1) {
    return <ActivityLine entry={entries[0]} />;
  }

  const visible = expanded ? entries : [entries[0]];
  const hiddenCount = entries.length - 1;

  return (
    <div className="space-y-px py-0.5 border-l border-border-subtle pl-3 ml-1">
      {visible.map((entry, i) => (
        <ActivityLine key={i} entry={entry} />
      ))}
      {!expanded && hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1 text-2xs text-text-4 hover:text-text-2 font-sans cursor-pointer py-0.5"
        >
          <ChevronDown size={8} />
          <span>{hiddenCount} more</span>
        </button>
      )}
    </div>
  );
}

// ── Streaming status bar ─────────────────────────────────────

function StreamingBar({ agent }) {
  const activityLog = useGrooveStore((s) => s.activityLog[agent.id]) || EMPTY;
  const lastActivity = activityLog[activityLog.length - 1];
  const meta = lastActivity ? activityMeta(lastActivity.text) : null;
  const Icon = meta?.icon || Code2;
  const isRecent = lastActivity && (Date.now() - lastActivity.timestamp) < 10000;

  const display = isRecent && lastActivity.text
    ? (lastActivity.text.length > 50 ? lastActivity.text.slice(0, 50) + '...' : lastActivity.text)
    : null;

  return (
    <div className="flex items-center gap-2 px-4 h-7 border-b border-border-subtle bg-surface-0/50 flex-shrink-0">
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <div className="relative flex items-center justify-center w-3.5 h-3.5">
          <span className="absolute inset-0 rounded-full bg-accent/20 animate-ping" style={{ animationDuration: '2s' }} />
          <span className="relative w-1.5 h-1.5 rounded-full bg-accent" />
        </div>
        {isRecent ? (
          <>
            <Icon size={9} className={cn(meta.color, 'flex-shrink-0')} />
            <span className="text-2xs text-text-2 font-sans truncate">{display}</span>
          </>
        ) : (
          <span className="text-2xs text-text-3 font-sans">Processing...</span>
        )}
      </div>
      <span className="text-2xs text-text-4 font-mono flex-shrink-0">
        {fmtTokens(agent.tokensUsed)} tok
      </span>
    </div>
  );
}

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// ── Main Feed ────────────────────────────────────────────────

export function AgentFeed({ agent }) {
  const chatHistory = useGrooveStore((s) => s.chatHistory[agent.id]) || EMPTY;
  const activityLog = useGrooveStore((s) => s.activityLog[agent.id]) || EMPTY;
  const instructAgent = useGrooveStore((s) => s.instructAgent);
  const queryAgent = useGrooveStore((s) => s.queryAgent);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const timeline = useMemo(() => {
    const items = [];
    const chatTexts = new Set(chatHistory.map((m) => m.text));

    for (const msg of chatHistory) {
      items.push({ ...msg, kind: 'chat', ts: msg.timestamp });
    }

    const recentActivity = activityLog.slice(-30);
    for (const entry of recentActivity) {
      const text = (entry.text || '').trim();
      if (text && !chatTexts.has(entry.text)) {
        items.push({ ...entry, kind: 'activity', ts: entry.timestamp });
      }
    }

    items.sort((a, b) => a.ts - b.ts);

    const grouped = [];
    let activityBuf = [];
    for (const item of items) {
      if (item.kind === 'activity') {
        activityBuf.push(item);
      } else {
        if (activityBuf.length > 0) {
          grouped.push({ kind: 'activity-group', entries: activityBuf });
          activityBuf = [];
        }
        grouped.push(item);
      }
    }
    if (activityBuf.length > 0) {
      grouped.push({ kind: 'activity-group', entries: activityBuf });
    }

    return grouped;
  }, [chatHistory, activityLog]);

  useEffect(() => {
    if (scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, [timeline.length]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    if (text === '/rotate') {
      const rotateAgent = useGrooveStore.getState().rotateAgent;
      setInput('');
      try { await rotateAgent(agent.id); } catch {}
      return;
    }

    setInput('');
    setSending(true);
    try {
      if (text.startsWith('?')) {
        await queryAgent(agent.id, text.slice(1).trim());
      } else {
        await instructAgent(agent.id, text);
      }
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

  const isQuery = input.startsWith('?');
  const isAlive = agent.status === 'running' || agent.status === 'starting';

  return (
    <div className="flex flex-col h-full min-h-0">
      {isAlive && <StreamingBar agent={agent} />}

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {timeline.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            {isAlive ? (
              <>
                <div className="relative w-10 h-10 mb-4">
                  <span className="absolute inset-0 rounded-full border border-accent/25 animate-ping" style={{ animationDuration: '2.5s' }} />
                  <span className="absolute inset-0 rounded-full bg-accent/6 flex items-center justify-center">
                    <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                  </span>
                </div>
                <p className="text-sm font-medium text-text-1 font-sans">{agent.name} initializing</p>
                <p className="text-xs text-text-3 font-sans mt-1.5">Scanning workspace and loading context</p>
              </>
            ) : (
              <>
                <MessageSquare size={18} className="text-text-4 mb-3" />
                <p className="text-sm font-medium text-text-1 font-sans">Session complete</p>
                <p className="text-xs text-text-3 font-sans mt-1.5">Reply to continue with full context</p>
              </>
            )}
          </div>
        )}
        {timeline.map((item, i) => {
          if (item.kind === 'activity-group') {
            return <ActivityGroup key={`grp-${i}`} entries={item.entries} />;
          }
          if (item.from === 'user') return <UserMessage key={`msg-${i}`} msg={item} />;
          if (item.from === 'system') return <SystemMessage key={`msg-${i}`} msg={item} />;
          return <AgentMessage key={`msg-${i}`} msg={item} agent={agent} />;
        })}
        {sending && (
          <div className="border-l-2 border-accent/20 pl-3.5 py-2">
            <div className="flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-accent/60 animate-pulse" style={{ animationDelay: '0ms' }} />
              <span className="w-1 h-1 rounded-full bg-accent/60 animate-pulse" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-1 rounded-full bg-accent/60 animate-pulse" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border-subtle px-3 py-2.5 bg-surface-0/30 flex-shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={isAlive ? (isQuery ? 'Query (read-only)...' : 'Instruct agent...') : 'Continue conversation...'}
            rows={1}
            className={cn(
              'flex-1 resize-none rounded-lg px-3 py-2 text-[13px]',
              'bg-surface-0 border text-text-0 font-sans',
              'placeholder:text-text-4',
              'focus:outline-none focus:ring-1',
              'max-h-[100px] min-h-[36px]',
              isQuery ? 'border-info/25 focus:ring-info/30' : 'border-border-subtle focus:ring-accent/30',
            )}
            style={{ height: Math.min(Math.max(36, input.split('\n').length * 20), 100) }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className={cn(
              'w-8 h-8 flex items-center justify-center rounded-lg transition-all cursor-pointer flex-shrink-0',
              'disabled:opacity-15 disabled:cursor-not-allowed',
              input.trim()
                ? 'bg-accent text-surface-0 hover:bg-accent/85'
                : 'bg-transparent text-text-4',
            )}
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
        {isQuery && (
          <div className="text-2xs text-info/70 font-sans mt-1 pl-1">Read-only query — agent keeps running</div>
        )}
      </div>
    </div>
  );
}
