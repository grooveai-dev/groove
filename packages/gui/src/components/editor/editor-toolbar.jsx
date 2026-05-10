// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { Tooltip } from '../ui/tooltip';
import {
  Bot, ChevronDown, Code2, GitCompareArrows, ClipboardCheck,
  Search, Command, PanelRight, GitBranch, Circle,
} from 'lucide-react';

function AgentSelector() {
  const agents = useGrooveStore((s) => s.agents);
  const activeTeamId = useGrooveStore((s) => s.activeTeamId);
  const selectedAgent = useGrooveStore((s) => s.editorSelectedAgent);
  const setEditorAgent = useGrooveStore((s) => s.setEditorAgent);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const teamAgents = agents.filter((a) => a.teamId === activeTeamId);
  const agent = teamAgents.find((a) => a.id === selectedAgent);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function statusColor(status) {
    if (status === 'running' || status === 'starting') return 'bg-success animate-pulse';
    if (status === 'completed') return 'bg-info';
    if (status === 'crashed') return 'bg-danger';
    return 'bg-text-4';
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 text-xs font-sans rounded hover:bg-surface-4 transition-colors cursor-pointer"
      >
        <Bot size={12} className="text-text-3" />
        <span className={agent ? 'text-text-1' : 'text-text-4'}>
          {agent ? agent.name : 'No Agent'}
        </span>
        {agent && <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', statusColor(agent.status))} />}
        <ChevronDown size={10} className="text-text-4" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 py-1 bg-surface-2 border border-border rounded-lg shadow-xl z-50">
          <button
            onClick={() => { setEditorAgent(null); setOpen(false); }}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-1.5 text-xs font-sans cursor-pointer transition-colors text-left',
              !selectedAgent ? 'bg-accent/10 text-accent' : 'text-text-2 hover:bg-surface-4',
            )}
          >
            <Circle size={10} className="text-text-4" />
            No Agent
          </button>
          {teamAgents.length > 0 && <div className="h-px bg-border-subtle my-1" />}
          {teamAgents.map((a) => (
            <button
              key={a.id}
              onClick={() => { setEditorAgent(a.id); setOpen(false); }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-xs font-sans cursor-pointer transition-colors text-left',
                selectedAgent === a.id ? 'bg-accent/10 text-accent' : 'text-text-1 hover:bg-surface-4',
              )}
            >
              <span className={cn('w-2 h-2 rounded-full flex-shrink-0', statusColor(a.status))} />
              <span className="truncate flex-1">{a.name}</span>
              <span className="text-2xs text-text-4">{a.role}</span>
            </button>
          ))}
          {teamAgents.length === 0 && (
            <div className="px-3 py-2 text-2xs text-text-4">No agents in team</div>
          )}
        </div>
      )}
    </div>
  );
}

function ViewModePills() {
  const mode = useGrooveStore((s) => s.editorViewMode);
  const setMode = useGrooveStore((s) => s.setEditorViewMode);

  const modes = [
    { id: 'code', label: 'Code', icon: Code2 },
    { id: 'diff', label: 'Diff', icon: GitCompareArrows },
    { id: 'review', label: 'Review', icon: ClipboardCheck },
  ];

  return (
    <div className="flex items-center gap-0.5 bg-surface-2 rounded-md p-0.5">
      {modes.map((m) => (
        <button
          key={m.id}
          onClick={() => setMode(m.id)}
          className={cn(
            'flex items-center gap-1 px-2 py-0.5 text-xs font-sans rounded cursor-pointer transition-colors',
            mode === m.id
              ? 'bg-surface-4 text-text-0 font-medium'
              : 'text-text-3 hover:text-text-1',
          )}
        >
          <m.icon size={11} />
          {m.label}
        </button>
      ))}
    </div>
  );
}

export function EditorToolbar({ onCmdK, onCmdP }) {
  const gitBranch = useGrooveStore((s) => s.editorGitBranch);
  const aiPanelOpen = useGrooveStore((s) => s.editorAiPanelOpen);
  const toggleAiPanel = useGrooveStore((s) => s.toggleAiPanel);
  const fetchGitBranch = useGrooveStore((s) => s.fetchGitBranch);

  useEffect(() => {
    fetchGitBranch();
  }, [fetchGitBranch]);

  return (
    <div className="flex items-center gap-1.5 h-8 px-2 bg-surface-2 border-b border-border-subtle flex-shrink-0 select-none">
      <AgentSelector />

      <div className="w-px h-4 bg-border-subtle" />

      {gitBranch?.branch && (
        <>
          <div className="flex items-center gap-1 px-1.5 text-xs text-text-3 font-sans">
            <GitBranch size={11} className="text-text-4" />
            <span className="truncate max-w-[100px]">{gitBranch.branch}</span>
          </div>
          <div className="w-px h-4 bg-border-subtle" />
        </>
      )}

      <ViewModePills />

      <div className="flex-1" />

      <Tooltip content="Quick Open (Cmd+P)" side="bottom">
        <button
          onClick={onCmdP}
          className="flex items-center gap-1 px-2 py-1 text-xs font-sans text-text-3 hover:text-text-1 hover:bg-surface-4 rounded cursor-pointer transition-colors"
        >
          <Search size={12} />
        </button>
      </Tooltip>

      <Tooltip content="AI Command (Cmd+K)" side="bottom">
        <button
          onClick={onCmdK}
          className="flex items-center gap-1 px-2 py-1 text-xs font-sans text-text-3 hover:text-text-1 hover:bg-surface-4 rounded cursor-pointer transition-colors"
        >
          <Command size={12} />
        </button>
      </Tooltip>

      <Tooltip content="Toggle AI Panel" side="bottom">
        <button
          onClick={toggleAiPanel}
          className={cn(
            'flex items-center gap-1 px-2 py-1 text-xs font-sans rounded cursor-pointer transition-colors',
            aiPanelOpen ? 'bg-accent/15 text-accent' : 'text-text-3 hover:text-text-1 hover:bg-surface-4',
          )}
        >
          <PanelRight size={12} />
        </button>
      </Tooltip>
    </div>
  );
}
