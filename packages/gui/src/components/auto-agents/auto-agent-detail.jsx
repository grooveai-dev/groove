// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useCallback } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Tabs } from '../ui/tabs';
import { timeAgo, fmtDollar } from '../../lib/format';
import { cn } from '../../lib/cn';
import {
  Play, Pause, Zap, ArrowLeft, Save,
  BookOpen, FileText, Clock, Activity, ListOrdered,
} from 'lucide-react';

function JournalTab({ agentId }) {
  const fetchJournal = useGrooveStore((s) => s.fetchAutoAgentJournal);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchJournal(agentId).then((data) => { setEntries(data || []); setLoading(false); });
  }, [agentId]);

  if (loading) return <div className="p-4 text-xs text-text-4 font-sans">Loading journal...</div>;
  if (entries.length === 0) return <div className="p-4 text-xs text-text-4 font-sans">No journal entries yet.</div>;

  return (
    <div className="p-3 space-y-2 overflow-y-auto">
      {[...entries].reverse().map((e, i) => (
        <div key={i} className="rounded border border-border-subtle bg-surface-0 px-3 py-2">
          <div className="flex items-center gap-2 text-2xs text-text-3 font-mono">
            <span>{timeAgo(e.timestamp)}</span>
            <Badge variant={e.event?.includes('fail') || e.event?.includes('error') ? 'danger' : 'default'} className="text-2xs">
              {e.event}
            </Badge>
            {e.cycle && <span className="text-text-4">cycle {e.cycle}</span>}
          </div>
          {e.details && <p className="text-xs text-text-1 font-sans mt-1">{e.details}</p>}
          {e.lesson && <p className="text-xs text-accent font-sans mt-1 italic">Lesson: {e.lesson}</p>}
        </div>
      ))}
    </div>
  );
}

function RunsTab({ agentId }) {
  const fetchRuns = useGrooveStore((s) => s.fetchAutoAgentRuns);
  const openDetail = useGrooveStore((s) => s.openDetail);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchRuns(agentId).then((data) => { setRuns(data || []); setLoading(false); });
  }, [agentId]);

  if (loading) return <div className="p-4 text-xs text-text-4 font-sans">Loading runs...</div>;
  if (runs.length === 0) return <div className="p-4 text-xs text-text-4 font-sans">No runs yet.</div>;

  return (
    <div className="p-3 space-y-2 overflow-y-auto">
      {runs.map((r) => (
        <div
          key={r.runId}
          className="rounded border border-border-subtle bg-surface-0 px-3 py-2 cursor-pointer hover:border-border"
          onClick={() => r.agentId && openDetail({ type: 'agent', agentId: r.agentId })}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-2xs font-mono text-text-3">
              <Badge
                variant={r.status === 'completed' ? 'success' : r.status === 'running' ? 'info' : 'danger'}
                className="text-2xs"
              >
                {r.status}
              </Badge>
              <span>{r.agentId}</span>
            </div>
            <span className="text-2xs text-text-4 font-mono">{timeAgo(r.startedAt || r.completedAt)}</span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-2xs text-text-4 font-mono">
            <span>{r.tokensUsed?.toLocaleString() || 0} tokens</span>
            <span>{fmtDollar(r.costUsd || 0)}</span>
            <span>{r.turns || 0} turns</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function EditorTab({ agentId, type }) {
  const fetchPrompt = useGrooveStore((s) => s.fetchAutoAgentPrompt);
  const fetchRoadmap = useGrooveStore((s) => s.fetchAutoAgentRoadmap);
  const updatePrompt = useGrooveStore((s) => s.updateAutoAgentPrompt);
  const updateRoadmap = useGrooveStore((s) => s.updateAutoAgentRoadmap);

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLoading(true);
    setDirty(false);
    const fetcher = type === 'prompt' ? fetchPrompt : fetchRoadmap;
    fetcher(agentId).then((data) => { setContent(data || ''); setLoading(false); });
  }, [agentId, type]);

  const save = useCallback(() => {
    const updater = type === 'prompt' ? updatePrompt : updateRoadmap;
    updater(agentId, content);
    setDirty(false);
  }, [agentId, type, content]);

  if (loading) return <div className="p-4 text-xs text-text-4 font-sans">Loading...</div>;

  return (
    <div className="flex flex-col h-full">
      <textarea
        value={content}
        onChange={(e) => { setContent(e.target.value); setDirty(true); }}
        className="flex-1 w-full p-3 bg-surface-0 text-text-1 text-xs font-mono resize-none border-0 focus:outline-none"
        placeholder={type === 'prompt' ? 'System prompt for this auto agent...' : 'Roadmap with staged goals...'}
      />
      {dirty && (
        <div className="px-3 py-2 border-t border-border-subtle flex justify-end">
          <Button variant="primary" size="sm" onClick={save} className="gap-1.5">
            <Save size={12} /> Save {type}
          </Button>
        </div>
      )}
    </div>
  );
}

function StateTab({ agentId }) {
  const fetchDetail = useGrooveStore((s) => s.fetchAutoAgentDetail);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    fetchDetail(agentId).then(setDetail);
  }, [agentId]);

  if (!detail) return <div className="p-4 text-xs text-text-4 font-sans">Loading state...</div>;

  const { state, definition } = detail;

  return (
    <div className="p-3 space-y-3 overflow-y-auto">
      <div className="space-y-2">
        <h4 className="text-2xs font-semibold text-text-2 font-sans uppercase tracking-wide">Current State</h4>
        <div className="grid grid-cols-2 gap-2 text-xs font-sans">
          <div className="bg-surface-0 rounded px-3 py-2 border border-border-subtle">
            <span className="text-text-4 text-2xs">Phase</span>
            <p className="text-text-0 font-mono">{state?.phase || 'idle'}</p>
          </div>
          <div className="bg-surface-0 rounded px-3 py-2 border border-border-subtle">
            <span className="text-text-4 text-2xs">Cycle</span>
            <p className="text-text-0 font-mono">{state?.cycle || 0}</p>
          </div>
        </div>
        {state?.phase_note && (
          <div className="bg-surface-0 rounded px-3 py-2 border border-border-subtle">
            <span className="text-text-4 text-2xs">Phase Note</span>
            <p className="text-text-1 text-xs font-sans">{state.phase_note}</p>
          </div>
        )}
        {state?.champion && (
          <div className="bg-surface-0 rounded px-3 py-2 border border-border-subtle">
            <span className="text-text-4 text-2xs">Champion</span>
            <pre className="text-text-1 text-2xs font-mono mt-1 whitespace-pre-wrap">{JSON.stringify(state.champion, null, 2)}</pre>
          </div>
        )}
        {state?.error && (
          <div className="bg-danger/10 rounded px-3 py-2 border border-danger/30">
            <span className="text-danger text-2xs font-semibold">Error</span>
            <p className="text-danger text-xs font-sans">{state.error}</p>
          </div>
        )}
      </div>

      {/* Config summary */}
      <div className="space-y-2">
        <h4 className="text-2xs font-semibold text-text-2 font-sans uppercase tracking-wide">Configuration</h4>
        <div className="bg-surface-0 rounded px-3 py-2 border border-border-subtle text-2xs font-mono text-text-3 space-y-1">
          <div>Cadence: {definition?.cadenceDescription || definition?.cadence}</div>
          <div>Provider: {definition?.agentConfig?.provider} · Model: {definition?.agentConfig?.model}</div>
          <div>Timeout: {definition?.timeout}s · Stale threshold: {definition?.staleThresholdMinutes}min</div>
          {definition?.maxIterations && <div>Max iterations: {definition.maxIterations}</div>}
          {definition?.guardrails?.length > 0 && <div>Guardrails: {definition.guardrails.length}</div>}
        </div>
      </div>

      {/* History */}
      {state?.history?.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-2xs font-semibold text-text-2 font-sans uppercase tracking-wide">
            History ({state.history.length})
          </h4>
          <div className="space-y-1">
            {state.history.slice(-10).reverse().map((h, i) => (
              <div key={i} className="text-2xs font-mono text-text-3 bg-surface-0 rounded px-2 py-1 border border-border-subtle">
                [{timeAgo(h.timestamp)}] {h.tag || h.event}: {h.note || h.details || ''}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const TABS = [
  { id: 'state',   label: 'State',   icon: Activity },
  { id: 'journal', label: 'Journal', icon: BookOpen },
  { id: 'runs',    label: 'Runs',    icon: ListOrdered },
  { id: 'prompt',  label: 'Prompt',  icon: FileText },
  { id: 'roadmap', label: 'Roadmap', icon: Clock },
];

export function AutoAgentDetail({ agentId, onBack }) {
  const [activeTab, setActiveTab] = useState('state');
  const autoAgents = useGrooveStore((s) => s.autoAgents);
  const pauseAutoAgent = useGrooveStore((s) => s.pauseAutoAgent);
  const resumeAutoAgent = useGrooveStore((s) => s.resumeAutoAgent);
  const triggerAutoAgent = useGrooveStore((s) => s.triggerAutoAgent);

  const agent = autoAgents.find((a) => a.id === agentId);
  if (!agent) return <div className="p-4 text-xs text-text-4">Agent not found</div>;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-subtle bg-surface-1 flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={onBack}>
          <ArrowLeft size={14} />
        </Button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text-0 font-sans truncate">{agent.name}</h3>
          <p className="text-2xs text-text-3 font-sans truncate">{agent.description}</p>
        </div>
        <div className="flex items-center gap-1">
          {agent.paused ? (
            <Button variant="ghost" size="sm" onClick={() => resumeAutoAgent(agentId)} className="gap-1 text-xs">
              <Play size={12} /> Resume
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => pauseAutoAgent(agentId)} className="gap-1 text-xs">
              <Pause size={12} /> Pause
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={() => triggerAutoAgent(agentId)} className="gap-1 text-xs">
            <Zap size={12} /> Trigger
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center border-b border-border-subtle bg-surface-1 px-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-sans border-b-2 transition-colors cursor-pointer',
              activeTab === tab.id
                ? 'border-accent text-accent'
                : 'border-transparent text-text-3 hover:text-text-1',
            )}
          >
            <tab.icon size={12} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'state' && <StateTab agentId={agentId} />}
        {activeTab === 'journal' && <JournalTab agentId={agentId} />}
        {activeTab === 'runs' && <RunsTab agentId={agentId} />}
        {activeTab === 'prompt' && <EditorTab agentId={agentId} type="prompt" />}
        {activeTab === 'roadmap' && <EditorTab agentId={agentId} type="roadmap" />}
      </div>
    </div>
  );
}
