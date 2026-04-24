// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Square, Paperclip, Image as ImageIcon } from 'lucide-react';
import { cn } from '../../lib/cn';
import { formatModelName } from './model-picker';

export function ChatInput({ onSend, onStop, sending, streaming, disabled, isImageModel, currentModel, replyContext, onClearReply }) {
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

  const placeholder = disabled
    ? 'Select a model to start chatting...'
    : isImageModel
      ? 'Describe the image you want to generate...'
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

      {currentModel && (
        <div className="flex items-center gap-2 mb-2">
          <div className={cn(
            'flex items-center gap-1 h-6 px-2 rounded-md text-2xs font-mono border',
            isImageModel
              ? 'bg-purple/8 border-purple/20 text-purple'
              : 'bg-surface-3 border-border-subtle text-text-3',
          )}>
            {isImageModel && <ImageIcon size={9} />}
            <span className="max-w-[80px] truncate">{formatModelName(currentModel)}</span>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
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
          className="w-10 h-10 flex items-center justify-center rounded-xl text-text-4 hover:text-text-1 hover:bg-surface-3 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
          title="Attach file"
        >
          <Paperclip size={16} />
        </button>

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className={cn(
            'flex-1 resize-y rounded-xl px-4 py-2.5 text-sm',
            'bg-surface-0 border text-text-0 font-sans',
            'placeholder:text-text-4',
            'focus:outline-none focus:ring-1',
            'min-h-[40px]',
            'border-border focus:ring-accent/40',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        />

        {isActive ? (
          <button
            onClick={onStop}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-danger/80 text-white hover:bg-danger transition-all cursor-pointer shadow-lg shadow-danger/20 flex-shrink-0"
            title="Stop generation"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!canSend}
            className={cn(
              'w-10 h-10 flex items-center justify-center rounded-xl transition-all cursor-pointer flex-shrink-0',
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
