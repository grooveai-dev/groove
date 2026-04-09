// FSL-1.1-Apache-2.0 — see LICENSE
import { cn } from '../../lib/cn';
import { roleColor } from '../../lib/status';

function getInitials(name) {
  if (!name) return '?';
  return name
    .split(/[\s\-_]+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function Avatar({ name, role, size = 'md', spinning, className }) {
  const colors = roleColor(role);
  const sizeClasses = {
    sm: 'w-6 h-6 text-2xs',
    md: 'w-7 h-7 text-xs',
    lg: 'w-10 h-10 text-sm',
  };

  return (
    <div className={cn('relative inline-flex', className)}>
      {spinning && (
        <div
          className="absolute inset-[-2px] rounded-full animate-[spin-slow_3s_linear_infinite]"
          style={{
            background: `conic-gradient(${colors.border}, transparent, ${colors.border})`,
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))',
            WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))',
          }}
        />
      )}
      <div
        className={cn(
          'rounded-full flex items-center justify-center font-semibold font-sans select-none',
          sizeClasses[size],
        )}
        style={{ background: colors.bg, color: colors.text }}
      >
        {getInitials(name)}
      </div>
    </div>
  );
}
