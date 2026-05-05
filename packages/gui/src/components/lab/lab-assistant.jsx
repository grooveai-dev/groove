// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect, useCallback } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/cn';
import { Send, X, Bot, ArrowRight, Loader2 } from 'lucide-react';

function AssistantMessage({ msg }) {
  return (
    <div>
      <div className="text-2xs text-text-3 font-sans mb-0.5 font-medium flex items-center gap-1">
        <Bot size={10} /> Lab Assistant
      </div>
      <div className={cn(
        'border-l-2 pl-3 py-0.5',
        msg.error ? 'border-danger/40' : 'border-accent/40',
      )}>
        <div className={cn(
          'text-xs font-sans whitespace-pre-wrap break-words leading-relaxed',
          msg.error ? 'text-danger' : 'text-text-1',
        )}>
          {msg.content}
        </div>
      </div>
    </div>
  );
}

function UserMessage({ msg }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%]">
        <div className="px-3 py-2 rounded-xl rounded-br-sm bg-accent/10 border border-accent/15">
          <p className="text-xs text-text-0 font-sans whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
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
  }, [messages.length, messages[messages.length - 1]?.content]);

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
    <div className="h-full flex flex-col bg-surface-0 rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle bg-surface-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold font-sans text-text-1">Lab Assistant</span>
          {backend && (
            <Badge variant="accent" className="text-2xs">{backend}</Badge>
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
          className="p-1 rounded text-text-4 hover:text-text-1 hover:bg-surface-5/50 transition-colors cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollRef} className="flex-1 min-h-0">
        <div className="px-4 py-4 space-y-4">
          {messages.length === 0 && !isThinking ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Bot size={32} className="text-text-4 mb-3" />
              <p className="text-sm text-text-2 font-sans font-medium">Setting up {backend}</p>
              <p className="text-xs text-text-3 font-sans mt-1">The assistant is starting up...</p>
            </div>
          ) : (
            messages.map((msg, i) =>
              msg.role === 'user' ? (
                <UserMessage key={i} msg={msg} />
              ) : (
                <AssistantMessage key={i} msg={msg} />
              ),
            )
          )}

          {/* Thinking indicator */}
          {isThinking && (
            <div>
              <div className="text-2xs text-text-3 font-sans mb-0.5 font-medium flex items-center gap-1">
                <Bot size={10} /> Lab Assistant
              </div>
              <div className="border-l-2 border-accent/40 pl-3 py-0.5">
                <div className="flex items-center gap-1 py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-3 animate-pulse" />
                  <span className="w-1.5 h-1.5 rounded-full bg-text-3 animate-pulse" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-text-3 animate-pulse" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Completion banner */}
      {isComplete && messages.length > 0 && (
        <div className="flex-shrink-0 px-3 py-2 border-t border-border-subtle bg-success/5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-sans text-success font-medium">Setup complete</span>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setLabAssistantMode(false)}
            >
              <ArrowRight size={12} className="mr-1" /> Switch to Playground
            </Button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="flex-shrink-0 px-3 py-3 border-t border-border-subtle bg-surface-1">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRunning ? 'Type a message...' : 'Assistant is not running'}
            disabled={!isRunning}
            rows={1}
            className={cn(
              'flex-1 resize-none bg-surface-0 border border-border rounded-lg px-3 py-2',
              'text-xs text-text-0 font-sans placeholder:text-text-4',
              'focus:outline-none focus:ring-1 focus:ring-accent',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              'min-h-[36px] max-h-32',
            )}
            style={{ height: 'auto', overflowY: input.split('\n').length > 4 ? 'auto' : 'hidden' }}
            onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`; }}
          />
          <Button
            variant="primary"
            size="icon"
            className="flex-shrink-0"
            disabled={!input.trim() || !isRunning}
            onClick={handleSend}
          >
            <Send size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
