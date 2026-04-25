// FSL-1.1-Apache-2.0 — see LICENSE
import { useMemo } from 'react';
import { SquarePen, MessageCircle, Pin, Pencil, PinOff, Trash2, Zap, Bot, PanelLeftClose } from 'lucide-react';
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
      <span className="text-2xs font-semibold text-text-4 uppercase tracking-wider font-sans">{label}</span>
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
            'w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors cursor-pointer group border-b border-border-subtle/50',
            isActive
              ? 'text-text-0'
              : 'text-text-2 hover:bg-surface-3/40 hover:text-text-1',
          )}
        >
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium font-sans truncate">{conv.title || 'New Chat'}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {conv.mode === 'agent'
                ? <Bot size={9} className="text-purple flex-shrink-0" />
                : <Zap size={9} className="text-accent flex-shrink-0" />
              }
              {conv.model && <Badge variant="default" className="text-[8px] px-1 py-0">{formatModelName(conv.model)}</Badge>}
              <span className="text-2xs text-text-4 font-sans">{timeAgo(conv.updatedAt || conv.createdAt)}</span>
            </div>
          </div>
          {conv.pinned && <Pin size={10} className="text-accent flex-shrink-0" />}
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

export function ConversationList({ onNewChat, onCollapse }) {
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
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-xs font-semibold text-text-2 font-sans">Chats</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onNewChat}
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-3 hover:text-text-0 hover:bg-surface-3 transition-colors cursor-pointer"
            title="New chat"
          >
            <SquarePen size={15} />
          </button>
          <button
            onClick={onCollapse}
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-3 hover:text-text-0 hover:bg-surface-3 transition-colors cursor-pointer"
            title="Collapse sidebar"
          >
            <PanelLeftClose size={15} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pt-1 pb-3">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <MessageCircle size={24} className="text-text-4 mb-3" />
            <p className="text-xs text-text-3 font-sans">No conversations yet</p>
            <p className="text-2xs text-text-4 font-sans mt-1">Start a new chat to begin</p>
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
    </div>
  );
}
