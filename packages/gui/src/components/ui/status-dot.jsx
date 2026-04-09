// FSL-1.1-Apache-2.0 — see LICENSE
import { cn } from '../../lib/cn';
import { statusColor } from '../../lib/status';

export function StatusDot({ status, size = 'md', className }) {
  const alive = status === 'running' || status === 'starting';
  const sizeClass = size === 'sm' ? 'w-1.5 h-1.5' : size === 'lg' ? 'w-3 h-3' : 'w-2 h-2';

  return (
    <span
      className={cn(
        'rounded-full inline-block flex-shrink-0',
        alive && 'animate-pulse',
        sizeClass,
        className,
      )}
      style={{ background: statusColor(status) }}
    />
  );
}
