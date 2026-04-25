// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useCallback, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { AgentFileTree } from './agent-file-tree';
import { AgentChat } from './agent-chat';
import { AgentFeed } from './agent-feed';
import { DiffViewer } from './diff-viewer';
import { CodeReview } from './code-review';
import { CodeEditor } from '../editor/code-editor';
import { Badge } from '../ui/badge';
import { Tooltip } from '../ui/tooltip';
import { ScrollArea } from '../ui/scroll-area';
import { roleColor } from '../../lib/status';
import { fmtNum } from '../../lib/format';
import { MediaViewer, isMediaFile } from '../editor/media-viewer';
import {
  X, Code2, MessageSquare, Activity, FileCode, GitCompareArrows,
  ClipboardCheck, AlertTriangle, RefreshCw, Users,
} from 'lucide-react';

const STATUS_VARIANT = {
  running: 'success', starting: 'warning', stopped: 'default',
  crashed: 'danger', completed: 'accent', killed: 'default', rotating: 'purple',
};

const TREE_DEFAULT = 220;
const TREE_MIN = 140;
const TREE_MAX = 360;
const RIGHT_DEFAULT = 340;
const RIGHT_MIN = 260;
const RIGHT_MAX = 520;

function AgentRail({ agents, activeId, onSelect }) {
  return (
    <div className="flex flex-col items-center gap-1 py-2 w-12 bg-surface-1 border-r border-border flex-shrink-0">
      {agents.map((agent) => {
        const colors = roleColor(agent.role);
        const isActive = agent.id === activeId;
        const isRunning = agent.status === 'running' || agent.status === 'starting';
        const initial = (agent.role || '?')[0].toUpperCase();

        return (
          <Tooltip key={agent.id} content={`${agent.name} — ${agent.status}`} side="right">
            <button
              onClick={() => onSelect(agent.id)}
              className={cn(
                'relative w-9 h-9 rounded-lg flex items-center justify-center',
                'text-xs font-bold font-sans cursor-pointer transition-all',
                isActive
                  ? 'ring-1.5 ring-accent bg-accent/12'
                  : 'hover:bg-surface-3',
              )}
              style={{ color: colors.text, background: isActive ? colors.bg : undefined }}
            >
              {initial}
              <span
                className={cn(
                  'absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full border border-surface-1',
                  isRunning ? 'bg-success animate-pulse' :
                  agent.status === 'completed' ? 'bg-accent' :
                  agent.status === 'crashed' ? 'bg-danger' : 'bg-text-4',
                )}
              />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

function TabBar({ tabs, activeFile, files, onSelect, onClose, diffMode, onToggleDiff, workspaceSnapshots }) {
  const hasSnapshot = activeFile && workspaceSnapshots[activeFile];

  return (
    <div className="flex items-stretch h-8 bg-surface-2 border-b border-border-subtle flex-shrink-0">
      <div className="flex items-stretch flex-1 min-w-0 overflow-x-auto scrollbar-none">
        {tabs.map((path) => {
          const isActive = path === activeFile;
          const file = files[path];
          const isDirty = file && file.content !== file.originalContent;
          const name = path.split('/').pop();

          return (
            <div
              key={path}
              className={cn(
                'flex items-center gap-1.5 px-3 text-2xs font-sans cursor-pointer select-none',
                'border-r border-white/5 transition-colors duration-75 flex-shrink-0',
                isActive
                  ? 'bg-surface-0 text-text-1 border-b border-b-accent'
                  : 'text-text-4 hover:text-text-2 hover:bg-surface-3 border-b border-b-transparent',
              )}
              onClick={() => onSelect(path)}
            >
              <span className="truncate max-w-[120px]">{name}</span>
              {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-warning flex-shrink-0" />}
              <button
                onClick={(e) => { e.stopPropagation(); onClose(path); }}
                className="p-0.5 rounded hover:bg-surface-5 text-text-4 hover:text-text-1 transition-colors cursor-pointer ml-0.5"
              >
                <X size={10} />
              </button>
            </div>
          );
        })}
      </div>
      {hasSnapshot && (
        <div className="flex items-center gap-0.5 px-2 border-l border-border-subtle flex-shrink-0">
          <button
            onClick={() => onToggleDiff(false)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-xs font-sans rounded cursor-pointer transition-colors',
              !diffMode ? 'bg-surface-4 text-text-0 font-medium' : 'text-text-3 hover:text-text-1',
            )}
          >
            <FileCode size={11} /> Code
          </button>
          <button
            onClick={() => onToggleDiff(true)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-xs font-sans rounded cursor-pointer transition-colors',
              diffMode ? 'bg-surface-4 text-text-0 font-medium' : 'text-text-3 hover:text-text-1',
            )}
          >
            <GitCompareArrows size={11} /> Diff
          </button>
        </div>
      )}
    </div>
  );
}

export function WorkspaceMode() {
  const agents = useGrooveStore((s) => s.agents);
  const activeTeamId = useGrooveStore((s) => s.activeTeamId);
  const workspaceAgentId = useGrooveStore((s) => s.workspaceAgentId);
  const setWorkspaceAgent = useGrooveStore((s) => s.setWorkspaceAgent);
  const workspaceReviewMode = useGrooveStore((s) => s.workspaceReviewMode);
  const toggleReviewMode = useGrooveStore((s) => s.toggleReviewMode);
  const workspaceSnapshots = useGrooveStore((s) => s.workspaceSnapshots);
  const setWorkspaceMode = useGrooveStore((s) => s.setWorkspaceMode);

  const editorFiles = useGrooveStore((s) => s.editorFiles);
  const editorActiveFile = useGrooveStore((s) => s.editorActiveFile);
  const editorOpenTabs = useGrooveStore((s) => s.editorOpenTabs);
  const editorChangedFiles = useGrooveStore((s) => s.editorChangedFiles);
  const setActiveFile = useGrooveStore((s) => s.setActiveFile);
  const closeFile = useGrooveStore((s) => s.closeFile);
  const updateFileContent = useGrooveStore((s) => s.updateFileContent);
  const saveFile = useGrooveStore((s) => s.saveFile);
  const reloadFile = useGrooveStore((s) => s.reloadFile);
  const dismissFileChange = useGrooveStore((s) => s.dismissFileChange);

  const teamAgents = agents.filter((a) => a.teamId === activeTeamId);
  const agent = teamAgents.find((a) => a.id === workspaceAgentId) || teamAgents[0];

  const [treeWidth, setTreeWidth] = useState(TREE_DEFAULT);
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT);
  const [diffMode, setDiffMode] = useState(false);
  const [rightTab, setRightTab] = useState('chat');

  const treeDragging = useRef(false);
  const rightDragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  useEffect(() => {
    setDiffMode(false);
  }, [editorActiveFile]);

  const onTreeMouseDown = useCallback((e) => {
    e.preventDefault();
    treeDragging.current = true;
    startX.current = e.clientX;
    startW.current = treeWidth;
    function onMove(e) {
      if (!treeDragging.current) return;
      setTreeWidth(Math.min(Math.max(startW.current + e.clientX - startX.current, TREE_MIN), TREE_MAX));
    }
    function onUp() {
      treeDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [treeWidth]);

  const onRightMouseDown = useCallback((e) => {
    e.preventDefault();
    rightDragging.current = true;
    startX.current = e.clientX;
    startW.current = rightWidth;
    function onMove(e) {
      if (!rightDragging.current) return;
      setRightWidth(Math.min(Math.max(startW.current - (e.clientX - startX.current), RIGHT_MIN), RIGHT_MAX));
    }
    function onUp() {
      rightDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [rightWidth]);

  if (!agent) {
    return (
      <div className="flex items-center justify-center h-full text-text-4 text-xs font-sans">
        No agents in this team
      </div>
    );
  }

  const isAlive = agent.status === 'running' || agent.status === 'starting';
  const ctxPct = Math.round((agent.contextUsage || 0) * 100);
  const file = editorActiveFile ? editorFiles[editorActiveFile] : null;
  const hasExternalChange = editorActiveFile && editorChangedFiles[editorActiveFile];
  const isMedia = editorActiveFile && isMediaFile(editorActiveFile);

  return (
    <div className="flex h-full bg-surface-0">
      {/* Left Rail — Agent Switcher */}
      <AgentRail agents={teamAgents} activeId={agent.id} onSelect={setWorkspaceAgent} />

      {/* Center Panel — File Tree + Editor */}
      <div className="flex flex-1 min-w-0">
        {/* File Tree Sidebar */}
        <div className="flex-shrink-0 bg-surface-1 border-r border-border relative" style={{ width: treeWidth }}>
          <AgentFileTree agentId={agent.id} />
          <div
            className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/30 transition-colors z-10"
            onMouseDown={onTreeMouseDown}
            onDoubleClick={() => setTreeWidth(TREE_DEFAULT)}
          />
        </div>

        {/* Editor Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#1a1e25]">
          {workspaceReviewMode ? (
            <CodeReview agentId={agent.id} />
          ) : (
            <>
              <TabBar
                tabs={editorOpenTabs}
                activeFile={editorActiveFile}
                files={editorFiles}
                onSelect={setActiveFile}
                onClose={closeFile}
                diffMode={diffMode}
                onToggleDiff={setDiffMode}
                workspaceSnapshots={workspaceSnapshots}
              />

              <div className="flex-1 relative min-h-0">
                {hasExternalChange && (
                  <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 px-4 py-2 bg-warning/10 border-b border-warning/20">
                    <AlertTriangle size={14} className="text-warning" />
                    <span className="text-xs text-warning font-sans flex-1">File modified externally</span>
                    <button
                      onClick={() => reloadFile(editorActiveFile)}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-text-1 hover:bg-surface-4 rounded cursor-pointer"
                    >
                      <RefreshCw size={12} /> Reload
                    </button>
                    <button
                      onClick={() => dismissFileChange(editorActiveFile)}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-text-3 hover:bg-surface-4 rounded cursor-pointer"
                    >
                      <X size={12} /> Dismiss
                    </button>
                  </div>
                )}

                {!editorActiveFile && (
                  <div className="w-full h-full flex items-center justify-center text-text-4 font-sans bg-[#1a1e25]">
                    <div className="text-center space-y-2">
                      <Code2 size={32} className="mx-auto" />
                      <p className="text-sm">Open a file from the tree</p>
                      <p className="text-2xs text-text-4">Files scoped to {agent.name}</p>
                    </div>
                  </div>
                )}

                {editorActiveFile && isMedia && (
                  <MediaViewer path={editorActiveFile} />
                )}

                {editorActiveFile && diffMode && !isMedia && (
                  <DiffViewer filePath={editorActiveFile} />
                )}

                {editorActiveFile && !diffMode && !isMedia && file && (
                  <CodeEditor
                    content={file.content}
                    language={file.language}
                    onChange={(content) => updateFileContent(editorActiveFile, content)}
                    onSave={() => saveFile(editorActiveFile)}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right Panel — Chat + Activity */}
      <div className="flex flex-col bg-surface-1 border-l border-border relative" style={{ width: rightWidth }}>
        {/* Resize handle */}
        <div
          className="absolute top-0 left-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/30 transition-colors z-10"
          onMouseDown={onRightMouseDown}
          onDoubleClick={() => setRightWidth(RIGHT_DEFAULT)}
        />

        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border flex-shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-text-0 font-sans truncate">{agent.name}</span>
              <Badge variant={STATUS_VARIANT[agent.status]} dot={isAlive ? 'pulse' : undefined}>
                {agent.status}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-2xs text-text-3 font-sans">
                {fmtNum(agent.tokensUsed || 0)} tokens
              </span>
              <span className="text-2xs text-text-3 font-sans">
                ctx {ctxPct}%
              </span>
            </div>
          </div>
          <button
            onClick={toggleReviewMode}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-xs font-sans rounded cursor-pointer transition-colors',
              workspaceReviewMode
                ? 'bg-accent/15 text-accent'
                : 'text-text-3 hover:text-text-1 hover:bg-surface-3',
            )}
            title="Review Changes"
          >
            <ClipboardCheck size={13} />
          </button>
          <button
            onClick={() => setWorkspaceMode(false)}
            className="flex items-center gap-1 px-2 py-1 text-xs font-sans rounded cursor-pointer transition-colors text-text-3 hover:text-text-1 hover:bg-surface-3"
            title="Back to agent tree"
          >
            <Users size={13} />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-0 border-b border-border-subtle flex-shrink-0">
          <button
            onClick={() => setRightTab('chat')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-sans cursor-pointer transition-colors',
              rightTab === 'chat'
                ? 'text-text-0 border-b border-b-accent font-medium'
                : 'text-text-3 hover:text-text-1',
            )}
          >
            <MessageSquare size={12} /> Chat
          </button>
          <button
            onClick={() => setRightTab('activity')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-sans cursor-pointer transition-colors',
              rightTab === 'activity'
                ? 'text-text-0 border-b border-b-accent font-medium'
                : 'text-text-3 hover:text-text-1',
            )}
          >
            <Activity size={12} /> Activity
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0">
          {rightTab === 'chat' && <AgentChat agent={agent} />}
          {rightTab === 'activity' && <AgentFeed agent={agent} />}
        </div>
      </div>
    </div>
  );
}
