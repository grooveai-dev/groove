// FSL-1.1-Apache-2.0 — see LICENSE
import { useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';
import { Button } from '../components/ui/button';
import { AutomationCard } from '../components/automations/automation-card';
import { AutomationWizard } from '../components/automations/automation-wizard';
import { Plus, Calendar } from 'lucide-react';

export default function TeamsView() {
  const automations = useGrooveStore((s) => s.automations);
  const fetchAutomations = useGrooveStore((s) => s.fetchAutomations);
  const fetchGateways = useGrooveStore((s) => s.fetchGateways);
  const fetchInstalledIntegrations = useGrooveStore((s) => s.fetchInstalledIntegrations);
  const openWizard = useGrooveStore((s) => s.openAutomationWizard);

  useEffect(() => {
    fetchAutomations();
    fetchGateways();
    fetchInstalledIntegrations();
    const interval = setInterval(fetchAutomations, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle bg-surface-1">
        <h2 className="text-sm font-semibold text-text-0 font-sans uppercase tracking-wide">Automations</h2>
        <Button variant="primary" size="sm" onClick={openWizard} className="gap-1.5">
          <Plus size={12} /> New Automation
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {automations.length === 0 ? (
          <div className="flex-1 flex items-center justify-center h-full">
            <div className="text-center space-y-3 py-20">
              <Calendar size={28} className="mx-auto text-text-4" />
              <p className="text-xs font-sans text-text-3">No automations yet</p>
              <p className="text-2xs font-sans text-text-4">Schedule agent teams to automate your workflows</p>
              <Button variant="primary" size="sm" onClick={openWizard} className="gap-1.5 mt-2">
                <Plus size={12} /> Create Automation
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {automations.map((a) => (
              <AutomationCard key={a.id} automation={a} />
            ))}
          </div>
        )}
      </div>

      <AutomationWizard />
    </div>
  );
}
