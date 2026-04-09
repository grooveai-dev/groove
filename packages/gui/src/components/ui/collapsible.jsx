// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';

export function Collapsible({ title, icon: Icon, defaultOpen = false, badge, children, className }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn('border-t border-border-subtle', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-5 py-3 text-left cursor-pointer hover:bg-surface-5/30 transition-colors group"
      >
        <ChevronRight
          size={12}
          className={cn(
            'text-text-4 transition-transform duration-200 flex-shrink-0',
            open && 'rotate-90',
          )}
        />
        {Icon && <Icon size={13} className="text-text-3 flex-shrink-0" />}
        <span className="text-xs font-semibold text-text-2 font-sans uppercase tracking-wider flex-1">
          {title}
        </span>
        {badge && (
          <span className="text-2xs font-mono text-text-4 bg-surface-4 px-1.5 py-0.5 rounded">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div className="px-5 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}
