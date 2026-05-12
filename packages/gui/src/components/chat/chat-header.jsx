// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect } from 'react';
import { Pencil, Pin, PinOff, Trash2, Hash, MoreHorizontal, ChevronDown, X } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { fmtNum } from '../../lib/format';
import { ModelPicker, formatModelName } from './model-picker';
import { cn } from '../../lib/cn';
import { roleColor } from '../../lib/status';

const CHAT_ROLES = [
  { id: 'chat', label: 'Chat', desc: 'General conversation' },
  { id: 'research', label: 'Research Assistant', desc: 'Explore ideas, web search' },
  { id: 'fullstack', label: 'Fullstack', desc: 'End-to-end engineering' },
  { id: 'backend', label: 'Backend', desc: 'APIs, services, databases' },
  { id: 'frontend', label: 'Frontend', desc: 'UI, components, styling' },
  { id: 'devops', label: 'DevOps', desc: 'CI/CD, infra, deployment' },
  { id: 'security', label: 'Security', desc: 'Audits, vulnerabilities' },
  { id: 'database', label: 'Database', desc: 'Schema, migrations, queries' },
  { id: 'testing', label: 'Testing', desc: 'Tests, coverage, QA' },
  { id: 'docs', label: 'Docs', desc: 'Documentation, guides' },
  { id: 'cmo', label: 'CMO', desc: 'Marketing, content, growth' },
  { id: 'cfo', label: 'CFO', desc: 'Finance, metrics, forecasting' },
  { id: 'ea', label: 'EA', desc: 'Executive assistant' },
  { id: 'analyst', label: 'Analyst', desc: 'Data analysis, insights' },
  { id: 'creative', label: 'Writer', desc: 'Copy, articles, proposals' },
  { id: 'support', label: 'Support', desc: 'Customer support, FAQs' },
];

export function ChatHeader({ conversation, model, onModelChange, role, onRoleChange, sidebarCollapsed }) {
  const renameConversation = useGrooveStore((s) => s.renameConversation);
  const pinConversation = useGrooveStore((s) => s.pinConversation);
  const deleteConversation = useGrooveStore((s) => s.deleteConversation);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(conversation.title || '');
  const [menuOpen, setMenuOpen] = useState(false);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const roleMenuRef = useRef(null);

  useEffect(() => {
    setTitle(conversation.title || '');
    setEditing(false);
  }, [conversation.id, conversation.title]);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  useEffect(() => {
    if (!roleMenuOpen) return;
    function handleClick(e) {
      if (roleMenuRef.current && !roleMenuRef.current.contains(e.target)) setRoleMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [roleMenuOpen]);

  function handleRename() {
    const trimmed = title.trim();
    if (trimmed && trimmed !== conversation.title) {
      renameConversation(conversation.id, trimmed);
    } else {
      setTitle(conversation.title || '');
    }
    setEditing(false);
  }

  const agent = useGrooveStore((s) => s.agents.find((a) => a.id === conversation.agentId));
  const tokens = agent?.tokensUsed || 0;

  return (
    <div className={cn("h-12 flex items-center gap-3 border-b border-border-subtle bg-surface-0/80 flex-shrink-0", sidebarCollapsed ? 'pl-10 pr-4' : 'px-4')}>
      <Hash size={14} className="text-text-4 flex-shrink-0" />

      {editing ? (
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') { setTitle(conversation.title || ''); setEditing(false); } }}
          onBlur={handleRename}
          className="flex-1 min-w-0 bg-transparent text-sm font-semibold text-text-0 font-sans outline-none border-b border-accent"
          maxLength={100}
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="flex-1 min-w-0 text-left text-sm font-semibold text-text-0 font-sans truncate hover:text-accent transition-colors cursor-pointer"
        >
          {conversation.title || 'New Chat'}
        </button>
      )}

      <div className="w-px h-5 bg-border-subtle" />

      <div className="flex items-center gap-2 flex-shrink-0">
        <div ref={roleMenuRef} className="relative">
          <button
            onClick={() => setRoleMenuOpen(!roleMenuOpen)}
            className={cn(
              'flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-2xs font-semibold font-sans transition-colors cursor-pointer border',
              role
                ? 'border-current/20'
                : 'bg-surface-3 border-border-subtle text-text-3 hover:text-text-1',
            )}
            style={role ? { background: roleColor(role).bg, color: roleColor(role).text, borderColor: `${roleColor(role).border}33` } : undefined}
          >
            {role ? CHAT_ROLES.find((r) => r.id === role)?.label || role : 'Role'}
            {role ? (
              <X
                size={10}
                className="opacity-60 hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); onRoleChange?.(null); }}
              />
            ) : (
              <ChevronDown size={10} />
            )}
          </button>
          {roleMenuOpen && (
            <div className="absolute left-0 top-full mt-1 w-56 rounded-lg border border-border bg-surface-1 shadow-xl z-50 py-1 max-h-72 overflow-y-auto">
              {CHAT_ROLES.map((r) => {
                const rc = roleColor(r.id);
                const active = role === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => { onRoleChange?.(r.id); setRoleMenuOpen(false); }}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-3 cursor-pointer transition-colors',
                      active && 'bg-surface-3',
                    )}
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: rc.text }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold font-sans text-text-0">{r.label}</div>
                      <div className="text-2xs text-text-3 font-sans">{r.desc}</div>
                    </div>
                    {active && <span className="text-2xs text-accent font-mono">active</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <ModelPicker
          value={model || { provider: conversation.provider, model: conversation.model }}
          onChange={onModelChange}
          disabled={false}
        />

        {tokens > 0 && (
          <span className="text-2xs text-text-3 font-mono tabular-nums">{fmtNum(tokens)} tok</span>
        )}

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-3 hover:text-text-1 hover:bg-surface-3 transition-colors cursor-pointer"
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-40 rounded-md border border-border bg-surface-1 shadow-xl z-50 py-1">
              <button
                onClick={() => { setEditing(true); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text-1 hover:bg-surface-5 cursor-pointer font-sans"
              >
                <Pencil size={12} /> Rename
              </button>
              <button
                onClick={() => { pinConversation(conversation.id, !conversation.pinned); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text-1 hover:bg-surface-5 cursor-pointer font-sans"
              >
                {conversation.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                {conversation.pinned ? 'Unpin' : 'Pin'}
              </button>
              <div className="h-px my-1 bg-border-subtle" />
              <button
                onClick={() => { deleteConversation(conversation.id); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-danger hover:bg-danger/10 cursor-pointer font-sans"
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
