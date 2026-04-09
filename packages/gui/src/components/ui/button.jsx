// FSL-1.1-Apache-2.0 — see LICENSE
import { forwardRef } from 'react';
import { cn } from '../../lib/cn';

const variants = {
  primary:   'bg-accent/20 text-accent border border-accent/25 hover:bg-accent/30 font-medium',
  secondary: 'bg-surface-5/40 text-text-1 border border-border-subtle hover:bg-surface-5/70 hover:text-text-0',
  ghost:     'bg-transparent text-text-2 border border-transparent hover:bg-surface-5/50 hover:text-text-0',
  danger:    'bg-danger/12 text-danger border border-danger/15 hover:bg-danger/20',
  info:      'bg-info/12 text-info border border-info/15 hover:bg-info/20',
  outline:   'bg-transparent text-accent border border-accent/30 hover:bg-accent/10',
};

const sizes = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded',
  md: 'h-8 px-3 text-sm gap-2 rounded',
  lg: 'h-9 px-4 text-sm gap-2 rounded',
  icon: 'h-8 w-8 rounded',
};

const Button = forwardRef(({ className, variant = 'secondary', size = 'md', children, ...props }, ref) => {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center font-sans transition-colors duration-100',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
        'disabled:opacity-40 disabled:pointer-events-none',
        'cursor-pointer select-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

Button.displayName = 'Button';
export { Button };
