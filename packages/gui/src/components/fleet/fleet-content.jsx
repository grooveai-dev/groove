// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useCallback, useState } from 'react';
import { LayoutList } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { FleetPane } from './fleet-pane';

export function FleetContent() {
  const selected = useGrooveStore((s) => s.fleetSelectedAgents);
  const splitMode = useGrooveStore((s) => s.fleetSplitMode);
  const fleetSelectAgent = useGrooveStore((s) => s.fleetSelectAgent);

  const [dropTarget, setDropTarget] = useState(null);

  const dragging = useRef(false);
  const dividerRef = useRef(null);
  const leftRef = useRef(null);
  const rightRef = useRef(null);

  const onDividerDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    const container = dividerRef.current?.parentElement;
    if (!container) return;

    function onMove(ev) {
      if (!dragging.current || !container || !leftRef.current || !rightRef.current) return;
      const rect = container.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.max(25, Math.min(75, pct));
      leftRef.current.style.flex = `0 0 ${clamped}%`;
      rightRef.current.style.flex = `0 0 ${100 - clamped}%`;
    }

    function onUp() {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  function handleDragOver(e, side) {
    const agentId = e.dataTransfer.types.includes('application/x-fleet-agent');
    if (!agentId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'link';
    setDropTarget(side);
  }

  function handleDrop(e, pane) {
    e.preventDefault();
    setDropTarget(null);
    const agentId = e.dataTransfer.getData('application/x-fleet-agent');
    if (!agentId) return;
    fleetSelectAgent(agentId, pane);
  }

  function handleDragLeave() {
    setDropTarget(null);
  }

  if (!selected[0] && !selected[1]) {
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center gap-3 text-text-3"
        onDragOver={(e) => handleDragOver(e, 'left')}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, 0)}
      >
        <LayoutList size={32} strokeWidth={1} className="text-text-4" />
        <p className="text-sm font-sans">Select an agent or drag one here</p>
        <p className="text-xs font-sans text-text-4">Cmd+Click or drag to open side-by-side</p>
      </div>
    );
  }

  if (!splitMode || !selected[1]) {
    return (
      <div className="flex-1 flex min-w-0 min-h-0">
        <div className="flex-1 min-w-0 min-h-0">
          <FleetPane agentId={selected[0]} paneIndex={0} />
        </div>
        {/* Drop zone for second pane */}
        <div
          className={`w-1 flex-shrink-0 transition-all ${dropTarget === 'right' ? 'w-1 bg-accent/40' : ''}`}
          onDragOver={(e) => handleDragOver(e, 'right')}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, 1)}
        />
        {dropTarget === 'right' && (
          <div
            className="w-48 flex-shrink-0 flex items-center justify-center border-2 border-dashed border-accent/30 bg-accent/5 rounded-lg m-1 transition-all"
            onDragOver={(e) => handleDragOver(e, 'right')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, 1)}
          >
            <p className="text-xs text-accent font-sans">Drop to open</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-w-0 min-h-0">
      <div
        ref={leftRef}
        className={`min-w-0 min-h-0 ${dropTarget === 'left' ? 'ring-2 ring-inset ring-accent/30' : ''}`}
        style={{ flex: '0 0 50%' }}
        onDragOver={(e) => handleDragOver(e, 'left')}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, 0)}
      >
        <FleetPane agentId={selected[0]} paneIndex={0} />
      </div>
      <div
        ref={dividerRef}
        className="w-1 bg-border hover:bg-accent/30 cursor-col-resize transition-colors flex-shrink-0"
        onMouseDown={onDividerDown}
      />
      <div
        ref={rightRef}
        className={`min-w-0 min-h-0 ${dropTarget === 'right' ? 'ring-2 ring-inset ring-accent/30' : ''}`}
        style={{ flex: '0 0 calc(50% - 4px)' }}
        onDragOver={(e) => handleDragOver(e, 'right')}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, 1)}
      >
        <FleetPane agentId={selected[1]} paneIndex={1} />
      </div>
    </div>
  );
}
