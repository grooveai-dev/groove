// GROOVE GUI v2 — App Root
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useGrooveStore } from './stores/groove';
import { AppShell } from './components/layout/app-shell';
import { SetupWizard } from './components/onboarding/setup-wizard';
import { useKeyboard } from './lib/hooks/use-keyboard';
import { UpgradeModal } from './components/pro/upgrade-modal';
import { DataSharingModal } from './components/ui/data-sharing-modal';
import { WelcomeSplash } from './components/layout/welcome-splash';
import { FolderBrowser } from './components/agents/folder-browser';

// Views
import AgentsView from './views/agents';
import EditorView from './views/editor';
import DashboardView from './views/dashboard';
import MarketplaceView from './views/marketplace';
import TeamsView from './views/teams';
import SettingsView from './views/settings';
import ModelsView from './views/models';
import FederationView from './views/federation';
import ModelLabView from './views/model-lab';
import NetworkView from './views/network';
import ChatView from './views/chat';
import MemoryView from './views/memory';
import FleetView from './views/fleet';
import AutoAgentsView from './views/auto-agents';

// Agent components
import { AgentPanel } from './components/agents/agent-panel';
import { SpawnWizard } from './components/agents/spawn-wizard';
import { JournalistPanel } from './components/agents/journalist-panel';
import { KeeperGlobalModals } from './components/keeper/global-modals';

// Terminal
import { TerminalManager } from './components/editor/terminal';

// Error boundary
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="h-screen bg-surface-0 p-10 font-sans">
          <h2 className="text-lg font-semibold text-text-0 mb-4">Groove — Render Error</h2>
          <pre className="text-sm text-danger whitespace-pre-wrap mb-4">{this.state.error.message}</pre>
          <pre className="text-xs text-text-3 whitespace-pre-wrap">{this.state.error.stack}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-6 px-4 py-2 bg-accent text-surface-0 rounded-md font-medium text-sm cursor-pointer"
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ViewRouter() {
  const activeView = useGrooveStore((s) => s.activeView);
  const detailPanel = useGrooveStore((s) => s.detailPanel);
  const agents = useGrooveStore((s) => s.agents);
  const networkUnlocked = useGrooveStore((s) => s.networkUnlocked);

  // Render active view
  let content;
  switch (activeView) {
    case 'agents':      content = <AgentsView />;      break;
    case 'editor':      content = <EditorView />;      break;
    case 'dashboard':   content = <DashboardView />;   break;
    case 'marketplace': content = <MarketplaceView />; break;
    case 'teams':       content = <TeamsView />;       break;
    case 'auto-agents': content = <AutoAgentsView />; break;
    case 'models':      content = <ModelsView />;      break;
    case 'model-lab':   content = <ModelLabView />;    break;
    case 'federation':  content = <FederationView />;  break;
    case 'settings':    content = <SettingsView />;    break;
    case 'chat':        content = <ChatView />;        break;
    case 'fleet':       content = <FleetView />;       break;
    case 'memory':      content = <MemoryView />;      break;
    case 'network':     content = networkUnlocked ? <NetworkView /> : <AgentsView />; break;
    default:            content = <AgentsView />;
  }

  // Render detail panel content
  let detailContent = null;
  if (detailPanel) {
    switch (detailPanel.type) {
      case 'agent': {
        detailContent = <AgentPanel />;
        break;
      }
      case 'journalist':
        detailContent = <JournalistPanel />;
        break;
      case 'spawn':
        detailContent = null;
        break;
    }
  }

  return (
    <AppShell detailContent={detailContent} terminalContent={<TerminalManager />}>
      {content}
      <SpawnWizard />
    </AppShell>
  );
}

function TunneledFolderPicker() {
  const remoteHomedir = useGrooveStore((s) => s.remoteHomedir);
  const setProjectDir = useGrooveStore((s) => s.setProjectDir);
  return (
    <div
      className="fixed inset-0 z-40 bg-surface-0 flex flex-col items-center justify-center gap-3"
    >
      <img src="/favicon.png" alt="" className="w-10 h-10 opacity-60" />
      <p className="text-sm text-text-3 font-sans">Connected — choose a project directory to continue</p>
      <FolderBrowser
        open={true}
        onOpenChange={() => {}}
        currentPath={remoteHomedir || '/home'}
        homePath={remoteHomedir}
        onSelect={(dir) => setProjectDir(dir)}
        mandatory
      />
    </div>
  );
}

function LoadingScreen() {
  const connected = useGrooveStore((s) => s.connected);
  const [slow, setSlow] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const triedRef = useRef(false);

  // If we haven't come up within a few seconds, the connection (or the SSH
  // tunnel behind it) is likely stalled — surface a reload rather than an
  // endless pulse the user can't act on.
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(t);
  }, []);

  // If the socket can't even open (not just un-hydrated), the tunnel behind it
  // is probably dead — ask the desktop shell to re-establish it. Once only, and
  // only when disconnected, so a merely-slow load isn't disturbed.
  useEffect(() => {
    if (!slow || connected || triedRef.current) return;
    if (!window.groove?.reconnect) return;
    triedRef.current = true;
    setReconnecting(true);
    window.groove.reconnect().catch(() => {}).finally(() => setReconnecting(false));
  }, [slow, connected]);

  async function manualReconnect() {
    if (window.groove?.reconnect) {
      setReconnecting(true);
      try { await window.groove.reconnect(); } catch { /* falls through to reload */ }
      setReconnecting(false);
    }
    window.location.reload();
  }

  return (
    <div className="h-screen bg-surface-0 flex flex-col items-center justify-center gap-4">
      <img src="/favicon.png" alt="" className="w-10 h-10 opacity-60 animate-pulse" />
      <p className="text-sm text-text-3 font-sans">
        {reconnecting ? 'Re-establishing connection…' : connected ? 'Loading…' : 'Connecting to daemon…'}
      </p>
      {slow && (
        <div className="flex flex-col items-center gap-2 mt-1">
          <p className="text-xs text-text-4 font-sans max-w-xs text-center">
            Still trying to reach the daemon. If you just woke your machine, the connection is re-establishing.
          </p>
          <button
            onClick={manualReconnect}
            disabled={reconnecting}
            className="px-3 py-1.5 rounded-md text-xs font-medium font-sans border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {reconnecting ? 'Reconnecting…' : 'Reconnect'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const connect = useGrooveStore((s) => s.connect);
  const hydrated = useGrooveStore((s) => s.hydrated);
  const tunneled = useGrooveStore((s) => s.tunneled);
  const onboardingComplete = useGrooveStore((s) => s.onboardingComplete);
  const showProjectPicker = useGrooveStore((s) => s.showProjectPicker);
  useEffect(() => { connect(); }, [connect]);

  useEffect(() => {
    async function setTitle() {
      if (window.groove?.getInstanceInfo) {
        const info = await window.groove.getInstanceInfo();
        if (info?.name) {
          document.title = `${info.name} — Groove`;
          return;
        }
      }
      const params = new URLSearchParams(window.location.search);
      const instance = params.get('instance');
      if (instance) {
        const sanitized = instance.replace(/[\x00-\x1F]/g, '').slice(0, 50);
        document.title = `${sanitized} — Groove`;
      } else if (tunneled) {
        document.title = 'Remote — Groove';
      } else {
        document.title = 'Groove';
      }
    }
    setTitle();
  }, [tunneled]);

  const openFolderShortcuts = useMemo(() =>
    window.groove?.openFolder
      ? [{ key: 'o', meta: true, handler: () => window.groove.openFolder() }]
      : [],
  []);
  useKeyboard(openFolderShortcuts);

  if (!hydrated) return <LoadingScreen />;
  if (!onboardingComplete) return <ErrorBoundary><SetupWizard /></ErrorBoundary>;
  if (showProjectPicker && tunneled) return <ErrorBoundary><TunneledFolderPicker /></ErrorBoundary>;
  if (showProjectPicker) return <ErrorBoundary><WelcomeSplash /><UpgradeModal /></ErrorBoundary>;

  return (
    <ErrorBoundary>
      <ViewRouter />
      <UpgradeModal />
      <DataSharingModal />
      <KeeperGlobalModals />
    </ErrorBoundary>
  );
}
