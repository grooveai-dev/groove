// FSL-1.1-Apache-2.0 — see LICENSE
import { cn } from '../../lib/cn';

const DEFAULT_CATEGORIES = [
  { id: '', label: 'All' },
  { id: 'design', label: 'Design' },
  { id: 'quality', label: 'Quality' },
  { id: 'devtools', label: 'Dev Tools' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'security', label: 'Security' },
  { id: 'specialized', label: 'Specialized' },
];

export function CategoryBar({ selected = '', categories = DEFAULT_CATEGORIES, onSelect }) {
  return (
    <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
      {categories.map((cat) => {
        const active = selected === cat.id;
        return (
          <button
            key={cat.id}
            onClick={() => onSelect(cat.id)}
            className={cn(
              'whitespace-nowrap font-sans cursor-pointer select-none transition-all text-[13px] rounded-full border',
              active
                ? 'bg-accent text-surface-0 border-accent font-semibold'
                : 'bg-surface-1 text-text-3 border-border-subtle hover:text-text-1 hover:border-border font-medium',
            )}
            style={{ padding: '7px 16px' }}
          >
            {cat.label}
          </button>
        );
      })}
    </div>
  );
}
