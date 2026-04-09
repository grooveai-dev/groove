// FSL-1.1-Apache-2.0 — see LICENSE
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '../../lib/cn';

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export function DropdownMenuContent({ children, className, ...props }) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={4}
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
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({ children, className, danger, ...props }) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-sm font-sans cursor-pointer select-none',
        'outline-none transition-colors',
        danger
          ? 'text-danger focus:bg-danger/10'
          : 'text-text-1 focus:bg-surface-5 focus:text-text-0',
        className,
      )}
      {...props}
    >
      {children}
    </DropdownPrimitive.Item>
  );
}

export function DropdownMenuSeparator({ className }) {
  return (
    <DropdownPrimitive.Separator className={cn('h-px my-1 bg-border-subtle', className)} />
  );
}

export function DropdownMenuLabel({ children, className }) {
  return (
    <DropdownPrimitive.Label
      className={cn('px-3 py-1 text-2xs font-semibold text-text-3 uppercase tracking-wider', className)}
    >
      {children}
    </DropdownPrimitive.Label>
  );
}
