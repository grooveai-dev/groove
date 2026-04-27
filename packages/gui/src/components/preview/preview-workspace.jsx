// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Paperclip, MonitorX, Loader2, MessageCircle, Camera, RefreshCw } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { timeAgo } from '../../lib/format';
import { PreviewToolbar } from './preview-toolbar';
import { ScreenshotOverlay } from './screenshot-overlay';

function RenderedMarkdown({ text }) {
  if (!text) return null;
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        if (part.startsWith('```') && part.endsWith('```')) {
          const inner = part.slice(3, -3);
          const nl = inner.indexOf('\n');
          const code = nl >= 0 ? inner.slice(nl + 1) : inner;
          return (
            <pre key={i} className="my-2 px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle overflow-x-auto">
              <code className="text-xs font-mono text-text-1 whitespace-pre">{code}</code>
            </pre>
          );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i} className="px-1.5 py-0.5 rounded bg-surface-0 text-xs font-mono text-accent">{part.slice(1, -1)}</code>;
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold text-text-0">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={i} className="italic">{part.slice(1, -1)}</em>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function PreviewChatMessage({ msg }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end animate-chat-fade-in">
        <div className="max-w-[85%]">
          {msg.screenshot && (
            <img src={msg.screenshot} alt="Screenshot" className="mb-2 rounded-lg border border-border-subtle max-h-40 object-contain" />
          )}
          <div className="px-4 py-3 rounded-2xl rounded-br-md bg-gradient-to-br from-accent/12 to-accent/6 border border-accent/15">
            <p className="text-sm text-text-0 font-sans whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
          </div>
          <div className="text-2xs text-text-4 font-sans mt-1 text-right">{timeAgo(msg.timestamp)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[85%] animate-chat-fade-in">
      <div className="rounded-2xl rounded-tl-md bg-surface-1/80 border border-border-subtle px-4 py-3">
        <p className="text-sm text-text-1 font-sans whitespace-pre-wrap break-words leading-relaxed">
          <RenderedMarkdown text={msg.content} />
        </p>
      </div>
      <div className="text-2xs text-text-4 font-sans mt-1">{timeAgo(msg.timestamp)}</div>
    </div>
  );
}

function PreviewChat() {
  const previewChat = useGrooveStore((s) => s.previewChat);
  const previewState = useGrooveStore((s) => s.previewState);
  const iteratePreview = useGrooveStore((s) => s.iteratePreview);
  const previewIterating = useGrooveStore((s) => s.previewIterating);

  const [input, setInput] = useState('');
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function handleScroll() {
      isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    }
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [previewChat?.length]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, []);

  useEffect(() => { adjustHeight(); }, [input, adjustHeight]);

  function handleSend() {
    const text = input.trim();
    if (!text || previewIterating) return;
    iteratePreview(text);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-full bg-surface-0">
      {/* Header */}
      <div className="flex-shrink-0 h-10 flex items-center px-4 border-b border-border bg-surface-3">
        <span className="text-xs font-semibold text-text-1 font-sans">Iterate</span>
      </div>

      {/* Info banner */}
      <div className="flex-shrink-0 px-4 py-2 bg-accent/5 border-b border-accent/10">
        <p className="text-2xs text-accent font-sans">
          Iterating on <span className="font-semibold">{previewState.teamId || 'project'}</span> — changes auto-refresh via hot reload
        </p>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {previewChat.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="max-w-xs w-full px-5 py-5 bg-surface-1 border border-border-subtle rounded-xl text-center">
              <MessageCircle size={24} className="mx-auto text-accent mb-3" />
              <h3 className="text-sm font-semibold text-text-0 font-sans mb-3">Preview is live!</h3>
              <ul className="text-left space-y-2 text-2xs text-text-2 font-sans">
                <li className="flex gap-2">
                  <Send size={11} className="text-text-3 mt-0.5 flex-shrink-0" />
                  <span>Type a message to request changes — your feedback goes to the team planner who routes it to the right agent</span>
                </li>
                <li className="flex gap-2">
                  <Camera size={11} className="text-text-3 mt-0.5 flex-shrink-0" />
                  <span>Use the camera icon to screenshot a specific area and annotate it</span>
                </li>
                <li className="flex gap-2">
                  <RefreshCw size={11} className="text-text-3 mt-0.5 flex-shrink-0" />
                  <span>Changes auto-refresh via hot module reload</span>
                </li>
              </ul>
            </div>
          </div>
        )}
        {previewChat.map((msg, i) => (
          <PreviewChatMessage key={i} msg={msg} />
        ))}
        {previewIterating && (
          <div className="max-w-[85%] animate-chat-fade-in">
            <div className="rounded-2xl rounded-tl-md bg-surface-1/80 border border-border-subtle px-4 py-3">
              <div className="flex items-center gap-2">
                <Loader2 size={14} className="text-accent animate-spin" />
                <span className="text-xs text-text-3 font-sans">Routing to planner...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-3 py-3 border-t border-border">
        <div className="flex items-end gap-2 rounded-2xl bg-surface-1/80 border border-accent/8 px-3 py-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Describe changes..."
            rows={1}
            style={{ minHeight: '36px' }}
            className="flex-1 resize-none bg-transparent text-sm text-text-0 font-sans placeholder:text-text-4 focus:outline-none py-1.5"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || previewIterating}
            className={cn(
              'w-9 h-9 flex items-center justify-center rounded-xl transition-all cursor-pointer flex-shrink-0',
              'disabled:opacity-20 disabled:cursor-not-allowed',
              input.trim() && !previewIterating
                ? 'bg-accent/15 text-accent hover:bg-accent/25 border border-accent/25'
                : 'bg-surface-4 text-text-4',
            )}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyPreview() {
  return (
    <div className="flex-1 flex items-center justify-center bg-surface-0">
      <div className="text-center space-y-3">
        <MonitorX size={40} className="mx-auto text-text-4" />
        <h2 className="text-lg font-semibold text-text-1 font-sans">No preview active</h2>
        <p className="text-sm text-text-3 font-sans max-w-xs">
          Build a project with a planner team to see it here.
        </p>
      </div>
    </div>
  );
}

const DEVICE_WIDTHS = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px',
};

export function PreviewWorkspace({ embedded = false }) {
  const previewState = useGrooveStore((s) => s.previewState);
  const iframeRef = useRef(null);
  const [iframeKey, setIframeKey] = useState(0);

  const handleRefresh = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  if (!previewState.url) {
    return <EmptyPreview />;
  }

  const iframeSrc = previewState.url;

  const deviceWidth = DEVICE_WIDTHS[previewState.deviceSize] || '100%';
  const isFullWidth = previewState.deviceSize === 'desktop';

  return (
    <div className="flex flex-col h-full bg-surface-0 md:flex-row">
      {/* Left pane: iframe */}
      <div className="flex flex-col flex-[3] min-w-0 min-h-0">
        <PreviewToolbar onRefresh={handleRefresh} />
        <div className="flex-1 relative overflow-hidden bg-surface-1">
          {previewState.screenshotMode && (
            <ScreenshotOverlay iframeRef={iframeRef} />
          )}
          <div className={cn(
            'h-full transition-all duration-200',
            isFullWidth ? 'w-full' : 'mx-auto',
          )} style={isFullWidth ? undefined : { width: deviceWidth, maxWidth: '100%' }}>
            <iframe
              ref={iframeRef}
              key={iframeKey}
              src={iframeSrc}
              title="Preview"
              className="w-full h-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        </div>
      </div>

      {!embedded && (
        <div className="flex-[2] min-w-[280px] max-w-[480px] border-l border-border md:max-w-none md:flex-[2]">
          <PreviewChat />
        </div>
      )}
    </div>
  );
}
