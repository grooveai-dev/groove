// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useCallback, useState, useEffect } from 'react';
import { Maximize2, Minimize2, Plus, X, Terminal, Send, ChevronDown, Sparkles } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useGrooveStore } from '../../stores/groove';
import { Tooltip } from '../ui/tooltip';

function AgentPicker({ onSelect, onClose }) {
  const ref = useRef(null);
  const agents = useGrooveStore((s) => s.agents);
  const teams = useGrooveStore((s) => s.teams);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const running = agents.filter((a) => a.status === 'running' || a.status === 'starting');
  const stopped = agents.filter((a) => a.status !== 'running' && a.status !== 'starting');

  function teamName(teamId) {
    const team = teams.find((t) => t.id === teamId);
    return team?.name || 'Default';
  }

  return (
    <div
      ref={ref}
      className="absolute bottom-full right-0 mb-1 z-50 min-w-[220px] max-h-[300px] overflow-y-auto py-1 bg-surface-2 border border-border rounded-lg shadow-xl"
    >
      {running.length > 0 && (
        <>
          <div className="px-3 py-1 text-2xs text-text-4 font-sans font-medium uppercase tracking-wider">Active</div>
          {running.map((agent) => (
            <button
              key={agent.id}
              onClick={() => onSelect(agent.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-sans text-text-1 hover:bg-surface-5 cursor-pointer transition-colors text-left"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />
              <span className="truncate flex-1">{agent.name}</span>
              <span className="text-2xs text-text-4">{teamName(agent.teamId)}</span>
            </button>
          ))}
        </>
      )}
      {stopped.length > 0 && (
        <>
          <div className="px-3 py-1 text-2xs text-text-4 font-sans font-medium uppercase tracking-wider">
            {running.length > 0 ? 'Other' : 'Agents'}
          </div>
          {stopped.slice(0, 10).map((agent) => (
            <button
              key={agent.id}
              onClick={() => onSelect(agent.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-sans text-text-2 hover:bg-surface-5 cursor-pointer transition-colors text-left"
            >
              <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0',
                agent.status === 'completed' ? 'bg-accent' : agent.status === 'crashed' ? 'bg-danger' : 'bg-text-4',
              )} />
              <span className="truncate flex-1">{agent.name}</span>
              <span className="text-2xs text-text-4">{teamName(agent.teamId)}</span>
            </button>
          ))}
        </>
      )}
      {agents.length === 0 && (
        <div className="px-3 py-3 text-xs text-text-4 font-sans text-center">
          No agents available
        </div>
      )}
    </div>
  );
}

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
  selectedText,
}) {
  const dragging = useRef(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const activeAgent = useGrooveStore((s) => s.editorSelectedAgent);
  const agents = useGrooveStore((s) => s.agents);
  const attachSnippet = useGrooveStore((s) => s.attachSnippet);

  const agent = agents.find((a) => a.id === activeAgent);
  const hasSelection = selectedText && selectedText.trim().length > 0;

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

  function sendToAgent(agentId) {
    if (!agentId || !selectedText?.trim()) return;
    setShowPicker(false);
    useGrooveStore.setState({ editorSelectedAgent: agentId });
    attachSnippet({ type: 'terminal', code: selectedText.trim() });
  }

  function handleSendClick() {
    if (activeAgent) {
      sendToAgent(activeAgent);
    } else {
      setShowPicker(true);
    }
  }

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

        {/* Send to Agent + Window controls */}
        <div className="flex items-center gap-0.5 flex-shrink-0 ml-2">
          {/* Send to Agent */}
          {hasSelection && (
            <div className="relative flex items-center">
              <Tooltip content={activeAgent ? `Send to ${agent?.name || 'agent'}` : 'Send to agent'} side="top">
                <button
                  onClick={handleSendClick}
                  disabled={sending}
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-1 rounded text-xs font-sans cursor-pointer transition-colors mr-1',
                    'bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-50',
                  )}
                >
                  {activeAgent ? (
                    <>
                      <Send size={11} />
                      <span className="text-2xs max-w-[80px] truncate">{agent?.name || 'Agent'}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={11} />
                      <span className="text-2xs">Agent</span>
                      <ChevronDown size={9} />
                    </>
                  )}
                </button>
              </Tooltip>
              {!activeAgent && hasSelection && (
                <Tooltip content="Pick agent" side="top">
                  <button
                    onClick={() => setShowPicker(!showPicker)}
                    className="p-1 rounded text-text-3 hover:text-accent hover:bg-accent/10 cursor-pointer transition-colors mr-1"
                  >
                    <ChevronDown size={10} />
                  </button>
                </Tooltip>
              )}
              {showPicker && (
                <AgentPicker
                  onSelect={(id) => sendToAgent(id)}
                  onClose={() => setShowPicker(false)}
                />
              )}
            </div>
          )}

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
