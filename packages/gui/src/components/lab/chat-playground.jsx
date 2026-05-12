// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect, useCallback } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/tooltip';
import { cn } from '../../lib/cn';
import { SendHorizontal, Plus, ChevronDown, Clock, Zap, Bot } from 'lucide-react';

function MessageMetrics({ metrics }) {
  if (!metrics) return null;
  return (
    <div className="flex items-center gap-3 mt-1 ml-5">
      {metrics.ttft != null && (
        <Tooltip content="Time to first token">
          <span className="text-2xs font-mono text-text-4 flex items-center gap-1">
            <Clock size={9} /> {Math.round(metrics.ttft)}ms
          </span>
        </Tooltip>
      )}
      {metrics.tokensPerSec != null && (
        <Tooltip content="Tokens per second">
          <span className="text-2xs font-mono text-text-4 flex items-center gap-1">
            <Zap size={9} /> {metrics.tokensPerSec.toFixed(1)} t/s
          </span>
        </Tooltip>
      )}
      {metrics.tokens != null && (
        <span className="text-2xs font-mono text-text-4">{metrics.tokens} tokens</span>
      )}
      {metrics.generationTime != null && (
        <span className="text-2xs font-mono text-text-4">{(metrics.generationTime / 1000).toFixed(1)}s</span>
      )}
    </div>
  );
}

function UserMessage({ msg }) {
  return (
    <div className="flex justify-end animate-chat-fade-in">
      <div className="max-w-[80%]">
        <div className="px-3.5 py-2 bg-accent/8 rounded rounded-br-none">
          <p className="text-xs text-text-0 font-sans whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({ msg, streaming }) {
  const isStreaming = streaming && !msg.content && !msg.reasoning && !msg.error;
  const isReasoning = streaming && msg.reasoning && !msg.content;
  return (
    <div className="animate-chat-fade-in">
      <div className="flex items-center gap-1.5 mb-1">
        <div className="w-4 h-4 rounded-sm bg-surface-4 flex items-center justify-center">
          <Bot size={10} className="text-text-3" />
        </div>
        <span className="text-2xs text-text-3 font-sans font-medium">Assistant</span>
      </div>
      {msg.reasoning && (
        <div className="ml-5 mb-1.5 pl-3 border-l border-text-4/20 py-1">
          <div className="text-2xs font-sans text-text-4 italic whitespace-pre-wrap break-words leading-relaxed">
            {msg.reasoning}
            {isReasoning && <span className="inline-block w-1 h-3 bg-text-4/40 ml-0.5 animate-pulse" />}
          </div>
        </div>
      )}
      <div className="ml-5">
        {msg.content ? (
          <div className={cn(
            'text-xs font-sans whitespace-pre-wrap break-words leading-relaxed',
            msg.error ? 'text-danger' : 'text-text-1',
          )}>
            {msg.content}
            {streaming && !msg.error && <span className="inline-block w-1.5 h-3.5 bg-accent/60 ml-0.5 animate-pulse" />}
          </div>
        ) : isStreaming ? (
          <div className="flex items-center gap-1.5 py-1">
            <span className="w-1 h-1 rounded-full bg-text-4 animate-pulse" />
            <span className="w-1 h-1 rounded-full bg-text-4 animate-pulse" style={{ animationDelay: '150ms' }} />
            <span className="w-1 h-1 rounded-full bg-text-4 animate-pulse" style={{ animationDelay: '300ms' }} />
          </div>
        ) : null}
      </div>
      <MessageMetrics metrics={msg.metrics} />
    </div>
  );
}

function SessionSelector({ sessions, activeSession, onSelect, onNew }) {
  const [open, setOpen] = useState(false);
  const current = sessions.find((s) => s.id === activeSession);
  const label = current ? `Session ${sessions.indexOf(current) + 1}` : 'No session';

  if (sessions.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 text-2xs font-sans text-text-3 hover:text-text-1 transition-colors cursor-pointer"
      >
        {label} <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 min-w-40 bg-surface-2 border border-border rounded py-1 shadow-xl">
          {sessions.map((sess, i) => (
            <button
              key={sess.id}
              onClick={() => { onSelect(sess.id); setOpen(false); }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-xs font-sans cursor-pointer transition-colors',
                sess.id === activeSession ? 'text-accent bg-accent/8' : 'text-text-2 hover:bg-surface-4 hover:text-text-0',
              )}
            >
              Session {i + 1}
              <span className="text-2xs text-text-4 ml-2">{sess.messages.length} msgs</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatPlayground() {
  const sessions = useGrooveStore((s) => s.labSessions);
  const activeSession = useGrooveStore((s) => s.labActiveSession);
  const streaming = useGrooveStore((s) => s.labStreaming);
  const sendMessage = useGrooveStore((s) => s.sendLabMessage);
  const newSession = useGrooveStore((s) => s.newLabSession);
  const loadSession = useGrooveStore((s) => s.loadLabSession);
  const activeRuntime = useGrooveStore((s) => s.labActiveRuntime);
  const activeModel = useGrooveStore((s) => s.labActiveModel);

  const [input, setInput] = useState('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const currentSession = sessions.find((s) => s.id === activeSession);
  const messages = currentSession?.messages || [];

  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, messages[messages.length - 1]?.content]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    sendMessage(text);
  }, [input, streaming, sendMessage]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const canSend = input.trim() && activeRuntime && activeModel && !streaming;

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 pb-2">
        <div className="flex items-center gap-1">
          <SessionSelector
            sessions={sessions}
            activeSession={activeSession}
            onSelect={loadSession}
            onNew={newSession}
          />
        </div>
        <Tooltip content="New session">
          <button
            onClick={newSession}
            className="flex items-center gap-1 px-2 py-1 text-2xs font-sans text-text-3 hover:text-text-1 transition-colors cursor-pointer"
          >
            <Plus size={11} /> New
          </button>
        </Tooltip>
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollRef} className="flex-1 min-h-0">
        <div className="px-4 py-3 space-y-5">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-10 h-10 rounded bg-surface-2 flex items-center justify-center mb-3">
                <Bot size={20} className="text-text-4" />
              </div>
              <p className="text-sm text-text-2 font-sans font-medium">Start a conversation</p>
              <p className="text-xs text-text-4 font-sans mt-1">
                {!activeRuntime ? 'Select a runtime to get started' : !activeModel ? 'Select a model to get started' : 'Send a message to test your model'}
              </p>
            </div>
          ) : (
            messages.map((msg, i) =>
              msg.role === 'user' ? (
                <UserMessage key={i} msg={msg} />
              ) : (
                <AssistantMessage
                  key={i}
                  msg={msg}
                  streaming={streaming && i === messages.length - 1}
                />
              ),
            )
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="flex-shrink-0 px-4 py-3">
        <div className="flex flex-col rounded-lg border border-border-subtle bg-surface-0 transition-colors overflow-hidden focus-within:border-text-4/40">
          <div className="px-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={!activeRuntime ? 'Select a runtime first' : !activeModel ? 'Select a model first' : 'Type a message...'}
              disabled={!activeRuntime || !activeModel}
              rows={1}
              className={cn(
                'w-full resize-none px-3 py-2.5 text-[13px]',
                'bg-transparent font-sans text-text-0',
                'placeholder:text-text-4',
                'focus:outline-none',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}
              style={{ height: 88 }}
            />
          </div>
          <div className="flex items-center gap-1 px-1.5 pb-1.5 pt-0.5">
            <div className="flex-1" />
            {streaming && (
              <button
                onClick={() => useGrooveStore.getState().stopLabInference()}
                title="Stop generation"
                className="group w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer"
              >
                <span className="relative flex items-center justify-center w-3.5 h-3.5">
                  <span className="absolute inset-0 rounded-full bg-accent/30 group-hover:bg-red-500/30 animate-ping [animation-duration:2s] transition-colors" />
                  <span className="relative w-2.5 h-2.5 rounded-full bg-accent group-hover:bg-red-500 transition-colors" />
                </span>
              </button>
            )}
            <button
              disabled={!canSend}
              onClick={handleSend}
              className={cn(
                'w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer',
                'disabled:opacity-15 disabled:cursor-not-allowed',
                canSend ? 'text-text-0 hover:text-text-1' : 'text-text-4',
              )}
            >
              <SendHorizontal size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
