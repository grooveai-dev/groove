// FSL-1.1-Apache-2.0 — see LICENSE
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

export function Sheet({ children, ...props }) {
  return <DialogPrimitive.Root {...props}>{children}</DialogPrimitive.Root>;
}

export const SheetTrigger = DialogPrimitive.Trigger;

export function SheetContent({ children, className, title, side = 'right', width = 400, onClose, ...props }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/30" />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-0 z-50 h-full overflow-y-auto',
          'bg-surface-1 border-l border-border shadow-2xl',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          side === 'right' && 'right-0 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
          side === 'left' && 'left-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
          className,
        )}
        style={{ width }}
        {...props}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle sticky top-0 bg-surface-1 z-10">
            <DialogPrimitive.Title className="text-base font-semibold text-text-0 font-sans">
              {title}
            </DialogPrimitive.Title>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-text-3 hover:text-text-0 hover:bg-surface-5 transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <DialogPrimitive.Description className="sr-only">Panel</DialogPrimitive.Description>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
