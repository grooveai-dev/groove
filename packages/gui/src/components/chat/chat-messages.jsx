// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect, useState, useCallback } from 'react';
import { Copy, Check, ArrowRight, Download, Maximize2, X, Image as ImageIcon, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { timeAgo } from '../../lib/format';
import { Avatar } from '../ui/avatar';
import { ThinkingIndicator } from '../ui/thinking-indicator';

const API_STATUS_MESSAGES = [
  'Generating response...',
  'Processing...',
  'Thinking...',
  'Almost there...',
];

function stripEmojis(text) {
  if (!text) return '';
  return text
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[️‍⃣]/g, '')
    .replace(/\s{2,}/g, ' ');
}

function CopyButton({ text, className }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={handleCopy}
      className={cn('flex items-center gap-1 px-2 py-1 text-2xs font-sans text-text-3 hover:text-text-1 transition-colors cursor-pointer', className)}
    >
      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CodeBlock({ language, code }) {
  return (
    <div className="my-3 rounded-lg border border-border-subtle overflow-hidden bg-surface-0">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-3 border-b border-border-subtle">
        <span className="text-2xs font-mono text-text-3">{language || 'code'}</span>
        <CopyButton text={code} />
      </div>
      <pre className="px-4 py-3 overflow-x-auto">
        <code className="text-xs font-mono text-text-1 leading-relaxed whitespace-pre">{code}</code>
      </pre>
    </div>
  );
}

function parseMarkdown(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: 'code', language: lang, code: codeLines.join('\n') });
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    if (line.startsWith('> ')) {
      const quoteLines = [line.slice(2)];
      i++;
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join('\n') });
      continue;
    }

    if (/^[-*+]\s/.test(line)) {
      const items = [line.replace(/^[-*+]\s/, '')];
      i++;
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s/, ''));
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items = [line.replace(/^\d+\.\s/, '')];
      i++;
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ''));
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && /^\|?\s*[-:]+/.test(lines[i + 1])) {
      const headerCells = line.split('|').map((c) => c.trim()).filter(Boolean);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(lines[i].split('|').map((c) => c.trim()).filter(Boolean));
        i++;
      }
      blocks.push({ type: 'table', headers: headerCells, rows });
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    const paraLines = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('```') && !lines[i].startsWith('#') && !/^[-*+]\s/.test(lines[i]) && !/^\d+\.\s/.test(lines[i]) && !lines[i].startsWith('> ') && !/^(-{3,}|_{3,}|\*{3,})$/.test(lines[i].trim())) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', text: paraLines.join('\n') });
  }

  return blocks;
}

function InlineMarkdown({ text }) {
  if (!text) return null;
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[([^\]]+)\]\(([^)]+)\))/g);
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        if (part.startsWith('`') && part.endsWith('`') && !part.startsWith('``')) {
          return <code key={i} className="px-1.5 py-0.5 rounded bg-surface-0 text-xs font-mono text-accent">{part.slice(1, -1)}</code>;
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold text-text-0">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
          return <em key={i} className="italic">{part.slice(1, -1)}</em>;
        }
        if (part.startsWith('~~') && part.endsWith('~~')) {
          return <del key={i} className="line-through text-text-3">{part.slice(2, -2)}</del>;
        }
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          return <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{linkMatch[1]}</a>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function RenderedMarkdown({ text }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'code':
            return <CodeBlock key={i} language={block.language} code={block.code} />;
          case 'heading': {
            const sizes = ['text-lg font-bold', 'text-base font-bold', 'text-sm font-semibold', 'text-sm font-semibold', 'text-xs font-semibold', 'text-xs font-semibold'];
            return <div key={i} className={cn(sizes[block.level - 1] || sizes[0], 'text-text-0 font-sans mt-3 mb-1')}><InlineMarkdown text={block.text} /></div>;
          }
          case 'hr':
            return <hr key={i} className="border-border-subtle my-3" />;
          case 'blockquote':
            return (
              <div key={i} className="border-l-2 border-accent/40 pl-3 py-1 text-sm text-text-2 italic font-sans">
                <InlineMarkdown text={block.text} />
              </div>
            );
          case 'ul':
            return (
              <ul key={i} className="list-disc list-inside space-y-0.5 text-sm text-text-0 font-sans">
                {block.items.map((item, j) => <li key={j}><InlineMarkdown text={item} /></li>)}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="list-decimal list-inside space-y-0.5 text-sm text-text-0 font-sans">
                {block.items.map((item, j) => <li key={j}><InlineMarkdown text={item} /></li>)}
              </ol>
            );
          case 'table':
            return (
              <div key={i} className="overflow-x-auto my-2">
                <table className="text-xs font-sans border-collapse w-full">
                  <thead>
                    <tr className="border-b border-border">
                      {block.headers.map((h, j) => (
                        <th key={j} className="px-3 py-1.5 text-left font-semibold text-text-0">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, j) => (
                      <tr key={j} className="border-b border-border-subtle">
                        {row.map((cell, k) => (
                          <td key={k} className="px-3 py-1.5 text-text-0"><InlineMarkdown text={cell} /></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'paragraph':
            return <p key={i} className="text-sm text-text-0 font-sans leading-relaxed whitespace-pre-wrap break-words"><InlineMarkdown text={block.text} /></p>;
          default:
            return null;
        }
      })}
    </div>
  );
}

function UserMessage({ msg }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%]">
        <div className="px-3.5 py-2.5 rounded-2xl rounded-br-md bg-accent/10 border border-accent/15">
          <p className="text-sm text-text-0 font-sans whitespace-pre-wrap break-words leading-relaxed">{msg.text}</p>
        </div>
        <div className="text-2xs text-text-4 font-sans mt-1 text-right">{timeAgo(msg.timestamp)}</div>
      </div>
    </div>
  );
}

function AssistantMessage({ msg, model, role }) {
  const cleanText = stripEmojis(msg.text);
  const displayName = model || 'Assistant';
  const avatarRole = role || 'chat';
  return (
    <div className="flex gap-2.5">
      <Avatar name={displayName} role={avatarRole} size="sm" className="mt-1 flex-shrink-0" />
      <div className="max-w-[85%]">
        <div className="text-2xs text-text-3 font-sans mb-1 font-medium">{displayName}</div>
        <div className="border-l-2 border-accent/40 pl-3.5 py-1">
          <div className="text-sm text-text-1 font-sans whitespace-pre-wrap break-words leading-relaxed">
            <RenderedMarkdown text={cleanText} />
          </div>
        </div>
        <div className="text-2xs text-text-4 font-sans mt-1">{timeAgo(msg.timestamp)}</div>
      </div>
    </div>
  );
}

function ImageLoadingMessage({ msg }) {
  return (
    <div className="max-w-[85%]">
      <div className="rounded-2xl rounded-tl-md bg-surface-1/80 border border-border-subtle overflow-hidden">
        <div className="w-80 h-80 image-loading-shimmer flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-surface-3/80 flex items-center justify-center">
              <ImageIcon size={18} className="text-accent animate-pulse" />
            </div>
            <span className="text-xs text-text-3 font-sans">Generating image...</span>
          </div>
        </div>
        {msg.prompt && (
          <div className="px-4 py-2.5 border-t border-border-subtle">
            <p className="text-2xs text-text-3 font-sans italic truncate">&quot;{msg.prompt}&quot;</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ImageMessage({ msg, onReply }) {
  const [expanded, setExpanded] = useState(false);
  const [hovering, setHovering] = useState(false);

  const handleDownload = useCallback(() => {
    if (!msg.imageUrl) return;
    const a = document.createElement('a');
    a.href = msg.imageUrl;
    a.download = `groove-${msg.model || 'image'}-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [msg.imageUrl, msg.model]);

  return (
    <>
      <div className="max-w-[85%]">
        {msg.model && <div className="text-2xs text-text-3 font-mono mb-1.5 font-medium flex items-center gap-1.5"><ImageIcon size={10} /> {msg.model}</div>}
        <div className="rounded-2xl rounded-tl-md bg-surface-1/80 border border-border-subtle overflow-hidden">
          <div
            className="relative group"
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
          >
            <img
              src={msg.imageUrl}
              alt={msg.prompt || 'Generated image'}
              className="max-w-full max-h-[480px] object-contain cursor-pointer"
              onClick={() => setExpanded(true)}
            />
            {hovering && (
              <div className="absolute top-2 right-2 flex gap-1.5">
                <button
                  onClick={handleDownload}
                  className="w-8 h-8 rounded-lg bg-surface-0/90 backdrop-blur-sm border border-border-subtle flex items-center justify-center text-text-2 hover:text-accent hover:border-accent/30 transition-colors cursor-pointer"
                  title="Download"
                >
                  <Download size={14} />
                </button>
                <button
                  onClick={() => setExpanded(true)}
                  className="w-8 h-8 rounded-lg bg-surface-0/90 backdrop-blur-sm border border-border-subtle flex items-center justify-center text-text-2 hover:text-accent hover:border-accent/30 transition-colors cursor-pointer"
                  title="Fullscreen"
                >
                  <Maximize2 size={14} />
                </button>
                <CopyButton text={msg.prompt || ''} className="h-8 rounded-lg bg-surface-0/90 backdrop-blur-sm border border-border-subtle text-text-2 hover:text-accent" />
              </div>
            )}
          </div>
          <div className="px-4 py-2.5 border-t border-border-subtle flex items-center gap-2">
            <p className="flex-1 text-2xs text-text-3 font-sans italic truncate">&quot;{msg.prompt}&quot;</p>
            {onReply && (
              <button
                onClick={() => onReply(msg)}
                className="text-2xs text-accent hover:text-accent/80 font-sans font-medium cursor-pointer flex items-center gap-1 flex-shrink-0"
              >
                <RefreshCw size={10} /> Iterate
              </button>
            )}
          </div>
        </div>
        <div className="text-2xs text-text-4 font-sans mt-1">{timeAgo(msg.timestamp)}</div>
      </div>

      {expanded && (
        <div
          className="fixed inset-0 z-[200] bg-surface-0/95 backdrop-blur-md flex items-center justify-center"
          onClick={() => setExpanded(false)}
        >
          <button
            onClick={() => setExpanded(false)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-surface-3 border border-border flex items-center justify-center text-text-2 hover:text-text-0 transition-colors cursor-pointer z-10"
          >
            <X size={18} />
          </button>
          <div className="absolute bottom-4 right-4 flex gap-2 z-10">
            <button
              onClick={(e) => { e.stopPropagation(); handleDownload(); }}
              className="h-9 px-4 rounded-lg bg-surface-3 border border-border flex items-center gap-2 text-xs font-sans text-text-1 hover:text-accent hover:border-accent/30 transition-colors cursor-pointer"
            >
              <Download size={14} /> Download
            </button>
          </div>
          <img
            src={msg.imageUrl}
            alt={msg.prompt || 'Generated image'}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          {msg.prompt && (
            <div className="absolute bottom-4 left-4 max-w-md px-4 py-2 rounded-lg bg-surface-3/90 backdrop-blur-sm border border-border-subtle z-10">
              <p className="text-xs text-text-2 font-sans italic">&quot;{msg.prompt}&quot;</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function SystemMessage({ msg }) {
  return (
    <div className="flex justify-center py-1">
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-4/50">
        <ArrowRight size={10} className="text-text-4" />
        <span className="text-2xs text-text-3 font-sans">{msg.text}</span>
      </div>
    </div>
  );
}

function StreamingCursor() {
  return (
    <span className="inline-block w-2 h-4 bg-accent/60 ml-0.5 animate-pulse rounded-sm" />
  );
}

function WelcomeMessage() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-16">
      <p className="text-sm text-text-3 font-sans">Send a message to start</p>
    </div>
  );
}

function ApiTypingIndicator() {
  const [idx, setIdx] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const t = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % API_STATUS_MESSAGES.length);
        setFade(true);
      }, 250);
    }, 2800);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex items-center gap-2.5 ml-8 py-1">
      <div className="relative w-3.5 h-3.5 flex-shrink-0">
        <span className="absolute inset-0 rounded-full border border-transparent border-t-accent animate-spin" style={{ animationDuration: '0.9s' }} />
      </div>
      <span
        className="text-2xs font-sans text-text-3 transition-opacity duration-[250ms]"
        style={{ opacity: fade ? 1 : 0 }}
      >
        {API_STATUS_MESSAGES[idx]}
      </span>
    </div>
  );
}

export function ChatMessages({ messages, isStreaming, model, mode, onImageReply, role }) {
  const scrollRef = useRef(null);
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
  }, [messages?.length, isStreaming]);

  if (!messages || messages.length === 0) {
    return (
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <WelcomeMessage />
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
      {messages.map((msg, i) => {
        if (msg.type === 'image-loading') return <ImageLoadingMessage key={i} msg={msg} />;
        if (msg.type === 'image') return <ImageMessage key={i} msg={msg} onReply={onImageReply} />;
        if (msg.from === 'user') return <UserMessage key={i} msg={msg} />;
        if (msg.from === 'system') return <SystemMessage key={i} msg={msg} />;
        return <AssistantMessage key={i} msg={msg} model={model} role={role} />;
      })}
      {isStreaming && (
        mode === 'agent' ? (
          <ThinkingIndicator className="py-1" />
        ) : (
          <ApiTypingIndicator />
        )
      )}
    </div>
  );
}
