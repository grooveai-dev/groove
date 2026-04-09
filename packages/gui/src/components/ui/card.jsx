// FSL-1.1-Apache-2.0 — see LICENSE
import { cn } from '../../lib/cn';

export function Card({ children, className, hover, ...props }) {
  return (
    <div
      className={cn(
        'rounded-md border border-border bg-surface-1',
        hover && 'hover:border-accent/50 hover:bg-surface-2 transition-all duration-150 cursor-pointer',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }) {
  return (
    <div className={cn('px-4 py-3 border-b border-border-subtle', className)}>
      {children}
    </div>
  );
}

export function CardContent({ children, className }) {
  return (
    <div className={cn('px-4 py-3', className)}>
      {children}
    </div>
  );
}
