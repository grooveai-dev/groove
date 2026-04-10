// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Send, Loader2, MessageSquare, ArrowRight,
  FileEdit, Search, Terminal, CheckCircle2, AlertCircle,
  RotateCw, Zap, Wrench, Eye, Code2, Bug,
  ChevronDown, HelpCircle, Pencil,
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
          return (
            <pre key={i} className="my-2.5 p-3.5 rounded-lg bg-[#0d1117] text-[12px] font-mono text-[#c9d1d9] overflow-x-auto whitespace-pre-wrap border border-white/[0.06] leading-relaxed">
              {code}
            </pre>
          );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i} className="px-1.5 py-0.5 rounded bg-accent/8 text-[12px] font-mono text-accent border border-accent/10">{part.slice(1, -1)}</code>;
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
  const isQuery = msg.isQuery;
  return (
    <div className="flex justify-end pl-12">
      <div className="max-w-[85%]">
        {isQuery && (
          <div className="flex items-center justify-end gap-1 mb-1">
            <HelpCircle size={9} className="text-info" />
            <span className="text-2xs text-info font-sans font-medium">Query</span>
          </div>
        )}
        <div className={cn(
          'px-4 py-3 rounded-2xl rounded-br-md',
          isQuery
            ? 'bg-info/10 border border-info/15'
            : 'bg-accent/10 border border-accent/15',
        )}>
          <div className="text-[13px] font-sans whitespace-pre-wrap break-words leading-relaxed text-text-0">
            <FormattedText text={msg.text} />
          </div>
        </div>
        <div className="text-[10px] text-text-4 font-sans mt-1.5 text-right">{timeAgo(msg.timestamp)}</div>
      </div>
    </div>
  );
}

function AgentMessage({ msg, agent }) {
  return (
    <div className="pr-6">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-5 h-5 rounded-md bg-accent/12 flex items-center justify-center flex-shrink-0">
          <Code2 size={10} className="text-accent" />
        </div>
        <span className="text-2xs font-semibold text-text-1 font-sans">{agent?.name || 'Agent'}</span>
        <span className="text-2xs text-text-4 font-sans">{agent?.role}</span>
      </div>
      <div className="ml-7 px-4 py-3 rounded-2xl rounded-tl-md bg-surface-2/60 border border-border-subtle">
        <div className="text-[13px] text-text-1 font-sans whitespace-pre-wrap break-words leading-relaxed">
          <FormattedText text={msg.text} />
        </div>
      </div>
      <div className="text-[10px] text-text-4 font-sans mt-1.5 ml-7">{timeAgo(msg.timestamp)}</div>
    </div>
  );
}

function SystemMessage({ msg }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px bg-border-subtle" />
      <span className="text-[10px] text-text-4 font-sans flex-shrink-0 uppercase tracking-wide">{msg.text}</span>
      <div className="flex-1 h-px bg-border-subtle" />
    </div>
  );
}

// ── Activity components ──────────────────────────────────────

function ActivityLine({ entry }) {
  const meta = activityMeta(entry.text);
  const Icon = meta.icon;
  const display = entry.text?.length > 120 ? entry.text.slice(0, 120) + '...' : entry.text;

  return (
    <div className="flex items-center gap-2 py-0.5 group">
      <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0">
        <Icon size={10} className={cn(meta.color, 'opacity-70')} />
      </div>
      <p className="text-[11px] text-text-3 font-sans truncate flex-1 min-w-0">{display}</p>
      <span className="text-[10px] text-text-4 font-mono opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {timeAgo(entry.timestamp)}
      </span>
    </div>
  );
}

function ActivityGroup({ entries }) {
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 1) {
    return <div className="ml-7"><ActivityLine entry={entries[0]} /></div>;
  }

  const visible = expanded ? entries : entries.slice(0, 2);
  const hiddenCount = entries.length - 2;

  return (
    <div className="ml-7 py-1 pl-3 border-l border-border-subtle/50 space-y-px">
      {visible.map((entry, i) => (
        <ActivityLine key={i} entry={entry} />
      ))}
      {!expanded && hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1.5 text-[11px] text-text-4 hover:text-text-2 font-sans cursor-pointer py-0.5 ml-6"
        >
          <ChevronDown size={9} />
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
    ? (lastActivity.text.length > 60 ? lastActivity.text.slice(0, 60) + '...' : lastActivity.text)
    : null;

  const ctxPct = Math.round((agent.contextUsage || 0) * 100);

  return (
    <div className="flex items-center gap-3 px-4 h-8 border-b border-border-subtle bg-surface-1/80 flex-shrink-0">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="relative flex items-center justify-center w-4 h-4">
          <span className="absolute inset-0 rounded-full bg-accent/15 animate-ping" style={{ animationDuration: '2s' }} />
          <span className="relative w-1.5 h-1.5 rounded-full bg-accent" />
        </div>
        {isRecent ? (
          <>
            <Icon size={10} className={cn(meta.color, 'flex-shrink-0')} />
            <span className="text-[11px] text-text-2 font-sans truncate">{display}</span>
          </>
        ) : (
          <span className="text-[11px] text-text-3 font-sans">Working...</span>
        )}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-[10px] text-text-4 font-mono">{fmtTokens(agent.tokensUsed)}</span>
        <div className="flex items-center gap-1.5">
          <div className="w-14 h-1 rounded-full bg-surface-4 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${ctxPct}%`,
                background: ctxPct >= 75 ? 'var(--color-danger)' : ctxPct >= 50 ? 'var(--color-warning)' : 'var(--color-accent)',
              }}
            />
          </div>
          <span className="text-[10px] text-text-4 font-mono w-7 text-right">{ctxPct}%</span>
        </div>
      </div>
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
  const [mode, setMode] = useState('instruct'); // instruct | query
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
      if (mode === 'query') {
        await queryAgent(agent.id, text);
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

  const isAlive = agent.status === 'running' || agent.status === 'starting';

  return (
    <div className="flex flex-col h-full min-h-0">
      {isAlive && <StreamingBar agent={agent} />}

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {timeline.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            {isAlive ? (
              <>
                <div className="relative w-12 h-12 mb-4">
                  <span className="absolute inset-0 rounded-full border border-accent/20 animate-ping" style={{ animationDuration: '2.5s' }} />
                  <span className="absolute inset-0 rounded-full bg-accent/6 flex items-center justify-center">
                    <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                  </span>
                </div>
                <p className="text-sm font-semibold text-text-0 font-sans">{agent.name}</p>
                <p className="text-xs text-text-3 font-sans mt-1">Initializing session...</p>
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-xl bg-surface-3 flex items-center justify-center mb-3">
                  <MessageSquare size={18} className="text-text-4" />
                </div>
                <p className="text-sm font-semibold text-text-0 font-sans">{agent.name}</p>
                <p className="text-xs text-text-3 font-sans mt-1">Session complete — send a message to continue</p>
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
          <div className="flex items-center gap-2 ml-7 py-2">
            <div className="w-5 h-5 rounded-md bg-accent/12 flex items-center justify-center">
              <Code2 size={10} className="text-accent" />
            </div>
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-surface-2/60 border border-border-subtle">
              <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-pulse" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-pulse" style={{ animationDelay: '200ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-pulse" style={{ animationDelay: '400ms' }} />
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-border px-4 py-3 bg-surface-1/50 flex-shrink-0">
        {/* Mode pills */}
        <div className="flex items-center gap-1 mb-2">
          <button
            onClick={() => setMode('instruct')}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-sans font-medium transition-colors cursor-pointer',
              mode === 'instruct'
                ? 'bg-accent/12 text-accent border border-accent/20'
                : 'text-text-3 hover:text-text-1 hover:bg-surface-3',
            )}
          >
            <Pencil size={10} />
            Instruct
          </button>
          <button
            onClick={() => setMode('query')}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-sans font-medium transition-colors cursor-pointer',
              mode === 'query'
                ? 'bg-info/12 text-info border border-info/20'
                : 'text-text-3 hover:text-text-1 hover:bg-surface-3',
            )}
          >
            <HelpCircle size={10} />
            Query
          </button>
          <span className="text-[10px] text-text-4 font-sans ml-auto">
            {mode === 'query' ? 'Read-only — agent keeps working' : isAlive ? 'Directs the agent' : 'Continues the session'}
          </span>
        </div>

        <div className={cn(
          'flex items-end gap-2 rounded-xl border bg-surface-0 p-1 transition-colors',
          mode === 'query' ? 'border-info/20 focus-within:border-info/40' : 'border-border-subtle focus-within:border-accent/30',
        )}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={mode === 'query'
              ? 'Ask about this agent\'s work...'
              : isAlive ? 'Send an instruction...' : 'Continue this session...'}
            rows={1}
            className={cn(
              'flex-1 resize-none px-3 py-2 text-[13px]',
              'bg-transparent text-text-0 font-sans',
              'placeholder:text-text-4',
              'focus:outline-none',
              'max-h-[120px] min-h-[36px]',
            )}
            style={{ height: Math.min(Math.max(36, input.split('\n').length * 20), 120) }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className={cn(
              'w-9 h-9 flex items-center justify-center rounded-lg transition-all cursor-pointer flex-shrink-0 mb-px',
              'disabled:opacity-15 disabled:cursor-not-allowed',
              input.trim()
                ? mode === 'query'
                  ? 'bg-info text-white hover:bg-info/85'
                  : 'bg-accent text-white hover:bg-accent/85'
                : 'bg-transparent text-text-4',
            )}
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}
