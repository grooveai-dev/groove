// FSL-1.1-Apache-2.0 — see LICENSE
import { ChevronRight } from 'lucide-react';

export function Breadcrumbs({ path }) {
  if (!path) return null;

  const segments = path.split('/').filter(Boolean);

  return (
    <div className="flex items-center h-7 px-3 bg-surface-2 border-b border-border-subtle text-2xs font-sans text-text-3 overflow-hidden flex-shrink-0 select-none">
      {segments.map((segment, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={i} className="flex items-center min-w-0">
            {i > 0 && <ChevronRight size={10} className="mx-0.5 flex-shrink-0 text-text-4" />}
            <span
              className={
                isLast
                  ? 'text-text-1 font-medium truncate'
                  : 'hover:text-text-1 cursor-pointer truncate transition-colors'
              }
            >
              {segment}
            </span>
          </span>
        );
      })}
    </div>
  );
}
