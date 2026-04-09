// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

export function DetailPanel({ children, width, onWidthChange, onClose, className }) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;

    function onMouseMove(e) {
      if (!dragging.current) return;
      const delta = startX.current - e.clientX;
      const newWidth = Math.min(Math.max(startWidth.current + delta, 380), window.innerWidth * 0.65);
      onWidthChange(newWidth);
    }

    function onMouseUp() {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [width, onWidthChange]);

  return (
    <aside
      className={cn('flex-shrink-0 flex bg-surface-1 border-l border-border relative', className)}
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/30 transition-colors z-10"
        onMouseDown={onMouseDown}
      />

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-3 right-3 z-10 p-1 rounded-md text-text-3 hover:text-text-0 hover:bg-surface-5 transition-colors cursor-pointer"
      >
        <X size={14} />
      </button>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {children}
      </div>
    </aside>
  );
}
