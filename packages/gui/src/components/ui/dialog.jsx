// FSL-1.1-Apache-2.0 — see LICENSE
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

export function Dialog({ children, ...props }) {
  return <DialogPrimitive.Root {...props}>{children}</DialogPrimitive.Root>;
}

export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({ children, className, title, description, ...props }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
          'w-full max-w-lg max-h-[85vh] overflow-y-auto',
          'bg-surface-1 border border-border rounded-lg shadow-2xl',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          className,
        )}
        {...props}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
            <DialogPrimitive.Title className="text-base font-semibold text-text-0 font-sans">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close className="p-1 rounded-md text-text-3 hover:text-text-0 hover:bg-surface-5 transition-colors">
              <X size={16} />
            </DialogPrimitive.Close>
          </div>
        )}
        {description && (
          <DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description>
        )}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
