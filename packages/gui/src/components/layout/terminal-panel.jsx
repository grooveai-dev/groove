// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useCallback, useState } from 'react';
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
  onClose,
  onRenameTab,
}) {
  const dragging = useRef(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
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

  const tabList = tabs || [{ id: 'default', label: 'Terminal' }];

  return (
    <div
      className={cn('flex flex-col border-t border-border bg-surface-0 relative', !visible && 'hidden')}
      style={visible ? (fullHeight ? { flex: 1, minHeight: 0 } : { height, flexShrink: 0 }) : { height: 0 }}
    >
      {/* Resize handle */}
      {!fullHeight && (
        <div
          className="absolute top-0 left-0 right-0 h-1 cursor-row-resize hover:bg-accent/30 transition-colors z-10"
          onMouseDown={onMouseDown}
        />
      )}

      {/* Header bar */}
      <div className="flex items-center h-9 bg-surface-1 border-b border-border flex-shrink-0 pl-0 pr-3">
        {/* Tabs */}
        <div className="flex items-center gap-0 flex-1 min-w-0 overflow-x-auto scrollbar-none h-full">
          {tabList.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onSelectTab?.(tab.id)}
              onDoubleClick={() => { setRenamingId(tab.id); setRenameValue(tab.label); }}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 h-full text-[11px] font-medium font-sans cursor-pointer select-none transition-colors duration-100 flex-shrink-0',
                tab.id === activeTab
                  ? 'text-text-0 bg-surface-3'
                  : 'text-text-2 hover:text-text-0 hover:bg-surface-5/50',
              )}
            >
              <Terminal size={11} />
              {renamingId === tab.id ? (
                <input
                  className="bg-transparent border border-border rounded px-1 text-[11px] text-text-0 outline-none w-20 font-sans"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => { if (renameValue.trim()) onRenameTab?.(tab.id, renameValue.trim()); setRenamingId(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { if (renameValue.trim()) onRenameTab?.(tab.id, renameValue.trim()); setRenamingId(null); }
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="truncate max-w-[100px]">{tab.label}</span>
              )}
              {tabList.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onCloseTab?.(tab.id); }}
                  className="ml-1 p-0.5 rounded hover:bg-surface-5 text-text-4 hover:text-text-1 cursor-pointer"
                >
                  <X size={9} />
                </button>
              )}
            </button>
          ))}
          <button
            onClick={onAddTab}
            className="flex items-center justify-center w-6 h-6 text-text-3 hover:text-text-0 hover:bg-surface-5/50 rounded cursor-pointer transition-colors flex-shrink-0 ml-1"
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
          <button
            onClick={onClose}
            className="p-1.5 rounded text-text-3 hover:text-text-0 hover:bg-surface-5 cursor-pointer transition-colors"
            title="Close terminal"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Terminal content */}
      <div className="flex-1 min-h-0 pl-2 pt-1">
        {children}
      </div>
    </div>
  );
}
