// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect, useCallback } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/cn';
import { Send, X, ArrowRight, ChevronDown, AlertCircle, FlaskConical } from 'lucide-react';

// ── Inline formatting (bold, code) ──────────────────────────
function InlineFormat({ text }) {
  if (!text) return null;
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="font-semibold text-text-0">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="px-1 py-px rounded bg-accent/8 text-[11px] font-mono text-accent">{part.slice(1, -1)}</code>;
    return <span key={i}>{part}</span>;
  });
}

// ── Structured message renderer ─────────────────────────────
function StructuredMessage({ text }) {
  if (!text) return null;

  const blocks = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trimStart().startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: 'code', content: codeLines.join('\n') });
      continue;
    }

    if (/^#{1,3}\s/.test(line) || /^\*\*[^*]+:\*\*\s*$/.test(line.trim())) {
      const heading = line.replace(/^#+\s*/, '').replace(/^\*\*/, '').replace(/:\*\*\s*$/, ':').trim();
      blocks.push({ type: 'heading', content: heading });
      i++;
      continue;
    }

    if (/^\s*[-*]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, '').trim());
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    if (/^\s*\d+[\.)]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[\.)]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[\.)]\s+/, '').trim());
        i++;
      }
      blocks.push({ type: 'numbered', items });
      continue;
    }

    if (!line.trim()) { i++; continue; }

    if (/^(Note|Warning|Important|IMPORTANT|TODO):/i.test(line.trim())) {
      blocks.push({ type: 'note', content: line.trim() });
      i++;
      continue;
    }

    const paraLines = [];
    while (i < lines.length && lines[i].trim() && !/^#{1,3}\s/.test(lines[i]) && !/^\s*[-*]\s/.test(lines[i]) && !/^\s*\d+[\.)]\s/.test(lines[i]) && !lines[i].trimStart().startsWith('```')) {
      paraLines.push(lines[i].trim());
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'para', content: paraLines.join(' ') });
    }
  }

  return (
    <div className="space-y-2">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'heading':
            return (
              <div key={idx} className="flex items-center gap-1.5 pt-1.5 first:pt-0">
                <div className="w-1 h-3.5 rounded-full bg-accent/40 flex-shrink-0" />
                <span className="text-[13px] font-semibold text-text-0 font-sans"><InlineFormat text={block.content} /></span>
              </div>
            );
          case 'list':
            return (
              <div key={idx} className="space-y-1 pl-2">
                {block.items.map((item, j) => (
                  <div key={j} className="flex gap-2 text-[13px] text-text-1 font-sans leading-relaxed">
                    <span className="text-accent/50 mt-0.5 flex-shrink-0">-</span>
                    <span className="min-w-0"><InlineFormat text={item} /></span>
                  </div>
                ))}
              </div>
            );
          case 'numbered':
            return (
              <div key={idx} className="space-y-1 pl-2">
                {block.items.map((item, j) => (
                  <div key={j} className="flex gap-2 text-[13px] text-text-1 font-sans leading-relaxed">
                    <span className="text-text-4 font-mono w-4 text-right flex-shrink-0">{j + 1}.</span>
                    <span className="min-w-0"><InlineFormat text={item} /></span>
                  </div>
                ))}
              </div>
            );
          case 'code':
            return (
              <pre key={idx} className="p-2.5 rounded-md bg-[#0d1117] text-[11px] font-mono text-[#c9d1d9] overflow-x-auto whitespace-pre-wrap border border-white/[0.06] leading-relaxed">
                {block.content}
              </pre>
            );
          case 'note':
            return (
              <div key={idx} className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-md bg-warning/6 border border-warning/12">
                <AlertCircle size={10} className="text-warning mt-0.5 flex-shrink-0" />
                <span className="text-[12px] text-warning/80 font-sans"><InlineFormat text={block.content} /></span>
              </div>
            );
          case 'para':
          default:
            return <p key={idx} className="text-[13px] text-text-1 font-sans leading-relaxed"><InlineFormat text={block.content} /></p>;
        }
      })}
    </div>
  );
}

// ── Thinking indicator ──────────────────────────────────────
const THINKING_MESSAGES = [
  'Checking your system...',
  'Running setup commands...',
  'Working through installation...',
  'Configuring the server...',
  'Making progress...',
  'Almost there...',
];

function LabThinkingIndicator() {
  const [idx, setIdx] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const t = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % THINKING_MESSAGES.length);
        setFade(true);
      }, 250);
    }, 2800);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-2xs font-semibold text-text-1 font-sans">Lab Assistant</span>
        <span className="text-2xs text-accent font-mono">working</span>
      </div>
      <div className="border-l border-accent/40 pl-3.5 py-1 flex items-center gap-2.5">
        <div className="relative w-3.5 h-3.5 flex-shrink-0">
          <span className="absolute inset-0 rounded-full border border-transparent border-t-accent animate-spin" style={{ animationDuration: '0.9s' }} />
        </div>
        <span
          className="text-[13px] font-sans text-text-3 transition-opacity duration-[250ms]"
          style={{ opacity: fade ? 1 : 0 }}
        >
          {THINKING_MESSAGES[idx]}
        </span>
      </div>
    </div>
  );
}

// ── Message components ──────────────────────────────────────
function AssistantMessage({ msg }) {
  const [collapsed, setCollapsed] = useState(msg.text?.length > 800);
  const isLong = msg.text?.length > 800;

  return (
    <div className="animate-chat-fade-in">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-2xs font-semibold text-text-1 font-sans">Lab Assistant</span>
      </div>
      <div className="border-l border-accent pl-3.5 py-1">
        <StructuredMessage text={collapsed ? msg.text.slice(0, 800) + '...' : msg.text} />
      </div>
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="ml-3.5 mt-1.5 flex items-center gap-1.5 text-[11px] text-accent/70 hover:text-accent font-sans font-medium cursor-pointer transition-colors"
        >
          <ChevronDown size={11} />
          Show full response
        </button>
      )}
      {isLong && !collapsed && (
        <button
          onClick={() => setCollapsed(true)}
          className="ml-3.5 mt-1.5 flex items-center gap-1.5 text-[11px] text-accent/70 hover:text-accent font-sans font-medium cursor-pointer transition-colors"
        >
          <ChevronDown size={11} className="rotate-180" />
          Collapse
        </button>
      )}
    </div>
  );
}

function UserMessage({ msg }) {
  return (
    <div className="flex justify-end pl-8 animate-chat-fade-in">
      <div className="max-w-[90%]">
        <div className="px-3.5 py-2.5 rounded-lg border bg-info/10 border-info/25">
          <p className="text-[13px] text-text-0 font-sans whitespace-pre-wrap break-words leading-relaxed">{msg.text}</p>
        </div>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────
export function LabAssistant() {
  const agentId = useGrooveStore((s) => s.labAssistantAgentId);
  const backend = useGrooveStore((s) => s.labAssistantBackend);
  const chatHistory = useGrooveStore((s) => s.chatHistory);
  const agents = useGrooveStore((s) => s.agents);
  const thinkingAgents = useGrooveStore((s) => s.thinkingAgents);
  const instructAgent = useGrooveStore((s) => s.instructAgent);
  const dismissLabAssistant = useGrooveStore((s) => s.dismissLabAssistant);
  const setLabAssistantMode = useGrooveStore((s) => s.setLabAssistantMode);
  const onLabAssistantComplete = useGrooveStore((s) => s.onLabAssistantComplete);
  const fetchLabRuntimes = useGrooveStore((s) => s.fetchLabRuntimes);
  const activeRuntime = useGrooveStore((s) => s.labActiveRuntime);
  const activeModel = useGrooveStore((s) => s.labActiveModel);

  const [input, setInput] = useState('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const completionHandled = useRef(false);

  const agent = agents.find((a) => a.id === agentId);
  const messages = chatHistory[agentId] || [];
  const isThinking = thinkingAgents?.has?.(agentId);
  const isRunning = agent?.status === 'running';
  const isComplete = agent && agent.status !== 'running';

  useEffect(() => {
    if (isComplete && !completionHandled.current) {
      completionHandled.current = true;
      onLabAssistantComplete();
    }
    if (isRunning) completionHandled.current = false;
  }, [isComplete, isRunning, onLabAssistantComplete]);

  useEffect(() => {
    if (!isRunning || activeRuntime) return;
    const interval = setInterval(fetchLabRuntimes, 5000);
    return () => clearInterval(interval);
  }, [isRunning, activeRuntime, fetchLabRuntimes]);

  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, messages[messages.length - 1]?.text, isThinking]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !agentId) return;
    setInput('');
    instructAgent(agentId, text);
  }, [input, agentId, instructAgent]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!agentId) return null;

  return (
    <div className="h-full flex flex-col">
      {/* Streaming status bar */}
      {isRunning && (
        <div className="flex-shrink-0 flex items-center gap-3 px-4 h-8 border-b border-border-subtle bg-surface-1/80">
          <div className="relative flex items-center justify-center w-4 h-4">
            <span className="absolute inset-0 rounded-full bg-accent/15 animate-ping [animation-duration:2s]" />
            <span className="relative w-1.5 h-1.5 rounded-full bg-accent" />
          </div>
          <span className="text-2xs font-sans text-text-2">
            Lab Assistant {backend === 'lab-general' ? 'is active' : <>is setting up <span className="font-medium text-text-1">{backend?.toUpperCase()}</span></>}
          </span>
          <div className="flex-1" />
          <Badge variant="success" className="text-2xs">running</Badge>
        </div>
      )}

      {/* Messages */}
      <ScrollArea ref={scrollRef} className="flex-1 min-h-0">
        <div className="px-5 py-4 space-y-6">
          {messages.length === 0 && !isThinking ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center mb-3">
                <FlaskConical size={22} className="text-accent" />
              </div>
              <p className="text-sm text-text-1 font-sans font-medium">
                {backend === 'lab-general' ? 'Lab Assistant' : `Setting up ${backend?.toUpperCase()}`}
              </p>
              <p className="text-[13px] text-text-3 font-sans mt-1.5">
                {backend === 'lab-general'
                  ? 'Ask about runtime setup, model configs, context windows, prompts, or anything else...'
                  : 'The assistant is starting up and will begin configuring your runtime...'}
              </p>
            </div>
          ) : (
            messages.map((msg, i) =>
              msg.from === 'user' ? (
                <UserMessage key={i} msg={msg} />
              ) : (
                <AssistantMessage key={i} msg={msg} />
              ),
            )
          )}

          {isThinking && <LabThinkingIndicator />}
        </div>
      </ScrollArea>

      {/* Completion banner */}
      {isComplete && messages.length > 0 && (
        <div className={cn(
          'flex-shrink-0 px-4 py-3 border-t',
          activeRuntime && activeModel
            ? 'bg-success/10 border-success/20'
            : activeRuntime
              ? 'bg-warning/10 border-warning/20'
              : 'bg-surface-2 border-border',
        )}>
          {activeRuntime && activeModel ? (
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[13px] font-sans text-success font-semibold">Runtime ready</span>
                <p className="text-xs text-text-2 font-sans mt-0.5">Your model is loaded and ready to chat</p>
              </div>
              <button
                onClick={() => setLabAssistantMode(false)}
                className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-sans font-medium text-surface-0 bg-accent hover:bg-accent/90 rounded-md transition-colors cursor-pointer"
              >
                <ArrowRight size={14} /> Open Playground
              </button>
            </div>
          ) : activeRuntime ? (
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[13px] font-sans text-warning font-semibold">Runtime registered</span>
                <p className="text-xs text-text-2 font-sans mt-0.5">Model may still be loading — test the runtime in the sidebar</p>
              </div>
              <button
                onClick={() => setLabAssistantMode(false)}
                className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-sans font-medium text-text-0 bg-surface-3 hover:bg-surface-4 rounded-md transition-colors cursor-pointer"
              >
                <ArrowRight size={14} /> View Playground
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[13px] font-sans text-text-1 font-semibold">Setup finished</span>
                <p className="text-xs text-text-2 font-sans mt-0.5">
                  If the model is still downloading, the runtime will appear once the server starts.
                </p>
              </div>
              <button
                onClick={fetchLabRuntimes}
                className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-sans font-medium text-text-0 bg-surface-3 hover:bg-surface-4 rounded-md transition-colors cursor-pointer"
              >
                Check Runtimes
              </button>
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <div className="flex-shrink-0 px-4 py-3">
        <div className="flex items-end gap-2 border rounded-xl bg-surface-0 p-1.5 transition-colors border-border-subtle focus-within:border-accent/30">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRunning ? 'Ask the assistant anything...' : 'Send a message to continue...'}
            rows={1}
            className={cn(
              'flex-1 resize-none bg-transparent px-2.5 py-1.5',
              'text-[13px] text-text-0 font-sans placeholder:text-text-4',
              'focus:outline-none',
              'min-h-[32px] max-h-32',
            )}
            style={{ height: 'auto', overflowY: input.split('\n').length > 4 ? 'auto' : 'hidden' }}
            onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`; }}
          />
          <button
            disabled={!input.trim()}
            onClick={handleSend}
            className={cn(
              'flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-all cursor-pointer',
              'disabled:opacity-15 disabled:cursor-not-allowed',
              input.trim()
                ? 'bg-accent/15 text-accent hover:bg-accent/25 border border-accent/25'
                : 'bg-transparent text-text-4',
            )}
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
