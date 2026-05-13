// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect, useCallback } from 'react';
import { SendHorizontal, Loader2, Square, Paperclip, Image as ImageIcon, Zap, Bot, GripHorizontal, ChevronUp } from 'lucide-react';
import { cn } from '../../lib/cn';
import { formatModelName, isImageModel as checkImageModel, getTier, getContextSize, TIER_CONFIG } from './model-picker';
import { useGrooveStore } from '../../stores/groove';
import { Badge } from '../ui/badge';

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

export function ChatInput({ onSend, onStop, sending, streaming, disabled, isImageModel, currentModel, currentProvider, onModelChange, replyContext, onClearReply, role, isCodex, reasoningEffort, onReasoningEffortChange, verbosity, onVerbosityChange, mode, onModeChange, modeChanging }) {
  const [input, setInput] = useState('');
  const [inputHeight, setInputHeight] = useState(88);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const modelPickerRef = useRef(null);

  const [providers, setProviders] = useState([]);
  const fetchProviders = useGrooveStore((s) => s.fetchProviders);

  useEffect(() => {
    fetchProviders().then((data) => {
      if (Array.isArray(data)) setProviders(data);
      else if (data?.providers) setProviders(data.providers);
    }).catch(() => {});
  }, [fetchProviders]);

  useEffect(() => {
    if (!disabled && textareaRef.current) textareaRef.current.focus();
  }, [disabled]);

  useEffect(() => {
    if (!modelPickerOpen) return;
    function handleClick(e) {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target)) setModelPickerOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [modelPickerOpen]);

  function handleSend() {
    const text = input.trim();
    if (!text || sending || disabled) return;
    onSend(text);
    setInput('');
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

  const onDragStart = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = inputHeight;
    const onMove = (ev) => setInputHeight(Math.min(Math.max(56, startH - (ev.clientY - startY)), 400));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [inputHeight]);

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
    <div className="px-4 pb-3">
      <div
        onMouseDown={onDragStart}
        className="flex items-center justify-center h-5 cursor-row-resize group"
      >
        <GripHorizontal size={12} className="text-text-4 group-hover:text-text-2 transition-colors" />
      </div>

      {replyContext && (
        <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg bg-accent/5 border border-accent/15">
          <ImageIcon size={12} className="text-accent flex-shrink-0" />
          <span className="flex-1 text-2xs text-text-2 font-sans truncate">Iterating: &quot;{replyContext.prompt}&quot;</span>
          <button onClick={onClearReply} className="text-text-4 hover:text-text-1 cursor-pointer flex-shrink-0">
            <Square size={10} />
          </button>
        </div>
      )}

      <div className="flex flex-col rounded-lg border border-border-subtle bg-surface-0 transition-colors overflow-hidden focus-within:border-text-4/40">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.gif,.svg,.csv,.txt,.md,.json,.yaml,.yml,.docx,.pptx,.xlsx"
          onChange={handleFileSelect}
          className="hidden"
        />

        <div className="px-1">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className={cn(
              'w-full resize-none px-3 py-2.5 text-[13px]',
              'bg-transparent font-sans text-text-0',
              'placeholder:text-text-4',
              'focus:outline-none',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
            style={{ height: inputHeight }}
          />
        </div>

        <div className="flex items-center gap-1.5 px-1.5 pb-1.5 pt-0.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-4 hover:text-text-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title="Attach file"
          >
            <Paperclip size={14} />
          </button>

          <div className="flex items-center h-6 rounded-md bg-surface-3 border border-border-subtle p-0.5">
            <button
              onClick={() => onModeChange?.('api')}
              disabled={modeChanging}
              className={cn(
                'flex items-center gap-1 h-5 px-2 rounded text-2xs font-semibold font-sans transition-colors cursor-pointer',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                currentMode === 'api' ? 'bg-accent/15 text-accent' : 'text-text-3 hover:text-text-1',
              )}
              title="Lightweight — fast and cheap, no tools"
            >
              <Zap size={10} /> Chat
            </button>
            <button
              onClick={() => onModeChange?.('agent')}
              disabled={modeChanging}
              className={cn(
                'flex items-center gap-1 h-5 px-2 rounded text-2xs font-semibold font-sans transition-colors cursor-pointer',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                currentMode === 'agent' ? 'bg-purple/15 text-purple' : 'text-text-3 hover:text-text-1',
              )}
              title="Full agent — tools, files, session resume"
            >
              <Bot size={10} /> Agent
            </button>
          </div>

          <div ref={modelPickerRef} className="relative">
            <button
              onClick={() => setModelPickerOpen(!modelPickerOpen)}
              className={cn(
                'flex items-center gap-1 h-5 px-2 rounded text-2xs font-mono transition-colors cursor-pointer',
                isImageModel
                  ? 'bg-purple/8 text-purple hover:bg-purple/15'
                  : 'text-text-3 hover:text-text-1 hover:bg-surface-3',
              )}
            >
              {isImageModel && <ImageIcon size={9} />}
              <span className="max-w-[120px] truncate">{currentModel ? formatModelName(currentModel) : 'Select model'}</span>
              <ChevronUp size={10} className="text-text-4 flex-shrink-0" />
            </button>

            {modelPickerOpen && (() => {
              const chatProviders = [];
              const imageProviders = [];
              for (const provider of providers) {
                const models = provider.models || [];
                const chat = [];
                const img = [];
                for (const m of models) {
                  const mid = typeof m === 'string' ? m : m.id || m.name;
                  const mtype = typeof m === 'object' ? m.type : undefined;
                  if (mtype === 'image' || checkImageModel(mid)) img.push(m);
                  else chat.push(m);
                }
                if (chat.length) chatProviders.push({ ...provider, models: chat });
                if (img.length) imageProviders.push({ ...provider, models: img });
              }

              const renderModel = (provider, model) => {
                const modelId = typeof model === 'string' ? model : model.id || model.name;
                const modelName = typeof model === 'string' ? model : model.name || model.id;
                const mtype = typeof model === 'object' ? model.type : undefined;
                const isImg = mtype === 'image' || checkImageModel(modelId);
                const tier = isImg ? null : getTier(modelId);
                const tierCfg = tier ? TIER_CONFIG[tier] : null;
                const TierIcon = tierCfg?.icon;
                const isActive = currentModel === modelId && currentProvider === provider.id;
                return (
                  <button
                    key={modelId}
                    onClick={() => {
                      onModelChange?.({ provider: provider.id, model: modelId });
                      setModelPickerOpen(false);
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer',
                      isActive ? 'bg-accent/10' : 'hover:bg-surface-3',
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {isImg && <ImageIcon size={11} className="text-purple flex-shrink-0" />}
                        <span className={cn('text-xs font-medium font-sans truncate', isActive ? 'text-accent' : 'text-text-0')}>{modelName}</span>
                      </div>
                      {!isImg && (
                        <div className="text-2xs text-text-4 font-sans mt-0.5">{getContextSize(modelId)} context</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isImg ? (
                        <Badge variant="purple" className="text-[9px]">
                          <ImageIcon size={8} /> Image
                        </Badge>
                      ) : tierCfg && (
                        <Badge variant={tierCfg.variant} className="text-[9px]">
                          <TierIcon size={8} /> {tierCfg.label}
                        </Badge>
                      )}
                    </div>
                  </button>
                );
              };

              return (
                <div className="absolute bottom-full left-0 mb-1.5 w-80 max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-surface-1 shadow-2xl z-50">
                  {providers.length === 0 && (
                    <div className="px-4 py-8 text-center text-xs text-text-3 font-sans">No providers available</div>
                  )}
                  {chatProviders.map((provider) => (
                    <div key={provider.id}>
                      <div className="px-3.5 py-2 text-2xs font-semibold text-text-3 uppercase tracking-wider font-sans bg-surface-2/80 border-b border-border-subtle sticky top-0 backdrop-blur-sm">
                        {provider.name || provider.id}
                      </div>
                      {provider.models.map((m) => renderModel(provider, m))}
                    </div>
                  ))}
                  {imageProviders.length > 0 && (
                    <>
                      <div className="px-3.5 py-2 text-2xs font-semibold text-text-4 uppercase tracking-wider font-sans bg-surface-0 border-y border-border-subtle flex items-center gap-1.5 sticky top-0 backdrop-blur-sm">
                        <ImageIcon size={10} className="text-purple" />
                        Image Generation
                      </div>
                      {imageProviders.map((provider) => (
                        <div key={`img-${provider.id}`}>
                          <div className="px-3.5 py-2 text-2xs font-semibold text-text-3 uppercase tracking-wider font-sans bg-surface-2/80 border-b border-border-subtle">
                            {provider.name || provider.id}
                          </div>
                          {provider.models.map((m) => renderModel(provider, m))}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })()}
          </div>

          {isCodex && (
            <>
              <div className="flex items-center h-5 rounded bg-surface-3 border border-border-subtle p-0.5">
                {EFFORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => onReasoningEffortChange?.(opt.value)}
                    className={cn(
                      'h-4 px-1.5 rounded text-2xs font-semibold font-sans transition-colors cursor-pointer',
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

              <div className="flex items-center h-5 rounded bg-surface-3 border border-border-subtle p-0.5">
                {VERBOSITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => onVerbosityChange?.(opt.value)}
                    className={cn(
                      'h-4 px-1.5 rounded text-2xs font-semibold font-sans transition-colors cursor-pointer',
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
              title="Stop generation"
              className="group w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer"
            >
              <span className="relative flex items-center justify-center w-3.5 h-3.5">
                <span className="absolute inset-0 rounded-full bg-accent/30 group-hover:bg-red-500/30 animate-ping [animation-duration:2s] transition-colors" />
                <span className="relative w-2.5 h-2.5 rounded-full bg-accent group-hover:bg-red-500 transition-colors" />
              </span>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className={cn(
                'w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer',
                'disabled:opacity-15 disabled:cursor-not-allowed',
                canSend ? 'text-text-0 hover:text-text-1' : 'text-text-4',
              )}
            >
              {sending ? <Loader2 size={15} className="animate-spin" /> : <SendHorizontal size={15} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
