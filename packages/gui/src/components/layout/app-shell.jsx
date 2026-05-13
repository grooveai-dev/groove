// FSL-1.1-Apache-2.0 — see LICENSE
import { useMemo } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { useKeyboard } from '../../lib/hooks/use-keyboard';
import { isElectron } from '../../lib/electron';
import { cn } from '../../lib/cn';
import { TooltipProvider } from '../ui/tooltip';
import { ToastContainer } from '../ui/toast';
import { ActivityBar } from './activity-bar';
import { BreadcrumbBar } from './breadcrumb-bar';
import { StatusBar } from './status-bar';
import { DetailPanel } from './detail-panel';
import { CommandPalette } from './command-palette';
import { ApprovalModal } from '../ui/approval-modal';
import { QuestionModal } from '../ui/question-modal';
import { QuickConnect } from '../settings/quick-connect';

import { TeamTabBar } from '../../views/agents';

export function AppShell({ children, detailContent, terminalContent }) {
  const activeView = useGrooveStore((s) => s.activeView);
  const detailPanel = useGrooveStore((s) => s.detailPanel);
  const connected = useGrooveStore((s) => s.connected);
  const tunneled = useGrooveStore((s) => s.tunneled);
  const daemonHost = useGrooveStore((s) => s.daemonHost);
  const agents = useGrooveStore((s) => s.agents);
  const editorActiveFile = useGrooveStore((s) => s.editorActiveFile);
  const detailPanelWidth = useGrooveStore((s) => s.detailPanelWidth);
  const terminalVisible = useGrooveStore((s) => s.terminalVisible);
  const terminalFullHeight = useGrooveStore((s) => s.terminalFullHeight);

  const setActiveView = useGrooveStore((s) => s.setActiveView);
  const openDetail = useGrooveStore((s) => s.openDetail);
  const closeDetail = useGrooveStore((s) => s.closeDetail);
  const setDetailPanelWidth = useGrooveStore((s) => s.setDetailPanelWidth);
  const setTerminalVisible = useGrooveStore((s) => s.setTerminalVisible);
  const toggleCommandPalette = useGrooveStore((s) => s.toggleCommandPalette);

  const runningCount = useMemo(() => agents.filter((a) => a.status === 'running').length, [agents]);

  const shortcuts = useMemo(() => [
    { key: 'k', meta: true, handler: () => useGrooveStore.getState().toggleCommandPalette() },
    { key: 'p', meta: true, shift: true, handler: () => useGrooveStore.getState().toggleCommandPalette() },
    { key: 'j', meta: true, handler: () => { const s = useGrooveStore.getState(); s.setTerminalVisible(!s.terminalVisible); } },
    { key: 'n', meta: true, handler: () => useGrooveStore.getState().openDetail({ type: 'spawn' }) },
    { key: '1', meta: true, handler: () => useGrooveStore.getState().setActiveView('agents') },
    { key: '2', meta: true, handler: () => useGrooveStore.getState().setActiveView('editor') },
    { key: '3', meta: true, handler: () => useGrooveStore.getState().setActiveView('dashboard') },
    { key: '4', meta: true, handler: () => useGrooveStore.getState().setActiveView('marketplace') },
    { key: '5', meta: true, handler: () => useGrooveStore.getState().setActiveView('teams') },
    { key: 'Escape', handler: () => {
      const s = useGrooveStore.getState();
      if (s.commandPaletteOpen) s.toggleCommandPalette();
      else if (s.detailPanel) s.closeDetail();
    }},
  ], []);

  useKeyboard(shortcuts);

  const showDetail = detailPanel && detailPanel.type !== 'spawn';

  return (
    <TooltipProvider>
      <div className={cn('w-full h-full flex flex-col bg-surface-2 text-text-1 font-sans', isElectron() && 'electron-app')}>
        <BreadcrumbBar
          activeView={activeView}
          connected={connected}
          tunneled={tunneled}
          daemonHost={daemonHost}
          editorActiveFile={editorActiveFile}
          onOpenCommandPalette={toggleCommandPalette}
        />

        <div className="flex-1 flex min-h-0">
          <ActivityBar
            activeView={activeView}
            detailPanel={detailPanel}
            onNavigate={setActiveView}
            onTogglePanel={(id) => {
              detailPanel?.type === id ? closeDetail() : openDetail({ type: id });
            }}
          />

          {/* Content area (right of activity bar) */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {activeView === 'agents' && <TeamTabBar />}

            <div className="flex-1 flex min-h-0">
              {/* Center: main content + terminal */}
              <div className="flex-1 flex flex-col min-w-0 min-h-0">
                {!(terminalVisible && terminalFullHeight) && (
                  <main className="flex-1 min-h-0 overflow-hidden relative">
                    {children}
                  </main>
                )}
                {terminalContent}
              </div>

              {showDetail && (
                <DetailPanel
                  width={detailPanelWidth}
                  onWidthChange={setDetailPanelWidth}
                  onClose={closeDetail}
                >
                  {detailContent}
                </DetailPanel>
              )}
            </div>
          </div>
        </div>

        <StatusBar
          connected={connected}
          agentCount={agents.length}
          runningCount={runningCount}
          terminalVisible={terminalVisible}
          onToggleTerminal={() => setTerminalVisible(!terminalVisible)}
        />

        <CommandPalette />
        <QuickConnect />
        <ApprovalModal />
        <QuestionModal />
        <ToastContainer />
      </div>
    </TooltipProvider>
  );
}
