// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Loader2, MessageSquare, SendHorizontal, Pause,
  FileEdit, Search, Terminal, CheckCircle2, AlertCircle,
  RotateCw, Zap, Wrench, Eye, Code2, Bug,
  ChevronDown, Paperclip, GripHorizontal,
  FileCode, X, File, Image as ImageIcon, Film, Upload,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { timeAgo } from '../../lib/format';
import { api } from '../../lib/api';
import { ThinkingIndicator } from '../ui/thinking-indicator';
import { TableTree } from '../ui/table-tree';

const EMPTY = [];
const KEEPER_RE = /(\[(?:save|append|update|delete|view|doc|link|read|instruct)\]|#[\w/.-]+)/gi;
const KEEPER_CMD_RE = /^\[(?:save|append|update|delete|view|doc|link|read|instruct)\]$/i;
const KEEPER_TAG_RE = /^#[\w/.-]+$/;
const KEEPER_DETECT_RE = /\[(?:save|append|update|delete|view|doc|link|read|instruct)\]/i;

function highlightKeeperInput(text) {
  return text.split(KEEPER_RE).map((part, i) => {
    if (KEEPER_CMD_RE.test(part)) return <span key={i} className="text-accent">{part}</span>;
    if (KEEPER_TAG_RE.test(part)) return <span key={i} className="text-accent">{part}</span>;
    return <span key={i} className="text-text-0">{part}</span>;
  });
}

// ── Activity metadata ────────────────────────────────────────
function activityMeta(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('reading') || t.includes('read '))
    return { icon: Eye, color: 'text-info', label: 'Reading' };
  if (t.includes('editing') || t.includes('wrote') || t.includes('writing') || t.includes('edit '))
    return { icon: FileEdit, color: 'text-warning', label: 'Editing' };
  if (t.includes('searching') || t.includes('search') || t.includes('grep') || t.includes('glob'))
    return { icon: Search, color: 'text-purple', label: 'Searching' };
  if (t.includes('running') || t.includes('bash') || t.includes('command') || t.includes('exec'))
    return { icon: Terminal, color: 'text-orange', label: 'Running' };
  if (t.includes('test') || t.includes('pass'))
    return { icon: CheckCircle2, color: 'text-success', label: 'Testing' };
  if (t.includes('error') || t.includes('fail') || t.includes('crash'))
    return { icon: AlertCircle, color: 'text-danger', label: 'Error' };
  if (t.includes('rotat'))
    return { icon: RotateCw, color: 'text-accent', label: 'Rotating' };
  if (t.includes('spawn') || t.includes('start'))
    return { icon: Zap, color: 'text-success', label: 'Spawned' };
  if (t.includes('tool') || t.includes('function'))
    return { icon: Wrench, color: 'text-text-2', label: 'Tool' };
  if (t.includes('complet') || t.includes('done') || t.includes('finish'))
    return { icon: CheckCircle2, color: 'text-success', label: 'Done' };
  return { icon: Code2, color: 'text-text-3', label: 'Activity' };
}

// ── Inline formatting (bold, code) ───────────────────────────
function InlineFormat({ text }) {
  if (!text) return null;
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="font-semibold text-text-0">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="px-1 py-px rounded bg-accent/8 text-[11px] font-mono text-accent">{part.slice(1, -1)}</code>;
    return <span key={i}>{part}</span>;
  });
}

// ── Structured message renderer ──────────────────────────────
// Parses agent output into sections: headers, bullets, code blocks, paragraphs
function StructuredMessage({ text }) {
  if (!text) return null;

  const blocks = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trimStart().startsWith('```')) {
      const codeLines = [];
      const lang = line.trim().slice(3);
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: 'code', content: codeLines.join('\n'), lang });
      continue;
    }

    // Header (## or **Header:** at start of line)
    if (/^#{1,3}\s/.test(line) || /^\*\*[^*]+:\*\*\s*$/.test(line.trim())) {
      const heading = line.replace(/^#+\s*/, '').replace(/^\*\*/, '').replace(/:\*\*\s*$/, ':').trim();
      blocks.push({ type: 'heading', content: heading });
      i++;
      continue;
    }

    // Bullet / dash list item
    if (/^\s*[-*]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, '').trim());
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // Numbered list
    if (/^\s*\d+[\.)]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[\.)]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[\.)]\s+/, '').trim());
        i++;
      }
      blocks.push({ type: 'numbered', items });
      continue;
    }

    // Table
    if (line.includes('|') && i + 1 < lines.length && /^\|?\s*[-:]+/.test(lines[i + 1])) {
      const headers = line.split('|').map((c) => c.trim()).filter(Boolean);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(lines[i].split('|').map((c) => c.trim()).filter(Boolean));
        i++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // Empty line — skip
    if (!line.trim()) { i++; continue; }

    // Note/warning line
    if (/^(Note|Warning|Important|IMPORTANT|TODO):/i.test(line.trim())) {
      blocks.push({ type: 'note', content: line.trim() });
      i++;
      continue;
    }

    // Regular paragraph — collect consecutive non-empty lines
    const paraLines = [];
    while (i < lines.length && lines[i].trim() && !/^#{1,3}\s/.test(lines[i]) && !/^\s*[-*]\s/.test(lines[i]) && !/^\s*\d+[\.)]\s/.test(lines[i]) && !lines[i].trimStart().startsWith('```')) {
      paraLines.push(lines[i].trim());
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'para', content: paraLines.join(' ') });
    }
  }

  return (
    <div className="space-y-2">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'heading':
            return (
              <div key={idx} className="flex items-center gap-1.5 pt-1.5 first:pt-0">
                <div className="w-1 h-3.5 rounded-full bg-accent/40 flex-shrink-0" />
                <span className="text-[12px] font-semibold text-text-0 font-sans"><InlineFormat text={block.content} /></span>
              </div>
            );
          case 'list':
            return (
              <div key={idx} className="space-y-1 pl-2">
                {block.items.map((item, j) => (
                  <div key={j} className="flex gap-2 text-[12px] text-text-0 font-sans leading-relaxed">
                    <span className="text-accent/50 mt-0.5 flex-shrink-0">-</span>
                    <span className="min-w-0"><InlineFormat text={item} /></span>
                  </div>
                ))}
              </div>
            );
          case 'numbered':
            return (
              <div key={idx} className="space-y-1 pl-2">
                {block.items.map((item, j) => (
                  <div key={j} className="flex gap-2 text-[12px] text-text-0 font-sans leading-relaxed">
                    <span className="text-text-4 font-mono w-4 text-right flex-shrink-0">{j + 1}.</span>
                    <span className="min-w-0"><InlineFormat text={item} /></span>
                  </div>
                ))}
              </div>
            );
          case 'code':
            return (
              <pre key={idx} className="p-2.5 rounded-md bg-[#0d1117] text-[11px] font-mono text-[#c9d1d9] overflow-x-auto whitespace-pre-wrap border border-white/[0.06] leading-relaxed">
                {block.content}
              </pre>
            );
          case 'table':
            return <TableTree key={idx} headers={block.headers} rows={block.rows} />;
          case 'note':
            return (
              <div key={idx} className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-md bg-warning/6 border border-warning/12">
                <AlertCircle size={10} className="text-warning mt-0.5 flex-shrink-0" />
                <span className="text-[11px] text-warning/80 font-sans"><InlineFormat text={block.content} /></span>
              </div>
            );
          case 'para':
          default:
            return <p key={idx} className="text-[12px] text-text-0 font-sans leading-relaxed"><InlineFormat text={block.content} /></p>;
        }
      })}
    </div>
  );
}

// Simple inline formatting for user messages
function FormattedText({ text }) {
  if (!text) return null;
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const code = part.slice(3, -3).replace(/^\w+\n/, '');
          return <pre key={i} className="my-1.5 p-2 rounded-md bg-[#0d1117] text-[11px] font-mono text-[#c9d1d9] overflow-x-auto whitespace-pre-wrap border border-white/[0.06]">{code}</pre>;
        }
        return <span key={i}><InlineFormat text={part} /></span>;
      })}
    </span>
  );
}

// ── Lightbox ────────────────────────────────────────────────

function Lightbox({ src, type, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 p-2 text-white/70 hover:text-white cursor-pointer z-10">
        <X size={20} />
      </button>
      <div className="max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        {type === 'video' ? (
          <video src={src} controls autoPlay className="max-w-full max-h-[85vh] rounded-lg" />
        ) : (
          <img src={src} className="max-w-full max-h-[85vh] rounded-lg object-contain" alt="" />
        )}
      </div>
    </div>
  );
}

// ── Attachment display in messages ──────────────────────────

function AttachmentGrid({ attachments }) {
  const [lightbox, setLightbox] = useState(null);
  if (!attachments || attachments.length === 0) return null;

  const images = attachments.filter((a) => a.type === 'image');
  const videos = attachments.filter((a) => a.type === 'video');
  const files = attachments.filter((a) => a.type === 'file');

  return (
    <>
      {lightbox && <Lightbox src={lightbox.src} type={lightbox.type} onClose={() => setLightbox(null)} />}
      {(images.length > 0 || videos.length > 0) && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {images.map((att, i) => (
            <button
              key={i}
              onClick={() => setLightbox({ src: att.dataUrl, type: 'image' })}
              className="relative group rounded-md overflow-hidden border border-border-subtle hover:border-accent/40 transition-colors cursor-pointer flex-shrink-0"
            >
              <img src={att.dataUrl} className="w-16 h-16 object-cover" alt={att.name} />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                <Eye size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          ))}
          {videos.map((att, i) => (
            <button
              key={i}
              onClick={() => setLightbox({ src: att.dataUrl, type: 'video' })}
              className="relative group rounded-md overflow-hidden border border-border-subtle hover:border-accent/40 transition-colors cursor-pointer flex-shrink-0"
            >
              <video src={att.dataUrl} className="w-16 h-16 object-cover" muted />
              <div className="absolute inset-0 bg-black/30 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                <Film size={14} className="text-white" />
              </div>
            </button>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {files.map((att, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-3 border border-border-subtle">
              <File size={11} className="text-text-3 flex-shrink-0" />
              <span className="text-[11px] font-sans text-text-1 truncate max-w-[140px]">{att.name}</span>
              <span className="text-[10px] font-mono text-text-4">{formatFileSize(att.size)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── Message components ───────────────────────────────────────

function UserMessage({ msg }) {
  return (
    <div className="flex justify-end pl-8">
      <div className="max-w-[90%]">
        <div className="px-3.5 py-2.5 rounded-lg border bg-info/10 border-info/25">
          {msg.text && (
            <div className="text-[12px] font-sans whitespace-pre-wrap break-words leading-relaxed text-text-0">
              <FormattedText text={msg.text} />
            </div>
          )}
          <AttachmentGrid attachments={msg.attachments} />
        </div>
        <div className="text-[10px] text-text-4 font-sans mt-1 text-right">{timeAgo(msg.timestamp)}</div>
      </div>
    </div>
  );
}

function AgentMessage({ msg, agent }) {
  const [collapsed, setCollapsed] = useState(msg.text?.length > 600);
  const isLong = msg.text?.length > 600;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-2xs font-semibold text-text-1 font-sans">{agent?.name || 'Agent'}</span>
        <span className="text-2xs text-text-4 font-sans">{agent?.role}</span>
        <span className="text-[10px] text-text-4 font-sans ml-auto">{timeAgo(msg.timestamp)}</span>
      </div>
      <div className="border-l border-accent pl-3.5 py-1">
        <StructuredMessage text={collapsed ? msg.text.slice(0, 600) + '...' : msg.text} />
      </div>
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="ml-3.5 mt-1.5 flex items-center gap-1.5 text-[11px] text-accent/70 hover:text-accent font-sans font-medium cursor-pointer transition-colors"
        >
          <ChevronDown size={11} />
          Show full response
        </button>
      )}
      {isLong && !collapsed && (
        <button
          onClick={() => setCollapsed(true)}
          className="ml-3.5 mt-1.5 flex items-center gap-1.5 text-[11px] text-accent/70 hover:text-accent font-sans font-medium cursor-pointer transition-colors"
        >
          <ChevronDown size={11} className="rotate-180" />
          Collapse
        </button>
      )}
    </div>
  );
}

function SystemMessage({ msg }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px bg-border-subtle" />
      <span className="text-[10px] text-text-4 font-sans flex-shrink-0 uppercase tracking-wide">{msg.text}</span>
      <div className="flex-1 h-px bg-border-subtle" />
    </div>
  );
}

// ── Activity components ──────────────────────────────────────

function ActivityLine({ entry }) {
  const meta = activityMeta(entry.text);
  const Icon = meta.icon;
  const display = entry.text?.length > 120 ? entry.text.slice(0, 120) + '...' : entry.text;

  return (
    <div className="flex items-center gap-2 py-0.5 group">
      <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0">
        <Icon size={10} className={cn(meta.color, 'opacity-70')} />
      </div>
      <p className="text-[11px] text-text-3 font-sans truncate flex-1 min-w-0">{display}</p>
      <span className="text-[10px] text-text-4 font-mono opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {timeAgo(entry.timestamp)}
      </span>
    </div>
  );
}

function ActivityGroup({ entries, isLive }) {
  const [cycleIdx, setCycleIdx] = useState(0);

  useEffect(() => {
    if (!isLive || entries.length <= 1) return;
    const timer = setInterval(() => setCycleIdx((i) => (i + 1) % entries.length), 1500);
    return () => clearInterval(timer);
  }, [entries.length, isLive]);

  if (!isLive) {
    // Collapsed static summary for completed groups
    const last = entries[entries.length - 1];
    const meta = activityMeta(last.text);
    const Icon = meta.icon;
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1 text-[10px] text-text-4 font-mono">
        <Icon size={10} className="opacity-50" />
        <span>{entries.length} tool call{entries.length !== 1 ? 's' : ''}</span>
      </div>
    );
  }

  const current = entries[Math.min(cycleIdx, entries.length - 1)];

  return (
    <div className="flex items-center gap-2 px-3 py-2 w-full rounded-md bg-surface-3/50 border border-border-subtle/30">
      <Loader2 size={11} className="text-accent animate-spin flex-shrink-0" />
      <span className="text-[11px] text-text-2 font-mono truncate min-w-0 flex-1 transition-opacity duration-300">
        {current.text}
      </span>
      {entries.length > 1 && (
        <span className="text-[10px] text-text-4 font-mono flex-shrink-0">{entries.length}</span>
      )}
    </div>
  );
}

// ── Streaming status bar ─────────────────────────────────────

function StreamingBar({ agent }) {
  const activityLog = useGrooveStore((s) => s.activityLog[agent.id]) || EMPTY;
  const lastActivity = activityLog[activityLog.length - 1];
  const meta = lastActivity ? activityMeta(lastActivity.text) : null;
  const Icon = meta?.icon || Code2;
  const isRecent = lastActivity && (Date.now() - lastActivity.timestamp) < 10000;

  const display = isRecent && lastActivity.text
    ? (lastActivity.text.length > 60 ? lastActivity.text.slice(0, 60) + '...' : lastActivity.text)
    : null;

  const ctxPct = Math.round((agent.contextUsage || 0) * 100);

  return (
    <div className="flex items-center gap-3 px-4 h-8 border-b border-border-subtle bg-surface-1/80 flex-shrink-0">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="relative flex items-center justify-center w-4 h-4">
          <span className="absolute inset-0 rounded-full bg-accent/15 animate-ping [animation-duration:2s]" />
          <span className="relative w-1.5 h-1.5 rounded-full bg-accent" />
        </div>
        {isRecent ? (
          <>
            <Icon size={10} className={cn(meta.color, 'flex-shrink-0')} />
            <span className="text-[11px] text-text-2 font-sans truncate">{display}</span>
          </>
        ) : (
          <span className="text-[11px] text-text-3 font-sans">Working...</span>
        )}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-[10px] text-text-4 font-mono">{fmtTokens(agent.tokensUsed)}</span>
        <div className="flex items-center gap-1.5">
          <div className="w-14 h-0.5 rounded-sm bg-surface-4 overflow-hidden">
            <div
              className="h-full rounded-sm transition-all duration-500"
              style={{
                width: `${ctxPct}%`,
                background: ctxPct >= 75 ? 'var(--color-danger)' : ctxPct >= 50 ? 'var(--color-warning)' : 'var(--color-accent)',
              }}
            />
          </div>
          <span className="text-[10px] text-text-4 font-mono w-7 text-right">{ctxPct}%</span>
        </div>
      </div>
    </div>
  );
}

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// ── Boot Sequence Animation ──────────────────────────────────

function BootSequence({ agent }) {
  const [lines, setLines] = useState([]);
  const bootLines = [
    { text: `Initializing ${agent.name}`, delay: 0 },
    { text: `Role: ${agent.role}`, delay: 400 },
    { text: `Provider: ${agent.provider || 'claude-code'}`, delay: 700 },
    { text: 'Loading workspace context', delay: 1000 },
    { text: 'Scanning project structure', delay: 1400 },
    { text: 'Session active', delay: 1900 },
  ];

  useEffect(() => {
    const timers = bootLines.map((line, i) =>
      setTimeout(() => setLines((prev) => [...prev, i]), line.delay)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="flex flex-col px-4 pt-6">
      {/* Agent identity */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative w-9 h-9">
          <span className="absolute inset-0 rounded-full border-2 border-accent/20 animate-ping [animation-duration:2s]" />
          <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent animate-spin [animation-duration:1s]" />
          <span className="absolute inset-[5px] rounded-full bg-accent/8" />
        </div>
        <div>
          <p className="text-sm font-bold text-text-0 font-sans">{agent.name}</p>
          <p className="text-2xs text-accent font-mono">starting up</p>
        </div>
      </div>

      {/* Boot lines */}
      <div className="space-y-2 pl-3 border-l border-accent/15">
        {bootLines.map((line, i) => {
          const visible = lines.includes(i);
          const isLast = i === bootLines.length - 1;
          return (
            <div
              key={i}
              className={cn(
                'flex items-center gap-2.5 transition-all duration-300',
                visible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2',
              )}
            >
              <span className={cn(
                'w-1 h-1 rounded-full flex-shrink-0',
                isLast && visible ? 'bg-accent' : visible ? 'bg-text-3' : 'bg-transparent',
              )} />
              <span className={cn(
                'text-[11px] font-mono',
                isLast && visible ? 'text-accent' : 'text-text-3',
              )}>
                {line.text}
              </span>
              {isLast && visible && (
                <span className="flex gap-0.5 ml-1">
                  <span className="w-1 h-1 rounded-full bg-accent animate-pulse [animation-delay:0ms]" />
                  <span className="w-1 h-1 rounded-full bg-accent animate-pulse [animation-delay:200ms]" />
                  <span className="w-1 h-1 rounded-full bg-accent animate-pulse [animation-delay:400ms]" />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Snippet Tag ─────────────────────────────────────────────

function SnippetTag({ snippet, onRemove }) {
  const isCode = snippet.type === 'code';
  const Icon = isCode ? FileCode : Terminal;
  const lines = snippet.code.split('\n').length;
  let label;
  if (isCode && snippet.filePath) {
    const fileName = snippet.filePath.split('/').pop();
    label = `${fileName}:${snippet.lineStart}-${snippet.lineEnd}`;
  } else {
    label = `${isCode ? '' : 'Terminal · '}${lines} line${lines !== 1 ? 's' : ''}`;
  }
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/10 border border-accent/20 text-accent">
      <Icon size={11} className="flex-shrink-0" />
      <span className="text-2xs font-sans font-medium truncate max-w-[160px]">{label}</span>
      {snippet.instruction && (
        <span className="text-2xs text-accent/60 truncate max-w-[100px]">· {snippet.instruction}</span>
      )}
      <button onClick={onRemove} className="p-0.5 rounded hover:bg-accent/20 cursor-pointer flex-shrink-0">
        <X size={9} />
      </button>
    </div>
  );
}

// ── Main Feed ────────────────────────────────────────────────

export function AgentFeed({ agent }) {
  const rawChatHistory = useGrooveStore((s) => s.chatHistory[agent.id]) || EMPTY;
  const rawActivityLog = useGrooveStore((s) => s.activityLog[agent.id]) || EMPTY;
  const instructAgent = useGrooveStore((s) => s.instructAgent);
  const isThinking = useGrooveStore((s) => s.thinkingAgents?.has(agent.id));
  const cachedChatRef = useRef(EMPTY);
  const cachedActivityRef = useRef(EMPTY);
  if (rawChatHistory.length > 0) cachedChatRef.current = rawChatHistory;
  if (rawActivityLog.length > 0) cachedActivityRef.current = rawActivityLog;
  const chatHistory = rawChatHistory.length > 0 ? rawChatHistory : cachedChatRef.current;
  const activityLog = rawActivityLog.length > 0 ? rawActivityLog : cachedActivityRef.current;

  const pendingSnippet = useGrooveStore((s) => s.editorPendingSnippet);
  const clearSnippet = useGrooveStore((s) => s.clearSnippet);

  const storeInput = useGrooveStore((s) => s.chatInputs[agent.id] || '');
  const setStoreInput = (val) => useGrooveStore.setState((s) => {
    const current = s.chatInputs[agent.id] || '';
    const next = typeof val === 'function' ? val(current) : val;
    return { chatInputs: { ...s.chatInputs, [agent.id]: next } };
  });
  const input = storeInput;
  const setInput = setStoreInput;
  const [sending, setSending] = useState(false);
  const [inputHeight, setInputHeight] = useState(88);
  const [providerModels, setProviderModels] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const highlightRef = useRef(null);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    if (pendingSnippet) inputRef.current?.focus();
  }, [pendingSnippet]);

  useEffect(() => {
    if (!agent.provider) return;
    api.get('/providers').then((data) => {
      const p = (Array.isArray(data) ? data : []).find((pr) => pr.id === agent.provider);
      setProviderModels((p?.models || []).filter((m) => !m.disabled));
    }).catch(() => {});
  }, [agent.provider]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function handleScroll() {
      isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    }
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  const onDragStart = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = inputHeight;
    const onMove = (ev) => setInputHeight(Math.min(Math.max(56, startH - (ev.clientY - startY)), 280));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [inputHeight]);

  const timeline = useMemo(() => {
    const items = [];
    const seen = new Set();

    // Deduplicate chat messages (same text within 5s = duplicate)
    for (let ci = 0; ci < chatHistory.length; ci++) {
      const msg = chatHistory[ci];
      const key = `${msg.from}:${msg.text?.slice(0, 100)}`;
      const dupeWindow = items.find((i) => i.kind === 'chat' && `${i.from}:${i.text?.slice(0, 100)}` === key && Math.abs(i.ts - msg.timestamp) < 5000);
      if (dupeWindow) continue;
      items.push({ ...msg, kind: 'chat', ts: msg.timestamp, _chatIdx: ci });
      seen.add(msg.text);
    }

    const chatTexts = seen;

    const recentActivity = activityLog.slice(-30);
    for (const entry of recentActivity) {
      const text = (entry.text || '').trim();
      if (text && !chatTexts.has(entry.text)) {
        items.push({ ...entry, kind: 'activity', ts: entry.timestamp });
      }
    }

    items.sort((a, b) => a.ts - b.ts);

    const grouped = [];
    let activityBuf = [];
    for (const item of items) {
      if (item.kind === 'activity') {
        activityBuf.push(item);
      } else {
        if (activityBuf.length > 0) {
          grouped.push({ kind: 'activity-group', entries: activityBuf });
          activityBuf = [];
        }
        grouped.push(item);
      }
    }
    if (activityBuf.length > 0) {
      grouped.push({ kind: 'activity-group', entries: activityBuf });
    }

    return grouped;
  }, [chatHistory, activityLog]);

  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, [timeline.length, sending]);

  function getFileType(file) {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    return 'file';
  }

  async function handleFileSelect(e) {
    const files = Array.from(e.target.files || e.dataTransfer?.files || []);
    if (files.length === 0) return;

    const newPending = [];
    for (const file of files) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const type = getFileType(file);
      const entry = { id, name: file.name, size: file.size, type, status: 'reading', file };

      if (type === 'image' || type === 'video') {
        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        });
        entry.dataUrl = dataUrl;
      }
      entry.status = 'pending';
      newPending.push(entry);
    }

    setPendingFiles((prev) => [...prev, ...newPending]);
    if (e.target?.value != null) e.target.value = '';
    inputRef.current?.focus();
  }

  function removePendingFile(id) {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  }

  async function uploadPendingFiles() {
    if (pendingFiles.length === 0) return [];
    setUploading(true);
    const addToast = useGrooveStore.getState().addToast;
    const results = [];

    for (const pf of pendingFiles) {
      setPendingFiles((prev) => prev.map((f) => f.id === pf.id ? { ...f, status: 'uploading' } : f));
      try {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(pf.file);
        });
        await api.post(`/agents/${agent.id}/upload`, { filename: pf.name, content: base64 });
        setPendingFiles((prev) => prev.map((f) => f.id === pf.id ? { ...f, status: 'done' } : f));
        results.push({ name: pf.name, size: pf.size, type: pf.type, dataUrl: pf.dataUrl || null });
      } catch (err) {
        setPendingFiles((prev) => prev.map((f) => f.id === pf.id ? { ...f, status: 'error' } : f));
        addToast('error', `Upload failed: ${pf.name}`, err.message);
      }
    }
    setUploading(false);
    return results;
  }

  async function handleSend() {
    const text = input.trim();
    const hasFiles = pendingFiles.length > 0;
    if ((!text && !pendingSnippet && !hasFiles) || sending) return;

    if (text === '/rotate') {
      const rotateAgent = useGrooveStore.getState().rotateAgent;
      setInput('');
      try { await rotateAgent(agent.id); } catch {}
      return;
    }

    setSending(true);
    isAtBottomRef.current = true;

    let uploadedAttachments = [];
    if (hasFiles) {
      uploadedAttachments = await uploadPendingFiles();
    }

    const parts = [];
    if (text) parts.push(text);
    if (pendingSnippet) {
      const s = pendingSnippet;
      if (s.type === 'code' && s.filePath) {
        if (s.instruction && !text) parts.push(s.instruction);
        parts.push(`File: ${s.filePath} (lines ${s.lineStart}-${s.lineEnd})`);
        parts.push('```\n' + s.code + '\n```');
      } else if (s.code) {
        parts.push('```\n' + s.code + '\n```');
      }
    }

    if (uploadedAttachments.length > 0) {
      const names = uploadedAttachments.map((a) => a.name).join(', ');
      parts.push(`[Uploaded: ${names}] — I've uploaded these files to your working directory. Read them and use their content.`);
    }

    const message = parts.join('\n\n');

    const attachments = uploadedAttachments.length > 0 ? uploadedAttachments : undefined;
    setInput('');
    clearSnippet();
    setPendingFiles([]);

    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
    try {
      await instructAgent(agent.id, message, attachments);
    } catch { /* toast handles */ }
    setSending(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const isAlive = agent.status === 'running' || agent.status === 'starting';

  return (
    <div className="flex flex-col h-full min-h-0">
      {isAlive && <StreamingBar agent={agent} />}

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {!timeline.some((t) => t.from === 'agent' || t.kind === 'activity-group') && (
          isAlive ? (
            <BootSequence agent={agent} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center py-8">
              <div className="w-10 h-10 rounded-xl bg-surface-3 flex items-center justify-center mb-3">
                <MessageSquare size={18} className="text-text-4" />
              </div>
              <p className="text-sm font-semibold text-text-0 font-sans">{agent.name}</p>
              <p className="text-xs text-text-3 font-sans mt-1">Session complete — send a message to continue</p>
            </div>
          )
        )}
        {timeline.map((item, i) => {
          if (item.kind === 'activity-group') {
            const isLastGroup = !timeline.slice(i + 1).some((t) => t.kind === 'activity-group' || t.from === 'agent');
            return <div key={`grp-${item.entries[0]?.ts || i}`}><ActivityGroup entries={item.entries} isLive={isAlive && isLastGroup} /></div>;
          }
          if (item.from === 'user') return <UserMessage key={`user-${item._chatIdx}`} msg={item} />;
          if (item.from === 'system') return <SystemMessage key={`sys-${item._chatIdx}`} msg={item} />;
          return <AgentMessage key={`agent-${item._chatIdx}`} msg={item} agent={agent} />;
        })}
        <AnimatePresence>
          {(sending || isThinking) && (
            <motion.div
              key="thinking"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              <ThinkingIndicator agent={agent} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Input area */}
      <div className="bg-surface-1/50 flex-shrink-0">
        {/* Drag handle */}
        <div
          ref={dragRef}
          onMouseDown={onDragStart}
          className="flex items-center justify-center h-5 cursor-row-resize border-t border-border hover:bg-surface-3/50 transition-colors group"
        >
          <GripHorizontal size={12} className="text-text-4 group-hover:text-text-2 transition-colors" />
        </div>

        <div className="px-4 pb-3">
        {/* Snippet tag */}
        {pendingSnippet && (
          <div className="mb-2">
            <SnippetTag snippet={pendingSnippet} onRemove={clearSnippet} />
          </div>
        )}

        {/* Keeper command indicator */}
        {input && /\[(?:save|append|update|delete|view|doc|link|read|instruct)\]/i.test(input) && (() => {
          const cmdMatch = input.match(/\[(save|append|update|delete|view|doc|link|read|instruct)\]/i);
          const tags = (input.match(/#[\w/.-]+/g) || []);
          return (
            <div className="flex items-center gap-1.5 px-3 py-1 mb-2 rounded-lg bg-accent/5 border border-accent/10">
              <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent font-semibold font-mono text-[10px]">{cmdMatch[0]}</span>
              {tags.map((tag, i) => <span key={i} className="text-accent font-medium text-[10px]">{tag}</span>)}
              <span className="text-[10px] text-text-4 ml-auto">memory command</span>
            </div>
          );
        })()}

        <div
          className={cn(
            'flex flex-col rounded-lg border bg-surface-0 transition-colors overflow-hidden focus-within:border-text-4/40',
            dragOver ? 'border-accent border-dashed bg-accent/[0.03]' : 'border-border-subtle',
          )}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer?.files?.length) handleFileSelect(e);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,.pdf,.csv,.txt,.md,.json,.yaml,.yml,.docx,.pptx,.xlsx,.xml,.html,.py,.js,.ts,.jsx,.tsx,.go,.rs,.c,.cpp,.h,.java,.rb,.sh,.sql,.log"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Drag overlay */}
          {dragOver && (
            <div className="flex items-center justify-center gap-2 py-3 text-accent">
              <Upload size={16} />
              <span className="text-xs font-sans font-medium">Drop files here</span>
            </div>
          )}

          {/* Pending file previews */}
          {pendingFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2.5 pb-1">
              {pendingFiles.map((pf) => (
                <div key={pf.id} className={cn(
                  'relative group flex items-center gap-1.5 rounded-md border overflow-hidden',
                  pf.status === 'error' ? 'border-danger/30 bg-danger/5' : 'border-border-subtle bg-surface-2',
                  pf.status === 'uploading' && 'opacity-70',
                )}>
                  {pf.type === 'image' && pf.dataUrl ? (
                    <img src={pf.dataUrl} className="w-12 h-12 object-cover" alt={pf.name} />
                  ) : pf.type === 'video' && pf.dataUrl ? (
                    <div className="relative w-12 h-12">
                      <video src={pf.dataUrl} className="w-12 h-12 object-cover" muted />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <Film size={12} className="text-white" />
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 px-2 py-1.5">
                      <File size={12} className="text-text-3 flex-shrink-0" />
                      <span className="text-[11px] font-sans text-text-1 truncate max-w-[100px]">{pf.name}</span>
                      <span className="text-[10px] font-mono text-text-4">{formatFileSize(pf.size)}</span>
                    </div>
                  )}
                  {pf.status === 'uploading' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-surface-0/60">
                      <Loader2 size={14} className="text-accent animate-spin" />
                    </div>
                  )}
                  {pf.status === 'error' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-danger/10">
                      <AlertCircle size={14} className="text-danger" />
                    </div>
                  )}
                  <button
                    onClick={() => removePendingFile(pf.id)}
                    className="absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center rounded-full bg-surface-0/80 text-text-4 hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    <X size={9} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Textarea */}
          <div className="relative px-1">
            {input && KEEPER_DETECT_RE.test(input) && (
              <div
                ref={highlightRef}
                aria-hidden
                className="absolute inset-y-0 left-1 right-1 px-3 py-2.5 text-[13px] leading-[20px] font-sans pointer-events-none whitespace-pre-wrap break-words overflow-hidden"
                style={{ height: inputHeight }}
              >
                {highlightKeeperInput(input)}
              </div>
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              onScroll={(e) => { if (highlightRef.current) highlightRef.current.scrollTop = e.target.scrollTop; }}
              placeholder={pendingFiles.length > 0 ? 'Add a message (optional)...'
                : pendingSnippet ? 'Add a message (optional)...'
                : isAlive ? 'Send an instruction...' : 'Continue this session...'}
              rows={1}
              className={cn(
                'w-full resize-none px-3 py-2.5 text-[13px] leading-[20px]',
                'bg-transparent font-sans relative z-10 whitespace-pre-wrap break-words',
                'placeholder:text-text-4',
                'focus:outline-none',
                input && KEEPER_DETECT_RE.test(input)
                  ? 'text-transparent caret-text-0'
                  : 'text-text-0',
              )}
              style={{ height: inputHeight }}
            />
          </div>
          {/* Bottom toolbar */}
          <div className="flex items-center gap-1 px-1.5 pb-1.5 pt-0.5">
            {/* Left: attach */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer',
                pendingFiles.length > 0 ? 'text-accent hover:text-accent/80' : 'text-text-4 hover:text-text-1',
              )}
              title="Attach file"
            >
              <Paperclip size={14} />
            </button>
            {pendingFiles.length > 0 && (
              <span className="text-[10px] font-mono text-accent">{pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''}</span>
            )}
            {/* Model selector */}
            {providerModels.length > 1 && (
              <div className="relative flex items-center">
                <select
                  value={agent.model || ''}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    api.patch(`/agents/${agent.id}`, { model: e.target.value }).catch(() => {});
                  }}
                  className="h-7 pl-2 pr-5 text-[11px] font-mono bg-transparent text-text-3 hover:text-text-1 rounded-md cursor-pointer focus:outline-none appearance-none border-none"
                  title="Switch model"
                >
                  {providerModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.name || m.id}</option>
                  ))}
                </select>
                <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-4 pointer-events-none" />
              </div>
            )}
            {/* Pulsating activity indicator */}
            {isAlive && (
              <span className="relative flex items-center justify-center w-3 h-3 mr-auto">
                <span className="absolute inset-0 rounded-full bg-accent/30 animate-ping [animation-duration:2s]" />
                <span className="relative w-2 h-2 rounded-full bg-accent" />
              </span>
            )}
            <div className="flex-1" />
            {/* Right: pause (when alive) or send (when idle) */}
            {isAlive ? (
              <button
                onClick={() => useGrooveStore.getState().stopAgent(agent.id)}
                className="flex items-center gap-1.5 h-7 px-2 rounded-md text-text-0 hover:text-text-1 hover:bg-surface-3 transition-colors cursor-pointer"
              >
                <Pause size={13} />
                <span className="text-[11px] font-sans font-medium">Pause</span>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={(!input.trim() && !pendingSnippet && pendingFiles.length === 0) || sending}
                className={cn(
                  'w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer',
                  'disabled:opacity-15 disabled:cursor-not-allowed',
                  (input.trim() || pendingSnippet || pendingFiles.length > 0)
                    ? 'text-text-0 hover:text-text-1'
                    : 'text-text-4',
                )}
              >
                {sending ? <Loader2 size={15} className="animate-spin" /> : <SendHorizontal size={15} />}
              </button>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
