// FSL-1.1-Apache-2.0 — see LICENSE
import { cn } from '../../lib/cn';

export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        'rounded-md bg-surface-4',
        'bg-gradient-to-r from-surface-4 via-surface-5 to-surface-4',
        'bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite]',
        className,
      )}
      {...props}
    />
  );
}

export function SkeletonText({ lines = 3, className }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn('h-3', i === lines - 1 && 'w-3/4')}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }) {
  return (
    <div className={cn('rounded-md border border-border-subtle bg-surface-1 p-4 space-y-3', className)}>
      <div className="flex items-center gap-3">
        <Skeleton className="w-8 h-8 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2.5 w-16" />
        </div>
      </div>
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-2 w-4/5" />
    </div>
  );
}
