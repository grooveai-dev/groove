// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useMemo } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { SendHorizontal, ChevronDown, X } from 'lucide-react';
import { cn } from '../../lib/cn';

// Relay compose panel — pick any agent on any team and send a message on this
// agent's behalf. The reply is forwarded back automatically, so the user only
// drives the outbound hop.
export function InnerChatRelay({ fromAgent, onClose }) {
  const agents = useGrooveStore((s) => s.agents);
  const teams = useGrooveStore((s) => s.teams);
  const threadsMap = useGrooveStore((s) => s.innerchatThreads);
  const sendInnerChat = useGrooveStore((s) => s.sendInnerChat);
  const addToast = useGrooveStore((s) => s.addToast);

  const [toId, setToId] = useState('');
  const [threadId, setThreadId] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  // Every agent except this one, grouped by team. Stopped agents are included:
  // delivery resumes them the same way a user chat message would.
  const grouped = useMemo(() => {
    const byTeam = new Map();
    for (const a of agents) {
      if (a.id === fromAgent.id) continue;
      const key = a.teamId || 'untimed';
      if (!byTeam.has(key)) byTeam.set(key, []);
      byTeam.get(key).push(a);
    }
    return Array.from(byTeam.entries()).map(([teamId, list]) => ({
      teamId,
      name: teams.find((t) => t.id === teamId)?.name || 'No team',
      agents: list.sort((a, b) => a.name.localeCompare(b.name)),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [agents, teams, fromAgent.id]);

  // Existing exchanges between this agent and the selected target.
  const threads = useMemo(() => {
    if (!toId) return [];
    return Object.values(threadsMap)
      .filter((t) => t.participants.some((p) => p.id === fromAgent.id)
        && t.participants.some((p) => p.id === toId))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [threadsMap, toId, fromAgent.id]);

  const target = agents.find((a) => a.id === toId);
  const willResume = target && target.status !== 'running' && target.status !== 'starting';

  async function handleSend() {
    if (!toId || !message.trim() || sending) return;
    setSending(true);
    try {
      await sendInnerChat(fromAgent.id, toId, message.trim(), threadId || null);
      addToast('success', `Relayed to ${target?.name || toId}`,
        willResume ? 'Target is being resumed to receive it' : undefined);
      setMessage('');
      onClose();
    } catch {
      // sendInnerChat already surfaced the error
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex-shrink-0 border-t border-border-subtle bg-surface-0 px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-semibold text-warning font-sans">
          Relay from {fromAgent.name}
        </span>
        <button onClick={onClose} className="p-0.5 text-text-4 hover:text-text-1 cursor-pointer">
          <X size={12} />
        </button>
      </div>

      <div className="relative">
        <select
          value={toId}
          onChange={(e) => { setToId(e.target.value); setThreadId(''); }}
          className="w-full h-7 pl-2 pr-6 text-xs bg-surface-3 border border-border-subtle rounded text-text-0 font-sans focus:outline-none focus:border-accent/40 appearance-none cursor-pointer"
        >
          <option value="">Select target agent…</option>
          {grouped.map((g) => (
            <optgroup key={g.teamId} label={g.name}>
              {g.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.role}){a.status === 'running' ? '' : ` — ${a.status}`}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-4 pointer-events-none" />
      </div>

      {threads.length > 0 && (
        <div className="relative">
          <select
            value={threadId}
            onChange={(e) => setThreadId(e.target.value)}
            className="w-full h-7 pl-2 pr-6 text-xs bg-surface-3 border border-border-subtle rounded text-text-2 font-sans focus:outline-none focus:border-accent/40 appearance-none cursor-pointer"
          >
            <option value="">Start a new thread</option>
            {threads.map((t) => (
              <option key={t.id} value={t.id}>
                Continue thread ({t.turns.length} turn{t.turns.length === 1 ? '' : 's'})
              </option>
            ))}
          </select>
          <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-4 pointer-events-none" />
        </div>
      )}

      <div className="flex gap-1.5">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend(); }}
          placeholder={`What should ${fromAgent.name} say? (⌘↵ to send)`}
          rows={3}
          className="flex-1 px-2 py-1.5 text-xs bg-surface-3 border border-border-subtle rounded text-text-0 font-sans placeholder:text-text-4 focus:outline-none focus:border-accent/40 resize-none"
        />
        <button
          onClick={handleSend}
          disabled={!toId || !message.trim() || sending}
          className={cn(
            'w-8 flex-shrink-0 flex items-center justify-center rounded transition-colors cursor-pointer',
            'bg-accent/15 text-accent hover:bg-accent/25',
            'disabled:opacity-30 disabled:cursor-not-allowed',
          )}
        >
          <SendHorizontal size={14} />
        </button>
      </div>

      {willResume && (
        <p className="text-2xs text-text-4 font-sans">
          {target.name} is {target.status} — it will be resumed to receive this.
        </p>
      )}
    </div>
  );
}
