// FSL-1.1-Apache-2.0 — see LICENSE
import { forwardRef } from 'react';
import { cn } from '../../lib/cn';

const Input = forwardRef(({ className, label, error, mono, ...props }, ref) => {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-xs font-medium text-text-2 font-sans">{label}</label>
      )}
      <input
        ref={ref}
        className={cn(
          'h-8 w-full rounded-md px-3 text-sm',
          'bg-surface-1 border border-border text-text-0',
          'placeholder:text-text-4',
          'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          'transition-colors duration-100',
          mono ? 'font-mono' : 'font-sans',
          error && 'border-danger focus:ring-danger',
          className,
        )}
        {...props}
      />
      {error && (
        <span className="text-2xs text-danger font-sans">{error}</span>
      )}
    </div>
  );
});

Input.displayName = 'Input';

const Textarea = forwardRef(({ className, label, error, mono, ...props }, ref) => {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-xs font-medium text-text-2 font-sans">{label}</label>
      )}
      <textarea
        ref={ref}
        className={cn(
          'w-full rounded-md px-3 py-2 text-sm resize-none',
          'bg-surface-1 border border-border text-text-0',
          'placeholder:text-text-4',
          'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          'transition-colors duration-100',
          mono ? 'font-mono' : 'font-sans',
          error && 'border-danger focus:ring-danger',
          className,
        )}
        {...props}
      />
      {error && (
        <span className="text-2xs text-danger font-sans">{error}</span>
      )}
    </div>
  );
});

Textarea.displayName = 'Textarea';

export { Input, Textarea };
