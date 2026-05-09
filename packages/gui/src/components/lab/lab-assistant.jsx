// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect, useCallback } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/cn';
import { Send, X, Bot, ArrowRight } from 'lucide-react';

function AssistantMessage({ msg }) {
  return (
    <div className="animate-chat-fade-in">
      <div className="flex items-center gap-1.5 mb-1">
        <div className="w-4 h-4 rounded-sm bg-surface-4 flex items-center justify-center">
          <Bot size={10} className="text-text-3" />
        </div>
        <span className="text-2xs text-text-3 font-sans font-medium">Lab Assistant</span>
      </div>
      <div className="ml-5">
        <div className={cn(
          'text-xs font-sans whitespace-pre-wrap break-words leading-relaxed',
          msg.error ? 'text-danger' : 'text-text-1',
        )}>
          {msg.text}
        </div>
      </div>
    </div>
  );
}

function UserMessage({ msg }) {
  return (
    <div className="flex justify-end animate-chat-fade-in">
      <div className="max-w-[80%]">
        <div className="px-3.5 py-2 bg-accent/8 rounded rounded-br-none">
          <p className="text-xs text-text-0 font-sans whitespace-pre-wrap break-words leading-relaxed">{msg.text}</p>
        </div>
      </div>
    </div>
  );
}

export function LabAssistant() {
  const agentId = useGrooveStore((s) => s.labAssistantAgentId);
  const backend = useGrooveStore((s) => s.labAssistantBackend);
  const chatHistory = useGrooveStore((s) => s.chatHistory);
  const agents = useGrooveStore((s) => s.agents);
  const thinkingAgents = useGrooveStore((s) => s.thinkingAgents);
  const instructAgent = useGrooveStore((s) => s.instructAgent);
  const dismissLabAssistant = useGrooveStore((s) => s.dismissLabAssistant);
  const setLabAssistantMode = useGrooveStore((s) => s.setLabAssistantMode);

  const [input, setInput] = useState('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const agent = agents.find((a) => a.id === agentId);
  const messages = chatHistory[agentId] || [];
  const isThinking = thinkingAgents?.has?.(agentId);
  const isRunning = agent?.status === 'running';
  const isComplete = agent && agent.status !== 'running';

  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, messages[messages.length - 1]?.text]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !agentId || !isRunning) return;
    setInput('');
    instructAgent(agentId, text);
  }, [input, agentId, isRunning, instructAgent]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!agentId) return null;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 pb-2">
        <div className="flex items-center gap-2">
          {backend && (
            <span className="text-2xs font-mono text-text-3">{backend}</span>
          )}
          {agent && (
            <Badge
              variant={isRunning ? 'success' : isComplete ? 'default' : 'warning'}
              className="text-2xs"
            >
              {agent.status}
            </Badge>
          )}
        </div>
        <button
          onClick={dismissLabAssistant}
          className="p-1 text-text-4 hover:text-text-1 transition-colors cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollRef} className="flex-1 min-h-0">
        <div className="px-4 py-3 space-y-5">
          {messages.length === 0 && !isThinking ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-10 h-10 rounded bg-surface-2 flex items-center justify-center mb-3">
                <Bot size={20} className="text-text-4" />
              </div>
              <p className="text-sm text-text-2 font-sans font-medium">Setting up {backend}</p>
              <p className="text-xs text-text-4 font-sans mt-1">The assistant is starting up...</p>
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

          {isThinking && (
            <div className="animate-chat-fade-in">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-4 h-4 rounded-sm bg-surface-4 flex items-center justify-center">
                  <Bot size={10} className="text-text-3" />
                </div>
                <span className="text-2xs text-text-3 font-sans font-medium">Lab Assistant</span>
              </div>
              <div className="ml-5 flex items-center gap-1.5 py-1">
                <span className="w-1 h-1 rounded-full bg-text-4 animate-pulse" />
                <span className="w-1 h-1 rounded-full bg-text-4 animate-pulse" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 rounded-full bg-text-4 animate-pulse" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Completion banner */}
      {isComplete && messages.length > 0 && (
        <div className="flex-shrink-0 px-4 py-2 bg-success/5 border-t border-success/10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-sans text-success font-medium">Setup complete</span>
            <button
              onClick={() => setLabAssistantMode(false)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-sans font-medium text-surface-0 bg-accent hover:bg-accent/90 rounded-sm transition-colors cursor-pointer"
            >
              <ArrowRight size={12} /> Playground
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="flex-shrink-0 px-4 py-3">
        <div className="flex items-end gap-2 bg-surface-1 border border-border-subtle rounded-md p-1.5 focus-within:border-accent/30 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRunning ? 'Type a message...' : 'Assistant is not running'}
            disabled={!isRunning}
            rows={1}
            className={cn(
              'flex-1 resize-none bg-transparent px-2 py-1.5',
              'text-xs text-text-0 font-sans placeholder:text-text-4',
              'focus:outline-none',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              'min-h-[28px] max-h-32',
            )}
            style={{ height: 'auto', overflowY: input.split('\n').length > 4 ? 'auto' : 'hidden' }}
            onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`; }}
          />
          <button
            disabled={!input.trim() || !isRunning}
            onClick={handleSend}
            className={cn(
              'flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-sm transition-colors cursor-pointer',
              input.trim() && isRunning ? 'bg-accent text-surface-0 hover:bg-accent/90' : 'bg-surface-3 text-text-4 cursor-not-allowed',
            )}
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
