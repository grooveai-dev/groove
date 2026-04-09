// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useCallback } from 'react';
import { Maximize2, Minimize2, Plus, X, Terminal } from 'lucide-react';
import { cn } from '../../lib/cn';

export function TerminalPanel({
  children,
  height,
  onHeightChange,
  visible,
  fullHeight,
  tabs,
  activeTab,
  onSelectTab,
  onAddTab,
  onCloseTab,
  onToggleFullHeight,
  onMinimize,
}) {
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const onMouseDown = useCallback((e) => {
    if (fullHeight) return;
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startH.current = height;

    function onMouseMove(e) {
      if (!dragging.current) return;
      const delta = startY.current - e.clientY;
      const newH = Math.min(Math.max(startH.current + delta, 120), 600);
      onHeightChange(newH);
    }

    function onMouseUp() {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [height, onHeightChange, fullHeight]);

  if (!visible) return null;

  const tabList = tabs || [{ id: 'default', label: 'Terminal' }];

  return (
    <div
      className="flex flex-col border-t border-border bg-surface-0 relative"
      style={fullHeight ? { flex: 1, minHeight: 0 } : { height, flexShrink: 0 }}
    >
      {/* Resize handle */}
      {!fullHeight && (
        <div
          className="absolute top-0 left-0 right-0 h-1 cursor-row-resize hover:bg-accent/30 transition-colors z-10"
          onMouseDown={onMouseDown}
        />
      )}

      {/* Header bar */}
      <div className="flex items-center h-9 bg-surface-1 border-b border-border-subtle flex-shrink-0 pl-3 pr-1.5">
        {/* Tabs */}
        <div className="flex items-center gap-0 flex-1 min-w-0 overflow-x-auto scrollbar-none">
          {tabList.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onSelectTab?.(tab.id)}
              className={cn(
                'flex items-center gap-1.5 pl-2.5 pr-1 h-7 text-2xs font-sans cursor-pointer select-none transition-colors flex-shrink-0 rounded-t',
                tab.id === activeTab
                  ? 'text-text-0 bg-surface-0'
                  : 'text-text-3 hover:text-text-1 hover:bg-surface-0/50',
              )}
            >
              <Terminal size={10} />
              <span className="truncate max-w-[80px]">{tab.label}</span>
              {tabList.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onCloseTab?.(tab.id); }}
                  className="ml-0.5 p-0.5 rounded hover:bg-surface-5 text-text-4 hover:text-text-1 cursor-pointer"
                >
                  <X size={9} />
                </button>
              )}
            </button>
          ))}
          <button
            onClick={onAddTab}
            className="flex items-center justify-center w-6 h-6 text-text-4 hover:text-text-1 hover:bg-surface-0/50 rounded cursor-pointer transition-colors flex-shrink-0 ml-0.5"
            title="New terminal"
          >
            <Plus size={11} />
          </button>
        </div>

        {/* Window controls */}
        <div className="flex items-center gap-0.5 flex-shrink-0 ml-2">
          {fullHeight ? (
            <button
              onClick={onMinimize}
              className="p-1.5 rounded text-text-3 hover:text-text-0 hover:bg-surface-5 cursor-pointer transition-colors"
              title="Restore"
            >
              <Minimize2 size={12} />
            </button>
          ) : (
            <button
              onClick={onToggleFullHeight}
              className="p-1.5 rounded text-text-3 hover:text-text-0 hover:bg-surface-5 cursor-pointer transition-colors"
              title="Maximize"
            >
              <Maximize2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Terminal content */}
      <div className="flex-1 min-h-0 p-2">
        {children}
      </div>
    </div>
  );
}
