// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useCallback, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { AgentFileTree } from './agent-file-tree';
import { DiffViewer } from './diff-viewer';
import { CodeReview } from './code-review';
import { CodeEditor } from '../editor/code-editor';
import { Tooltip } from '../ui/tooltip';
import { roleColor } from '../../lib/status';
import { MediaViewer, isMediaFile } from '../editor/media-viewer';
import {
  X, Code2, FileCode, GitCompareArrows,
  ClipboardCheck, Users,
} from 'lucide-react';

const TREE_DEFAULT = 220;
const TREE_MIN = 140;
const TREE_MAX = 360;

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

function TabBar({ tabs, activeFile, files, onSelect, onClose, diffMode, onToggleDiff, workspaceSnapshots, onBackToTeam, onToggleReview, reviewMode }) {
  const hasSnapshot = activeFile && workspaceSnapshots[activeFile];

  return (
    <div className="flex items-stretch h-8 bg-[#1a1e25] border-b border-[#1e2229] flex-shrink-0">
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
      <div className="flex items-center gap-0.5 px-2 border-l border-border-subtle flex-shrink-0">
        {hasSnapshot && (
          <>
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
            <div className="w-px h-4 bg-border-subtle mx-1" />
          </>
        )}
        <Tooltip content="Review Changes" side="bottom">
          <button
            onClick={onToggleReview}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-xs font-sans rounded cursor-pointer transition-colors',
              reviewMode
                ? 'bg-accent/15 text-accent'
                : 'text-text-3 hover:text-text-1 hover:bg-surface-3',
            )}
          >
            <ClipboardCheck size={12} />
          </button>
        </Tooltip>
        <Tooltip content="Back to Team View" side="bottom">
          <button
            onClick={onBackToTeam}
            className="flex items-center gap-1 px-2 py-1 text-xs font-sans rounded cursor-pointer transition-colors text-text-3 hover:text-text-1 hover:bg-surface-3"
          >
            <Users size={12} />
            <span className="text-2xs">Team</span>
          </button>
        </Tooltip>
      </div>
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
  const [diffMode, setDiffMode] = useState(false);

  const treeDragging = useRef(false);
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

  if (!agent) {
    return (
      <div className="flex items-center justify-center h-full text-text-4 text-xs font-sans">
        No agents in this team
      </div>
    );
  }

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
        <div className="flex-1 flex flex-col min-w-0 bg-[#13161b]">
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
                onBackToTeam={() => setWorkspaceMode(false)}
                onToggleReview={toggleReviewMode}
                reviewMode={workspaceReviewMode}
              />

              <div className="flex-1 relative min-h-0">
                {hasExternalChange && (
                  <div className="absolute top-1 right-3 z-10 flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-2/90 border border-border-subtle backdrop-blur-sm">
                    <span className="text-2xs text-text-3 font-sans">Modified</span>
                    <button
                      onClick={() => reloadFile(editorActiveFile)}
                      className="text-2xs text-accent hover:text-accent/80 font-sans cursor-pointer"
                    >
                      Reload
                    </button>
                    <button
                      onClick={() => dismissFileChange(editorActiveFile)}
                      className="p-0.5 text-text-4 hover:text-text-1 cursor-pointer"
                    >
                      <X size={10} />
                    </button>
                  </div>
                )}

                {!editorActiveFile && (
                  <div className="w-full h-full flex items-center justify-center text-text-4 font-sans bg-[#13161b]">
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
    </div>
  );
}
