// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Square, Paperclip, Image as ImageIcon, Zap, Bot } from 'lucide-react';
import { cn } from '../../lib/cn';
import { formatModelName } from './model-picker';

const EFFORT_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
];

const VERBOSITY_OPTIONS = [
  { value: 'low', label: 'Concise' },
  { value: 'medium', label: 'Normal' },
];

export function ChatInput({ onSend, onStop, sending, streaming, disabled, isImageModel, currentModel, replyContext, onClearReply, role, isCodex, reasoningEffort, onReasoningEffortChange, verbosity, onVerbosityChange, mode, onModeChange }) {
  const [input, setInput] = useState('');
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 400) + 'px';
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [input, adjustHeight]);

  useEffect(() => {
    if (!disabled && textareaRef.current) textareaRef.current.focus();
  }, [disabled]);

  function handleSend() {
    const text = input.trim();
    if (!text || sending || disabled) return;
    onSend(text);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const pathList = files.map((f) => f.name).join(', ');
    setInput((prev) => prev + (prev ? '\n' : '') + `[Attached: ${pathList}]`);
    e.target.value = '';
  }

  const isActive = streaming || sending;
  const canSend = input.trim() && !sending && !disabled;
  const currentMode = mode || 'api';

  const placeholder = disabled
    ? 'Select a model to start chatting...'
    : isImageModel
      ? 'Describe the image you want to generate...'
      : role
        ? `Ask your ${role}...`
        : 'Send a message...';

  return (
    <div className="border-t border-border-subtle px-4 py-3 bg-surface-1">
      {replyContext && (
        <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg bg-accent/5 border border-accent/15">
          <ImageIcon size={12} className="text-accent flex-shrink-0" />
          <span className="flex-1 text-2xs text-text-2 font-sans truncate">Iterating: &quot;{replyContext.prompt}&quot;</span>
          <button onClick={onClearReply} className="text-text-4 hover:text-text-1 cursor-pointer flex-shrink-0">
            <Square size={10} />
          </button>
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className={cn(
          'w-full resize-y rounded-xl px-4 py-2.5 text-sm',
          'bg-surface-0 border text-text-0 font-sans',
          'placeholder:text-text-4',
          'focus:outline-none focus:ring-1',
          'min-h-[40px]',
          'border-border focus:ring-accent/40',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      />

      <div className="flex items-center gap-2 mt-2">
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
          disabled={disabled}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-text-4 hover:text-text-1 hover:bg-surface-3 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
          title="Attach file"
        >
          <Paperclip size={14} />
        </button>

        <div className="flex items-center h-7 rounded-lg bg-surface-3 border border-border-subtle p-0.5">
          <button
            onClick={() => onModeChange?.('api')}
            className={cn(
              'flex items-center gap-1 h-6 px-2 rounded-md text-2xs font-semibold font-sans transition-colors cursor-pointer',
              currentMode === 'api' ? 'bg-accent/15 text-accent border border-accent/25' : 'text-text-3 hover:text-text-1',
            )}
            title="Lightweight — fast and cheap, no tools"
          >
            <Zap size={11} /> Chat
          </button>
          <button
            onClick={() => onModeChange?.('agent')}
            className={cn(
              'flex items-center gap-1 h-6 px-2 rounded-md text-2xs font-semibold font-sans transition-colors cursor-pointer',
              currentMode === 'agent' ? 'bg-purple/15 text-purple border border-purple/25' : 'text-text-3 hover:text-text-1',
            )}
            title="Full agent — tools, files, session resume"
          >
            <Bot size={11} /> Agent
          </button>
        </div>

        {currentModel && (
          <div className={cn(
            'flex items-center gap-1 h-6 px-2 rounded-md text-2xs font-mono border',
            isImageModel
              ? 'bg-purple/8 border-purple/20 text-purple'
              : 'bg-surface-3 border-border-subtle text-text-3',
          )}>
            {isImageModel && <ImageIcon size={9} />}
            <span className="max-w-[80px] truncate">{formatModelName(currentModel)}</span>
          </div>
        )}

        {isCodex && (
          <>
            <div className="flex items-center h-6 rounded-md bg-surface-3 border border-border-subtle p-0.5">
              {EFFORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onReasoningEffortChange?.(opt.value)}
                  className={cn(
                    'h-5 px-1.5 rounded text-2xs font-semibold font-sans transition-colors cursor-pointer',
                    reasoningEffort === opt.value
                      ? 'bg-accent/15 text-accent'
                      : 'text-text-4 hover:text-text-1',
                  )}
                  title={`Reasoning: ${opt.label}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center h-6 rounded-md bg-surface-3 border border-border-subtle p-0.5">
              {VERBOSITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onVerbosityChange?.(opt.value)}
                  className={cn(
                    'h-5 px-1.5 rounded text-2xs font-semibold font-sans transition-colors cursor-pointer',
                    verbosity === opt.value
                      ? 'bg-accent/15 text-accent'
                      : 'text-text-4 hover:text-text-1',
                  )}
                  title={`Verbosity: ${opt.label}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="flex-1" />

        {isActive ? (
          <button
            onClick={onStop}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-danger/80 text-white hover:bg-danger transition-all cursor-pointer shadow-lg shadow-danger/20 flex-shrink-0"
            title="Stop generation"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!canSend}
            className={cn(
              'w-8 h-8 flex items-center justify-center rounded-lg transition-all cursor-pointer flex-shrink-0',
              'disabled:opacity-20 disabled:cursor-not-allowed',
              canSend
                ? 'bg-accent/15 text-accent hover:bg-accent/25 border border-accent/25'
                : 'bg-surface-4 text-text-4',
            )}
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        )}
      </div>
    </div>
  );
}
