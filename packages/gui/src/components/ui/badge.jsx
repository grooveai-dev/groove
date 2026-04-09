// FSL-1.1-Apache-2.0 — see LICENSE
import { cn } from '../../lib/cn';

const variants = {
  default:  'bg-surface-4 text-text-2',
  accent:   'bg-accent/12 text-accent',
  success:  'bg-success/12 text-success',
  warning:  'bg-warning/12 text-warning',
  danger:   'bg-danger/12 text-danger',
  info:     'bg-info/12 text-info',
  purple:   'bg-purple/12 text-purple',
  orange:   'bg-orange/12 text-orange',
};

export function Badge({ children, variant = 'default', className, dot, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5',
        'text-2xs font-semibold uppercase tracking-wider rounded',
        'font-sans select-none whitespace-nowrap',
        variants[variant],
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn('w-1.5 h-1.5 rounded-full', dot === 'pulse' && 'animate-pulse')}
          style={{ background: 'currentColor' }}
        />
      )}
      {children}
    </span>
  );
}
