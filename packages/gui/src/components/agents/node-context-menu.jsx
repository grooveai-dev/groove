// FSL-1.1-Apache-2.0 — see LICENSE
import { MessageSquare, BarChart3, RotateCw, Copy, Skull, ClipboardCopy, Settings } from 'lucide-react';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent,
  ContextMenuItem, ContextMenuSeparator,
} from '../ui/context-menu';

export function NodeContextMenu({ children, agent, onChat, onStats, onActions, onRotate, onClone, onKill }) {
  const isAlive = agent.status === 'running' || agent.status === 'starting';

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onChat}>
          <MessageSquare size={14} /> Chat
        </ContextMenuItem>
        <ContextMenuItem onSelect={onStats}>
          <BarChart3 size={14} /> Stats
        </ContextMenuItem>
        <ContextMenuItem onSelect={onActions}>
          <Settings size={14} /> Actions
        </ContextMenuItem>
        <ContextMenuSeparator />
        {isAlive && (
          <ContextMenuItem onSelect={onRotate}>
            <RotateCw size={14} /> Rotate
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={onClone}>
          <Copy size={14} /> Clone
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => navigator.clipboard.writeText(agent.id)}>
          <ClipboardCopy size={14} /> Copy ID
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem danger onSelect={onKill}>
          <Skull size={14} /> Kill
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
