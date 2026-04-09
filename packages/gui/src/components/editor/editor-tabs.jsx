// FSL-1.1-Apache-2.0 — see LICENSE
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { X } from 'lucide-react';

export function EditorTabs() {
  const openTabs = useGrooveStore((s) => s.editorOpenTabs);
  const activeFile = useGrooveStore((s) => s.editorActiveFile);
  const files = useGrooveStore((s) => s.editorFiles);
  const setActiveFile = useGrooveStore((s) => s.setActiveFile);
  const closeFile = useGrooveStore((s) => s.closeFile);

  if (openTabs.length === 0) return null;

  return (
    <div className="flex items-center h-8 bg-surface-3 border-b border-border overflow-x-auto flex-shrink-0">
      {openTabs.map((path) => {
        const isActive = path === activeFile;
        const file = files[path];
        const isDirty = file && file.content !== file.originalContent;
        const name = path.split('/').pop();

        return (
          <div
            key={path}
            className={cn(
              'flex items-center gap-1.5 h-full px-3 text-xs font-sans cursor-pointer select-none',
              'border-r border-border-subtle',
              'transition-colors duration-75',
              isActive
                ? 'bg-surface-2 text-text-0 border-b-2 border-b-accent'
                : 'bg-surface-3 text-text-3 hover:text-text-1 hover:bg-surface-4',
            )}
            onClick={() => setActiveFile(path)}
          >
            <span className="truncate max-w-[120px]">{name}</span>
            {isDirty && (
              <span className="w-1.5 h-1.5 rounded-full bg-warning flex-shrink-0" />
            )}
            <button
              onClick={(e) => { e.stopPropagation(); closeFile(path); }}
              className="p-0.5 rounded hover:bg-surface-5 text-text-4 hover:text-text-1 transition-colors cursor-pointer ml-0.5"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
