// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { ScrollArea } from '../ui/scroll-area';
import { Send, Bot, MessageSquare, X, ArrowRight } from 'lucide-react';
import { timeAgo } from '../../lib/format';

function FormattedText({ text }) {
  if (!text) return null;
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
  return (
    <>
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
            : s
        )}</span>;
      })}
    </>
  );
}

export function AiPanel() {
  const agentId = useGrooveStore((s) => s.editorSelectedAgent);
  const agents = useGrooveStore((s) => s.agents);
  const chatHistory = useGrooveStore((s) => agentId ? (s.chatHistory[agentId] || []) : []);
  const activityLog = useGrooveStore((s) => agentId ? (s.activityLog[agentId] || []) : []);
  const instructAgent = useGrooveStore((s) => s.instructAgent);
  const isThinking = useGrooveStore((s) => agentId ? s.thinkingAgents?.has(agentId) : false);
  const toggleAiPanel = useGrooveStore((s) => s.toggleAiPanel);

  const agent = agents.find((a) => a.id === agentId);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const isAtBottomRef = useRef(true);

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

  async function handleSend() {
    const text = input.trim();
    if (!text || sending || !agentId) return;
    setInput('');
    setSending(true);
    isAtBottomRef.current = true;
    try {
      await instructAgent(agentId, text);
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

  const recentActivity = activityLog.slice(-8).map((a, i) => ({
    from: 'agent', text: a.text, timestamp: a.timestamp, key: `act-${i}`,
  }));
  const messages = chatHistory.length > 0 ? chatHistory : recentActivity;

  return (
    <div className="flex flex-col h-full bg-surface-1 border-l border-border">
      {/* Header */}
      <div className="flex items-center gap-2 h-8 px-3 border-b border-border-subtle flex-shrink-0">
        <Bot size={12} className="text-accent" />
        <span className="text-xs font-sans font-medium text-text-1 flex-1 truncate">
          {agent ? agent.name : 'AI Assistant'}
        </span>
        <button
          onClick={toggleAiPanel}
          className="p-0.5 rounded hover:bg-surface-4 text-text-4 hover:text-text-1 cursor-pointer transition-colors"
        >
          <X size={12} />
        </button>
      </div>

      {/* Messages */}
      {!agentId ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center">
            <Bot size={24} className="mx-auto text-text-4 mb-2" />
            <p className="text-xs text-text-3 font-sans">Select an agent from the toolbar to start chatting</p>
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <MessageSquare size={20} className="text-text-4 mb-2" />
                <p className="text-xs text-text-3 font-sans">Send a message or use AI actions on selected code</p>
              </div>
            )}
            {messages.map((msg, i) => {
              if (msg.from === 'user') {
                return (
                  <div key={msg.key || i} className="flex justify-end">
                    <div className="max-w-[85%]">
                      <div className="px-3 py-2 rounded-xl rounded-br-sm bg-accent/10 border border-accent/15">
                        <p className="text-xs text-text-0 font-sans whitespace-pre-wrap break-words leading-relaxed">
                          <FormattedText text={msg.text} />
                        </p>
                      </div>
                      <div className="text-2xs text-text-4 font-sans mt-0.5 text-right">{timeAgo(msg.timestamp)}</div>
                    </div>
                  </div>
                );
              }
              if (msg.from === 'system') {
                return (
                  <div key={msg.key || i} className="flex justify-center py-1">
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-4/50">
                      <ArrowRight size={10} className="text-text-4" />
                      <span className="text-2xs text-text-3 font-sans">{msg.text}</span>
                    </div>
                  </div>
                );
              }
              return (
                <div key={msg.key || i}>
                  <div className="border-l-2 border-accent/40 pl-3 py-0.5">
                    <div className="text-xs text-text-1 font-sans whitespace-pre-wrap break-words leading-relaxed">
                      <FormattedText text={msg.text} />
                    </div>
                  </div>
                  <div className="text-2xs text-text-4 font-sans mt-0.5">{timeAgo(msg.timestamp)}</div>
                </div>
              );
            })}
            {(sending || isThinking) && (
              <div className="border-l-2 border-accent/40 pl-3 py-2">
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-3 animate-pulse" />
                  <span className="w-1.5 h-1.5 rounded-full bg-text-3 animate-pulse" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-text-3 animate-pulse" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-border-subtle px-3 py-2 flex-shrink-0">
            <div className="flex items-end gap-1.5">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Message agent..."
                rows={1}
                className="flex-1 resize-none rounded-lg px-3 py-1.5 text-xs bg-surface-0 border border-border text-text-0 font-sans placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent/40 min-h-[32px] max-h-[100px]"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className={cn(
                  'w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer flex-shrink-0',
                  input.trim() && !sending
                    ? 'bg-accent text-surface-0 hover:bg-accent/80'
                    : 'bg-surface-3 text-text-4',
                )}
              >
                <Send size={12} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
