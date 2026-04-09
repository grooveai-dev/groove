// FSL-1.1-Apache-2.0 — see LICENSE
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/cn';

export function Tabs({ children, ...props }) {
  return <TabsPrimitive.Root {...props}>{children}</TabsPrimitive.Root>;
}

export function TabsList({ children, className, ...props }) {
  return (
    <TabsPrimitive.List
      className={cn(
        'flex items-center gap-0 border-b border-border-subtle',
        className,
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({ children, className, ...props }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'px-3 py-2 text-sm font-medium font-sans text-text-2',
        'border-b-2 border-transparent',
        'hover:text-text-0 hover:bg-surface-5/50',
        'data-[state=active]:text-text-0 data-[state=active]:border-accent',
        'transition-colors duration-100 cursor-pointer select-none',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
        className,
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ children, className, ...props }) {
  return (
    <TabsPrimitive.Content
      className={cn('flex-1 min-h-0', className)}
      {...props}
    >
      {children}
    </TabsPrimitive.Content>
  );
}
