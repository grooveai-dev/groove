// GROOVE GUI v2 — App Root
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useEffect, useMemo } from 'react';
import { useGrooveStore } from './stores/groove';
import { AppShell } from './components/layout/app-shell';
import { SetupWizard } from './components/onboarding/setup-wizard';
import { useKeyboard } from './lib/hooks/use-keyboard';
import { UpgradeModal } from './components/pro/upgrade-modal';
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
import ToysView from './views/toys';
import NetworkView from './views/network';
import ChatView from './views/chat';

// Agent components
import { AgentPanel } from './components/agents/agent-panel';
import { SpawnWizard } from './components/agents/spawn-wizard';
import { JournalistPanel } from './components/agents/journalist-panel';

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
    case 'toys':        content = <ToysView />;        break;
    case 'teams':       content = <TeamsView />;       break;
    case 'models':      content = <ModelsView />;      break;
    case 'federation':  content = <FederationView />;  break;
    case 'settings':    content = <SettingsView />;    break;
    case 'chat':        content = <ChatView />;        break;
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
  return (
    <div className="h-screen bg-surface-0 flex flex-col items-center justify-center gap-4">
      <img src="/favicon.png" alt="" className="w-10 h-10 opacity-60 animate-pulse" />
      <p className="text-sm text-text-3 font-sans">Connecting...</p>
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
    </ErrorBoundary>
  );
}
