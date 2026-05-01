// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useCallback, useRef } from 'react';
import { useGrooveStore } from '../stores/groove';
import { ScrollArea } from '../components/ui/scroll-area';
import { Select, SelectTrigger, SelectContent, SelectItem } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Tooltip } from '../components/ui/tooltip';
import { RuntimeConfig } from '../components/lab/runtime-config';
import { ParameterPanel } from '../components/lab/parameter-panel';
import { SystemPromptEditor } from '../components/lab/system-prompt-editor';
import { ChatPlayground } from '../components/lab/chat-playground';
import { MetricsPanel } from '../components/lab/metrics-panel';
import { PresetManager } from '../components/lab/preset-manager';
import { cn } from '../lib/cn';
import { FlaskConical, PanelLeftOpen, PanelRightOpen, Box } from 'lucide-react';

const LEFT_DEFAULT = 280;
const LEFT_MIN = 220;
const LEFT_MAX = 400;
const RIGHT_DEFAULT = 240;
const RIGHT_MIN = 200;
const RIGHT_MAX = 360;

function ModelSelector() {
  const models = useGrooveStore((s) => s.labModels);
  const activeRuntime = useGrooveStore((s) => s.labActiveRuntime);
  const activeModel = useGrooveStore((s) => s.labActiveModel);
  const setActiveModel = useGrooveStore((s) => s.setLabActiveModel);

  if (!activeRuntime) return null;

  return (
    <div className="space-y-1.5">
      <span className="text-xs font-semibold font-sans text-text-2 uppercase tracking-wider">Model</span>
      {models.length > 0 ? (
        <Select value={activeModel || ''} onValueChange={setActiveModel}>
          <SelectTrigger placeholder="Select model" />
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m.id || m.name} value={m.id || m.name}>
                <div className="flex items-center gap-2">
                  <Box size={12} className="text-text-3" />
                  <span>{m.name}</span>
                  {m.size && <span className="text-2xs text-text-4 font-mono">{m.size}</span>}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="px-3 py-2 rounded-md bg-surface-1 border border-border-subtle">
          <p className="text-2xs text-text-4 font-sans">No models discovered</p>
        </div>
      )}
    </div>
  );
}

function ResizeHandle({ onMouseDown, direction = 'vertical' }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        'flex-shrink-0 bg-border hover:bg-accent/40 transition-colors',
        direction === 'vertical' ? 'w-px cursor-col-resize hover:w-0.5' : 'h-px cursor-row-resize hover:h-0.5',
      )}
    />
  );
}

export default function ModelLabView() {
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
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-2.5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <FlaskConical size={16} className="text-accent" />
          <h1 className="text-sm font-bold font-sans text-text-0">Model Lab</h1>
          <Badge variant="accent">Beta</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip content={leftCollapsed ? 'Show config panel' : 'Hide config panel'}>
            <button
              onClick={() => setLeftCollapsed(!leftCollapsed)}
              className={cn(
                'p-1.5 rounded-md transition-colors cursor-pointer',
                leftCollapsed ? 'text-text-3 hover:text-accent hover:bg-accent/10' : 'text-accent bg-accent/10',
              )}
            >
              <PanelLeftOpen size={14} />
            </button>
          </Tooltip>
          <Tooltip content={rightCollapsed ? 'Show metrics panel' : 'Hide metrics panel'}>
            <button
              onClick={() => setRightCollapsed(!rightCollapsed)}
              className={cn(
                'p-1.5 rounded-md transition-colors cursor-pointer',
                rightCollapsed ? 'text-text-3 hover:text-accent hover:bg-accent/10' : 'text-accent bg-accent/10',
              )}
            >
              <PanelRightOpen size={14} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* 3-panel layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left panel — config */}
        <div
          className={cn(
            'flex-shrink-0 border-r border-border transition-all duration-200 overflow-hidden',
            leftCollapsed && 'w-0 border-r-0',
          )}
          style={leftCollapsed ? undefined : { width: leftWidth }}
        >
          <ScrollArea className="h-full">
            <div className="px-4 py-4 space-y-5">
              <RuntimeConfig />
              <div className="border-t border-border-subtle" />
              <ModelSelector />
              <div className="border-t border-border-subtle" />
              <ParameterPanel />
              <div className="border-t border-border-subtle" />
              <PresetManager />
              <div className="border-t border-border-subtle" />
              <SystemPromptEditor />
            </div>
          </ScrollArea>
        </div>

        {!leftCollapsed && <ResizeHandle onMouseDown={onLeftMouseDown} />}

        {/* Center panel — chat playground */}
        <div className="flex-1 min-w-0 p-3">
          <ChatPlayground />
        </div>

        {!rightCollapsed && <ResizeHandle onMouseDown={onRightMouseDown} />}

        {/* Right panel — metrics */}
        <div
          className={cn(
            'flex-shrink-0 border-l border-border transition-all duration-200 overflow-hidden',
            rightCollapsed && 'w-0 border-l-0',
          )}
          style={rightCollapsed ? undefined : { width: rightWidth }}
        >
          <ScrollArea className="h-full">
            <div className="px-4 py-4">
              <MetricsPanel />
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
