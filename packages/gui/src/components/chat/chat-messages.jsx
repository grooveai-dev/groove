// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect, useState } from 'react';
import { Copy, Check, ArrowRight, MessageCircle, Sparkles } from 'lucide-react';
import { cn } from '../../lib/cn';
import { timeAgo } from '../../lib/format';
import { ThinkingIndicator } from '../ui/thinking-indicator';

function CopyButton({ text }) {
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
      className="flex items-center gap-1 px-2 py-1 text-2xs font-sans text-text-3 hover:text-text-1 transition-colors cursor-pointer"
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

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: 'code', language: lang, code: codeLines.join('\n') });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Blockquote
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

    // Unordered list
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

    // Ordered list
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

    // Table
    if (line.includes('|') && i + 1 < lines.length && /^\|?\s*[-:]+/.test(lines[i + 1])) {
      const headerCells = line.split('|').map((c) => c.trim()).filter(Boolean);
      i += 2; // skip header + separator
      const rows = [];
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(lines[i].split('|').map((c) => c.trim()).filter(Boolean));
        i++;
      }
      blocks.push({ type: 'table', headers: headerCells, rows });
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty lines
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
              <ul key={i} className="list-disc list-inside space-y-0.5 text-sm text-text-1 font-sans">
                {block.items.map((item, j) => <li key={j}><InlineMarkdown text={item} /></li>)}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="list-decimal list-inside space-y-0.5 text-sm text-text-1 font-sans">
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
                          <td key={k} className="px-3 py-1.5 text-text-1"><InlineMarkdown text={cell} /></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'paragraph':
            return <p key={i} className="text-sm text-text-1 font-sans leading-relaxed whitespace-pre-wrap break-words"><InlineMarkdown text={block.text} /></p>;
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
      <div className="max-w-[75%]">
        <div className="px-4 py-3 rounded-2xl rounded-br-md bg-accent/10 border border-accent/15">
          <p className="text-sm text-text-0 font-sans whitespace-pre-wrap break-words leading-relaxed">{msg.text}</p>
        </div>
        <div className="text-2xs text-text-4 font-sans mt-1 text-right">{timeAgo(msg.timestamp)}</div>
      </div>
    </div>
  );
}

function AssistantMessage({ msg, model }) {
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-surface-4 border border-border-subtle flex items-center justify-center flex-shrink-0 mt-0.5">
        <Sparkles size={13} className="text-accent" />
      </div>
      <div className="flex-1 min-w-0 max-w-[85%]">
        {model && <div className="text-2xs text-text-3 font-sans mb-1 font-medium">{model}</div>}
        <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-surface-4 border border-border-subtle">
          <RenderedMarkdown text={msg.text} />
        </div>
        <div className="text-2xs text-text-4 font-sans mt-1">{timeAgo(msg.timestamp)}</div>
      </div>
    </div>
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
      <div className="w-16 h-16 rounded-full bg-accent/8 flex items-center justify-center mb-5">
        <MessageCircle size={28} className="text-accent" />
      </div>
      <h2 className="text-xl font-bold text-text-0 font-sans mb-2">Start a conversation</h2>
      <p className="text-sm text-text-2 font-sans max-w-sm leading-relaxed">
        Send a message to begin. Your conversation history is saved locally and syncs across sessions.
      </p>
    </div>
  );
}

export function ChatMessages({ messages, isStreaming, model }) {
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
        if (msg.from === 'user') return <UserMessage key={i} msg={msg} />;
        if (msg.from === 'system') return <SystemMessage key={i} msg={msg} />;
        return <AssistantMessage key={i} msg={msg} model={model} />;
      })}
      {isStreaming && (
        <div className="flex gap-3">
          <div className="w-7 h-7 rounded-full bg-surface-4 border border-border-subtle flex items-center justify-center flex-shrink-0">
            <Sparkles size={13} className="text-accent" />
          </div>
          <ThinkingIndicator className="py-1" />
        </div>
      )}
    </div>
  );
}
