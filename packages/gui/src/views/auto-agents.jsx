// FSL-1.1-Apache-2.0 — see LICENSE
import { useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';
import { Button } from '../components/ui/button';
import { AutoAgentCard } from '../components/auto-agents/auto-agent-card';
import { AutoAgentDetail } from '../components/auto-agents/auto-agent-detail';
import { AutoAgentSetupWizard } from '../components/auto-agents/setup-wizard';
import { Plus, Bot } from 'lucide-react';

export default function AutoAgentsView() {
  const autoAgents = useGrooveStore((s) => s.autoAgents);
  const fetchAutoAgents = useGrooveStore((s) => s.fetchAutoAgents);
  const openWizard = useGrooveStore((s) => s.openAutoAgentWizard);
  const selectedId = useGrooveStore((s) => s.selectedAutoAgentId);
  const selectAutoAgent = useGrooveStore((s) => s.selectAutoAgent);

  useEffect(() => {
    fetchAutoAgents();
    const interval = setInterval(fetchAutoAgents, 10000);
    return () => clearInterval(interval);
  }, []);

  // Detail view
  if (selectedId) {
    return (
      <div className="flex flex-col h-full">
        <AutoAgentDetail agentId={selectedId} onBack={() => selectAutoAgent(null)} />
        <AutoAgentSetupWizard />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle bg-surface-1">
        <h2 className="text-sm font-semibold text-text-0 font-sans uppercase tracking-wide">Auto Agents</h2>
        <Button variant="primary" size="sm" onClick={openWizard} className="gap-1.5">
          <Plus size={12} /> New Auto Agent
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {autoAgents.length === 0 ? (
          <div className="flex-1 flex items-center justify-center h-full">
            <div className="text-center space-y-3 py-20">
              <Bot size={28} className="mx-auto text-text-4" />
              <p className="text-xs font-sans text-text-3">No auto agents yet</p>
              <p className="text-2xs font-sans text-text-4 max-w-xs mx-auto">
                Auto agents run autonomously on a schedule — iterating, learning, and making progress on complex tasks 24/7.
              </p>
              <Button variant="primary" size="sm" onClick={openWizard} className="gap-1.5 mt-2">
                <Plus size={12} /> Create Auto Agent
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {autoAgents.map((a) => (
              <AutoAgentCard key={a.id} agent={a} />
            ))}
          </div>
        )}
      </div>

      <AutoAgentSetupWizard />
    </div>
  );
}
