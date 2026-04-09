// FSL-1.1-Apache-2.0 — see LICENSE
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { cn } from '../../lib/cn';

export function ScrollArea({ children, className, ...props }) {
  return (
    <ScrollAreaPrimitive.Root className={cn('overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex touch-none select-none p-0.5 transition-colors w-2"
      >
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-surface-5 hover:bg-surface-6" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Scrollbar
        orientation="horizontal"
        className="flex touch-none select-none flex-col p-0.5 transition-colors h-2"
      >
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-surface-5 hover:bg-surface-6" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}
