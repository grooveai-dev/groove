// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Square, Paperclip } from 'lucide-react';
import { cn } from '../../lib/cn';

export function ChatInput({ onSend, onStop, sending, streaming, disabled }) {
  const [input, setInput] = useState('');
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
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

  return (
    <div className="px-4 py-3">
      <div className="flex items-end gap-2 rounded-2xl bg-surface-3/60 border border-border-subtle px-3 py-2 focus-within:border-accent/30 transition-colors">
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
          className="w-8 h-8 flex items-center justify-center rounded-lg text-text-4 hover:text-text-1 hover:bg-surface-4 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
          title="Attach file"
        >
          <Paperclip size={15} />
        </button>

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={disabled ? 'Select a model to start chatting...' : 'Send a message...'}
          disabled={disabled}
          rows={1}
          style={{ minHeight: '36px' }}
          className="flex-1 resize-none bg-transparent text-sm text-text-0 font-sans placeholder:text-text-4 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed py-1.5"
        />

        {isActive ? (
          <button
            onClick={onStop}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-danger/80 text-white hover:bg-danger transition-all cursor-pointer shadow-lg shadow-danger/20 flex-shrink-0"
            title="Stop generation"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!canSend}
            className={cn(
              'w-8 h-8 flex items-center justify-center rounded-xl transition-all cursor-pointer flex-shrink-0',
              'disabled:opacity-20 disabled:cursor-not-allowed',
              canSend
                ? 'bg-accent/15 text-accent hover:bg-accent/25 border border-accent/25'
                : 'bg-surface-4 text-text-4',
            )}
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}
