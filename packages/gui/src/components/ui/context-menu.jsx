// FSL-1.1-Apache-2.0 — see LICENSE
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { cn } from '../../lib/cn';

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export function ContextMenuContent({ children, className, ...props }) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn(
          'z-50 min-w-[160px] overflow-hidden rounded-md',
          'bg-surface-1 border border-border shadow-xl',
          'py-1',
          'animate-in fade-in-0 zoom-in-95',
          className,
        )}
        {...props}
      >
        {children}
      </ContextMenuPrimitive.Content>
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuItem({ children, className, danger, ...props }) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-sm font-sans cursor-pointer select-none outline-none',
        danger
          ? 'text-danger focus:bg-danger/10'
          : 'text-text-1 focus:bg-surface-5 focus:text-text-0',
        className,
      )}
      {...props}
    >
      {children}
    </ContextMenuPrimitive.Item>
  );
}

export function ContextMenuSeparator({ className }) {
  return (
    <ContextMenuPrimitive.Separator className={cn('h-px my-1 bg-border-subtle', className)} />
  );
}
