// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useState, useEffect, useCallback } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { X, ChevronLeft, ChevronRight, Copy, XCircle } from 'lucide-react';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from '../ui/context-menu';

export function EditorTabs() {
  const openTabs = useGrooveStore((s) => s.editorOpenTabs);
  const activeFile = useGrooveStore((s) => s.editorActiveFile);
  const files = useGrooveStore((s) => s.editorFiles);
  const setActiveFile = useGrooveStore((s) => s.setActiveFile);
  const closeFile = useGrooveStore((s) => s.closeFile);

  const scrollRef = useRef(null);
  const [overflows, setOverflows] = useState(false);

  const checkOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (el) setOverflows(el.scrollWidth > el.clientWidth);
  }, []);

  useEffect(() => {
    checkOverflow();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(checkOverflow);
    ro.observe(el);
    return () => ro.disconnect();
  }, [checkOverflow, openTabs.length]);

  function scrollLeft() {
    scrollRef.current?.scrollBy({ left: -120, behavior: 'smooth' });
  }
  function scrollRight() {
    scrollRef.current?.scrollBy({ left: 120, behavior: 'smooth' });
  }

  function closeOthers(path) {
    openTabs.filter((t) => t !== path).forEach((t) => closeFile(t));
  }
  function closeAll() {
    [...openTabs].forEach((t) => closeFile(t));
  }
  function closeToRight(path) {
    const idx = openTabs.indexOf(path);
    openTabs.slice(idx + 1).forEach((t) => closeFile(t));
  }
  function copyPath(path) {
    navigator.clipboard?.writeText(path);
  }

  if (openTabs.length === 0) return null;

  return (
    <div className="flex items-center h-8 bg-surface-3 border-b border-border flex-shrink-0">
      {overflows && (
        <button onClick={scrollLeft} className="flex-shrink-0 px-1 h-full text-text-4 hover:text-text-1 hover:bg-surface-4 transition-colors cursor-pointer">
          <ChevronLeft size={14} />
        </button>
      )}

      <div ref={scrollRef} className="flex items-center flex-1 min-w-0 overflow-x-auto scrollbar-none scroll-smooth" style={{ scrollSnapType: 'x mandatory' }}>
        {openTabs.map((path) => {
          const isActive = path === activeFile;
          const file = files[path];
          const isDirty = file && file.content !== file.originalContent;
          const name = path.split('/').pop();

          return (
            <ContextMenu key={path}>
              <ContextMenuTrigger asChild>
                <div
                  className={cn(
                    'flex items-center gap-1.5 h-full px-3 text-xs font-sans cursor-pointer select-none',
                    'border-r border-border-subtle',
                    'transition-colors duration-75 flex-shrink-0',
                    isActive
                      ? 'bg-surface-2 text-text-0 border-b-2 border-b-accent'
                      : 'bg-surface-3 text-text-3 hover:text-text-1 hover:bg-surface-4',
                  )}
                  style={{ scrollSnapAlign: 'start' }}
                  onClick={() => setActiveFile(path)}
                  onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeFile(path); } }}
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
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => closeFile(path)}>
                  <X size={12} className="text-text-3" /> Close
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => closeOthers(path)}>
                  <XCircle size={12} className="text-text-3" /> Close Others
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => closeAll()}>
                  <XCircle size={12} className="text-text-3" /> Close All
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => closeToRight(path)}>
                  <ChevronRight size={12} className="text-text-3" /> Close to the Right
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => copyPath(path)}>
                  <Copy size={12} className="text-text-3" /> Copy Path
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>

      {overflows && (
        <button onClick={scrollRight} className="flex-shrink-0 px-1 h-full text-text-4 hover:text-text-1 hover:bg-surface-4 transition-colors cursor-pointer">
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}
