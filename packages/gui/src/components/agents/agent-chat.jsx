// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, MessageSquare, HelpCircle, ArrowRight, Paperclip, Square } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { Avatar } from '../ui/avatar';
import { ThinkingIndicator } from '../ui/thinking-indicator';
import { timeAgo } from '../../lib/format';

const EMPTY = [];

function FormattedText({ text }) {
  if (!text) return null;
  // Simple code block detection
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const code = part.slice(3, -3).replace(/^\w+\n/, '');
          return <pre key={i} className="my-2 p-3 rounded-md bg-surface-0 text-xs font-mono text-text-1 overflow-x-auto whitespace-pre-wrap">{code}</pre>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i} className="px-1.5 py-0.5 rounded bg-surface-0 text-xs font-mono text-accent">{part.slice(1, -1)}</code>;
        }
        // Bold
        return <span key={i}>{part.split(/(\*\*[^*]+\*\*)/g).map((s, j) =>
          s.startsWith('**') && s.endsWith('**')
            ? <strong key={j} className="font-semibold text-text-0">{s.slice(2, -2)}</strong>
            : s
        )}</span>;
      })}
    </span>
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
          'px-3.5 py-2.5 rounded-2xl rounded-br-md',
          msg.isQuery ? 'bg-info/10 border border-info/15' : 'bg-accent/10 border border-accent/15',
        )}>
          <p className="text-sm text-text-0 font-sans whitespace-pre-wrap break-words leading-relaxed">
            <FormattedText text={msg.text} />
          </p>
        </div>
        <div className="text-2xs text-text-4 font-sans mt-1 text-right">{timeAgo(msg.timestamp)}</div>
      </div>
    </div>
  );
}

function AgentMessage({ msg, agent }) {
  return (
    <div className="flex gap-2.5">
      <Avatar name={agent?.name} role={agent?.role} size="sm" className="mt-1 flex-shrink-0" />
      <div className="max-w-[85%]">
        <div className="text-2xs text-text-3 font-sans mb-1 font-medium">{agent?.name}</div>
        <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-surface-4 border border-border-subtle">
          <div className="text-sm text-text-1 font-sans whitespace-pre-wrap break-words leading-relaxed">
            <FormattedText text={msg.text} />
          </div>
        </div>
        <div className="text-2xs text-text-4 font-sans mt-1">{timeAgo(msg.timestamp)}</div>
      </div>
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

function TypingIndicator({ name }) {
  return (
    <div className="flex gap-2.5">
      <div className="w-6 h-6" />
      <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-surface-4 border border-border-subtle">
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-text-3 animate-pulse" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-text-3 animate-pulse" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-text-3 animate-pulse" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

export function AgentChat({ agent }) {
  const chatHistory = useGrooveStore((s) => s.chatHistory[agent.id]) || EMPTY;
  const activityLog = useGrooveStore((s) => s.activityLog[agent.id]) || EMPTY;
  const instructAgent = useGrooveStore((s) => s.instructAgent);
  const isThinking = useGrooveStore((s) => s.thinkingAgents?.has(agent.id));

  const storeInput = useGrooveStore((s) => s.chatInputs[agent.id] || '');
  const setStoreInput = (val) => useGrooveStore.setState((s) => ({ chatInputs: { ...s.chatInputs, [agent.id]: val } }));
  const input = storeInput;
  const setInput = setStoreInput;
  const [sending, setSending] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory.length, activityLog.length]);

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
    if (!text || sending) return;
    setInput('');
    setAttachedFiles([]);
    setSending(true);
    try {
      await instructAgent(agent.id, text);
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
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
      <div className="border-t border-border-subtle px-4 py-3 bg-surface-1">
        {/* Mode indicator */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xs font-semibold font-sans px-2 py-0.5 rounded-full bg-accent/12 text-accent">
            {isAlive ? 'Instruct' : 'Continue'}
          </span>
          <span className="text-2xs text-text-4 font-sans">
            {isAlive ? 'Message goes directly to this agent' : 'Resumes with full context'}
          </span>
        </div>

        <div className="flex items-end gap-2">
          {/* File import */}
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
            className="w-10 h-10 flex items-center justify-center rounded-xl text-text-4 hover:text-text-1 hover:bg-surface-3 transition-colors cursor-pointer"
            title="Attach file"
          >
            <Paperclip size={16} />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={isAlive ? 'Instruct this agent...' : 'Continue conversation...'}
            rows={1}
            className={cn(
              'flex-1 resize-y rounded-xl px-4 py-2.5 text-sm',
              'bg-surface-0 border text-text-0 font-sans',
              'placeholder:text-text-4',
              'focus:outline-none focus:ring-1',
              'min-h-[40px]',
              'border-border focus:ring-accent/40',
            )}
          />
          {isAlive && (
            <button
              onClick={() => useGrooveStore.getState().stopAgent(agent.id)}
              title="Stop agent"
              className="w-10 h-10 flex items-center justify-center rounded-xl transition-all cursor-pointer bg-danger/80 text-white hover:bg-danger shadow-lg shadow-danger/20"
            >
              <Square size={14} fill="currentColor" />
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className={cn(
              'w-10 h-10 flex items-center justify-center rounded-xl transition-all cursor-pointer',
              'disabled:opacity-20 disabled:cursor-not-allowed',
              input.trim()
                ? 'bg-accent text-surface-0 hover:bg-accent/90 shadow-lg shadow-accent/20'
                : 'bg-surface-4 text-text-4',
            )}
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
