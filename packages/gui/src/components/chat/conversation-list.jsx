// FSL-1.1-Apache-2.0 — see LICENSE
import { useMemo } from 'react';
import { Plus, MessageCircle, Pin, Pencil, PinOff, Trash2, Zap, Bot } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/badge';
import { timeAgo } from '../../lib/format';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '../ui/context-menu';
import { formatModelName } from './model-picker';

function groupByDate(conversations) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);

  const groups = { pinned: [], today: [], yesterday: [], week: [], older: [] };

  for (const conv of conversations) {
    if (conv.pinned) { groups.pinned.push(conv); continue; }
    const d = new Date(conv.updatedAt || conv.createdAt);
    if (d >= today) groups.today.push(conv);
    else if (d >= yesterday) groups.yesterday.push(conv);
    else if (d >= weekAgo) groups.week.push(conv);
    else groups.older.push(conv);
  }

  return groups;
}

function GroupLabel({ label }) {
  return (
    <div className="px-3 pt-4 pb-1.5">
      <span className="text-2xs font-semibold text-white/60 uppercase tracking-wider font-sans">{label}</span>
    </div>
  );
}

function ConversationItem({ conv, isActive, onSelect, onRename, onPin, onDelete }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          onClick={() => onSelect(conv.id)}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 text-left rounded-md transition-colors cursor-pointer group',
            isActive
              ? 'bg-white/15 text-white'
              : 'text-white/80 hover:bg-white/10 hover:text-white',
          )}
        >
          <MessageCircle size={13} className={cn('flex-shrink-0', isActive ? 'text-white' : 'text-white/50 group-hover:text-white/70')} />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium font-sans truncate text-white">{conv.title || 'New Chat'}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {conv.mode === 'agent'
                ? <Bot size={9} className="text-white/70 flex-shrink-0" />
                : <Zap size={9} className="text-white/70 flex-shrink-0" />
              }
              {conv.model && <Badge variant="default" className="text-[8px] px-1 py-0">{formatModelName(conv.model)}</Badge>}
              <span className="text-2xs text-white/50 font-sans">{timeAgo(conv.updatedAt || conv.createdAt)}</span>
            </div>
          </div>
          {conv.pinned && <Pin size={10} className="text-white flex-shrink-0" />}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onRename(conv)}>
          <Pencil size={12} /> Rename
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onPin(conv)}>
          {conv.pinned ? <PinOff size={12} /> : <Pin size={12} />}
          {conv.pinned ? 'Unpin' : 'Pin'}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem danger onSelect={() => onDelete(conv.id)}>
          <Trash2 size={12} /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function ConversationList({ onNewChat }) {
  const conversations = useGrooveStore((s) => s.conversations);
  const activeConversationId = useGrooveStore((s) => s.activeConversationId);
  const setActiveConversation = useGrooveStore((s) => s.setActiveConversation);
  const renameConversation = useGrooveStore((s) => s.renameConversation);
  const pinConversation = useGrooveStore((s) => s.pinConversation);
  const deleteConversation = useGrooveStore((s) => s.deleteConversation);

  const groups = useMemo(() => groupByDate(conversations), [conversations]);

  function handleRename(conv) {
    const name = prompt('Rename conversation:', conv.title || '');
    if (name && name.trim()) renameConversation(conv.id, name.trim());
  }

  function handlePin(conv) {
    pinConversation(conv.id, !conv.pinned);
  }

  const renderGroup = (label, items) => {
    if (items.length === 0) return null;
    return (
      <div key={label}>
        <GroupLabel label={label} />
        {items.map((conv) => (
          <ConversationItem
            key={conv.id}
            conv={conv}
            isActive={conv.id === activeConversationId}
            onSelect={setActiveConversation}
            onRename={handleRename}
            onPin={handlePin}
            onDelete={deleteConversation}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-1.5 pt-3 pb-3 space-y-0.5">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <MessageCircle size={24} className="text-white/50 mb-3" />
            <p className="text-xs text-white/80 font-sans">No conversations yet</p>
            <p className="text-2xs text-white/60 font-sans mt-1">Start a new chat to begin</p>
          </div>
        ) : (
          <>
            {renderGroup('Pinned', groups.pinned)}
            {renderGroup('Today', groups.today)}
            {renderGroup('Yesterday', groups.yesterday)}
            {renderGroup('Previous 7 Days', groups.week)}
            {renderGroup('Older', groups.older)}
          </>
        )}
      </div>

      <div className="p-3 border-t border-white/15">
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-2 h-9 rounded-lg bg-white/15 text-white text-xs font-semibold font-sans hover:bg-white/25 transition-colors cursor-pointer border border-white/20"
        >
          <Plus size={14} />
          New Chat
        </button>
      </div>
    </div>
  );
}
