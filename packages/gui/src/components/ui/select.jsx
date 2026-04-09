// FSL-1.1-Apache-2.0 — see LICENSE
import * as SelectPrimitive from '@radix-ui/react-select';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '../../lib/cn';

export function Select({ children, ...props }) {
  return <SelectPrimitive.Root {...props}>{children}</SelectPrimitive.Root>;
}

export function SelectTrigger({ children, className, placeholder, ...props }) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex h-8 w-full items-center justify-between rounded-md px-3 text-sm',
        'bg-surface-1 border border-border text-text-0 font-sans',
        'focus:outline-none focus:ring-1 focus:ring-accent',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'cursor-pointer select-none',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Value placeholder={placeholder} />
      <SelectPrimitive.Icon>
        <ChevronDown size={14} className="text-text-3" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ children, className, ...props }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        sideOffset={4}
        className={cn(
          'z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md',
          'bg-surface-1 border border-border shadow-xl',
          'animate-in fade-in-0 zoom-in-95',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="py-1">
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ children, className, ...props }) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-sm font-sans cursor-pointer select-none',
        'text-text-1 outline-none',
        'focus:bg-surface-5 focus:text-text-0',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="ml-auto">
        <Check size={14} className="text-accent" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export function SelectGroup({ children, label, ...props }) {
  return (
    <SelectPrimitive.Group {...props}>
      {label && (
        <SelectPrimitive.Label className="px-3 py-1 text-2xs font-semibold text-text-3 uppercase tracking-wider">
          {label}
        </SelectPrimitive.Label>
      )}
      {children}
    </SelectPrimitive.Group>
  );
}
