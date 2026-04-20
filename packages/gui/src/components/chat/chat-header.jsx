// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect } from 'react';
import { Pencil, Pin, PinOff, Trash2, Hash, MoreHorizontal } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/badge';
import { fmtNum } from '../../lib/format';

export function ChatHeader({ conversation }) {
  const renameConversation = useGrooveStore((s) => s.renameConversation);
  const pinConversation = useGrooveStore((s) => s.pinConversation);
  const deleteConversation = useGrooveStore((s) => s.deleteConversation);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(conversation.title || '');
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef(null);
  const menuRef = useRef(null);

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
    <div className="h-11 flex items-center gap-3 px-4 border-b border-border bg-surface-1 flex-shrink-0">
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

      <div className="flex items-center gap-2 flex-shrink-0">
        {conversation.model && (
          <Badge variant="accent" className="text-[9px]">{conversation.model}</Badge>
        )}
        {conversation.provider && (
          <Badge variant="default" className="text-[9px]">{conversation.provider}</Badge>
        )}
        {tokens > 0 && (
          <span className="text-2xs text-text-3 font-mono">{fmtNum(tokens)} tokens</span>
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
