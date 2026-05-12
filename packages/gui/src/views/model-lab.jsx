// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useCallback, useRef, useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';
import { ScrollArea } from '../components/ui/scroll-area';
import { Tooltip } from '../components/ui/tooltip';
import { Combobox } from '../components/ui/combobox';
import { RuntimeSection } from '../components/lab/runtime-config';
import { ParameterPanel } from '../components/lab/parameter-panel';
import { SystemPromptEditor } from '../components/lab/system-prompt-editor';
import { ChatPlayground } from '../components/lab/chat-playground';
import { LabAssistant } from '../components/lab/lab-assistant';
import { MetricsPanel } from '../components/lab/metrics-panel';
import { PresetManager } from '../components/lab/preset-manager';
import { cn } from '../lib/cn';
import { FlaskConical, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Box } from 'lucide-react';

const LEFT_DEFAULT = 280;
const LEFT_MIN = 220;
const LEFT_MAX = 400;
const RIGHT_DEFAULT = 240;
const RIGHT_MIN = 200;
const RIGHT_MAX = 360;

function ModelSelector() {
  const models = useGrooveStore((s) => s.labModels);
  const runtimes = useGrooveStore((s) => s.labRuntimes);
  const activeRuntime = useGrooveStore((s) => s.labActiveRuntime);
  const activeModel = useGrooveStore((s) => s.labActiveModel);
  const setActiveModel = useGrooveStore((s) => s.setLabActiveModel);

  if (!activeRuntime) return null;

  const rt = runtimes.find((r) => r.id === activeRuntime);
  const online = rt?.status === 'connected';

  if (!online) {
    return (
      <div className="space-y-1.5">
        <span className="text-2xs font-semibold font-sans text-text-3 uppercase tracking-wider">Model</span>
        <p className="text-2xs text-text-4 font-sans px-1">Start the runtime to select a model</p>
      </div>
    );
  }

  if (models.length <= 1 && activeModel) return null;

  return (
    <div className="space-y-1.5">
      <span className="text-2xs font-semibold font-sans text-text-3 uppercase tracking-wider">Model</span>
      <Combobox
        value={activeModel || ''}
        onChange={setActiveModel}
        options={models.map((m) => ({ id: m.id || m.name, name: m.name, size: m.size }))}
        placeholder="Select or type a model name"
        renderOption={(o) => (
          <div className="flex items-center gap-2">
            <Box size={12} className="text-text-3 flex-shrink-0" />
            <span className="truncate">{o.name}</span>
            {o.size && <span className="text-2xs text-text-4 font-mono flex-shrink-0">{o.size}</span>}
          </div>
        )}
      />
    </div>
  );
}

function ResizeHandle({ onMouseDown }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="flex-shrink-0 w-[3px] cursor-col-resize group relative"
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
      <div className="absolute inset-y-0 left-[1px] w-px bg-border group-hover:bg-accent/50 transition-colors" />
    </div>
  );
}

function PanelToggle({ collapsed, onClick, side }) {
  const Icon = side === 'left'
    ? (collapsed ? PanelLeftOpen : PanelLeftClose)
    : (collapsed ? PanelRightOpen : PanelRightClose);
  const label = side === 'left'
    ? (collapsed ? 'Show config' : 'Hide config')
    : (collapsed ? 'Show metrics' : 'Hide metrics');

  return (
    <Tooltip content={label}>
      <button
        onClick={onClick}
        className={cn(
          'p-1 transition-colors cursor-pointer',
          collapsed ? 'text-text-4 hover:text-text-1' : 'text-text-3 hover:text-text-1',
        )}
      >
        <Icon size={14} />
      </button>
    </Tooltip>
  );
}

export default function ModelLabView() {
  const fetchLabRuntimes = useGrooveStore((s) => s.fetchLabRuntimes);
  const labAssistantAgentId = useGrooveStore((s) => s.labAssistantAgentId);
  const labAssistantMode = useGrooveStore((s) => s.labAssistantMode);
  const setLabAssistantMode = useGrooveStore((s) => s.setLabAssistantMode);

  useEffect(() => { fetchLabRuntimes(); }, [fetchLabRuntimes]);

  useEffect(() => {
    const interval = setInterval(fetchLabRuntimes, 30000);
    return () => clearInterval(interval);
  }, [fetchLabRuntimes]);

  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT);

  const draggingLeft = useRef(false);
  const draggingRight = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onLeftMouseDown = useCallback((e) => {
    e.preventDefault();
    draggingLeft.current = true;
    startX.current = e.clientX;
    startW.current = leftWidth;

    function onMouseMove(e) {
      if (!draggingLeft.current) return;
      const delta = e.clientX - startX.current;
      setLeftWidth(Math.min(Math.max(startW.current + delta, LEFT_MIN), LEFT_MAX));
    }
    function onMouseUp() {
      draggingLeft.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [leftWidth]);

  const onRightMouseDown = useCallback((e) => {
    e.preventDefault();
    draggingRight.current = true;
    startX.current = e.clientX;
    startW.current = rightWidth;

    function onMouseMove(e) {
      if (!draggingRight.current) return;
      const delta = startX.current - e.clientX;
      setRightWidth(Math.min(Math.max(startW.current + delta, RIGHT_MIN), RIGHT_MAX));
    }
    function onMouseUp() {
      draggingRight.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [rightWidth]);

  return (
    <div className="h-full flex flex-col bg-surface-0">
      {/* 3-panel layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left panel — config */}
        <div
          className={cn(
            'flex-shrink-0 transition-all duration-200 overflow-hidden',
            leftCollapsed && 'w-0',
          )}
          style={leftCollapsed ? undefined : { width: leftWidth }}
        >
          <div className="h-full flex flex-col">
            <div className="flex-shrink-0 flex items-center justify-between px-4 h-10">
              <div className="flex items-center gap-2">
                <FlaskConical size={13} className="text-accent" />
                <span className="text-xs font-semibold font-sans text-text-1">Model Lab</span>
              </div>
              <PanelToggle collapsed={false} onClick={() => setLeftCollapsed(true)} side="left" />
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <div className="px-4 pb-4 space-y-5 divide-y divide-border-subtle [&>*]:pt-5 [&>*:first-child]:pt-0">
                <RuntimeSection />
                <ModelSelector />
                <ParameterPanel />
                <PresetManager />
                <SystemPromptEditor />
              </div>
            </ScrollArea>
          </div>
        </div>

        {!leftCollapsed && <ResizeHandle onMouseDown={onLeftMouseDown} />}

        {/* Center panel — chat playground / assistant */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Center header bar */}
          <div className="flex-shrink-0 flex items-center h-10 px-3 gap-2">
            {leftCollapsed && (
              <PanelToggle collapsed onClick={() => setLeftCollapsed(false)} side="left" />
            )}
            {labAssistantAgentId && (
              <div className="flex items-center gap-px bg-surface-2 rounded p-px">
                <button
                  onClick={() => setLabAssistantMode(false)}
                  className={cn(
                    'px-3 py-1 text-2xs font-sans font-medium rounded-sm transition-colors cursor-pointer',
                    !labAssistantMode ? 'text-text-0 bg-surface-4' : 'text-text-3 hover:text-text-1',
                  )}
                >
                  Playground
                </button>
                <button
                  onClick={() => setLabAssistantMode(true)}
                  className={cn(
                    'px-3 py-1 text-2xs font-sans font-medium rounded-sm transition-colors cursor-pointer',
                    labAssistantMode ? 'text-text-0 bg-surface-4' : 'text-text-3 hover:text-text-1',
                  )}
                >
                  Assistant
                </button>
              </div>
            )}
            <div className="flex-1" />
            {rightCollapsed && (
              <PanelToggle collapsed onClick={() => setRightCollapsed(false)} side="right" />
            )}
          </div>
          <div className="flex-1 min-h-0">
            {labAssistantMode && labAssistantAgentId ? <LabAssistant /> : <ChatPlayground />}
          </div>
        </div>

        {!rightCollapsed && <ResizeHandle onMouseDown={onRightMouseDown} />}

        {/* Right panel — metrics */}
        <div
          className={cn(
            'flex-shrink-0 transition-all duration-200 overflow-hidden',
            rightCollapsed && 'w-0',
          )}
          style={rightCollapsed ? undefined : { width: rightWidth }}
        >
          <div className="h-full flex flex-col">
            <div className="flex-shrink-0 flex items-center justify-between px-4 h-10">
              <span className="text-2xs font-semibold font-sans text-text-3 uppercase tracking-wider">Metrics</span>
              <PanelToggle collapsed={false} onClick={() => setRightCollapsed(true)} side="right" />
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <div className="px-4 pb-4">
                <MetricsPanel />
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  );
}
