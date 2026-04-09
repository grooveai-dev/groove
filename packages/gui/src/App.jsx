// GROOVE GUI v2 — App Root
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useEffect } from 'react';
import { useGrooveStore } from './stores/groove';
import { AppShell } from './components/layout/app-shell';

// Views
import AgentsView from './views/agents';
import EditorView from './views/editor';
import DashboardView from './views/dashboard';
import MarketplaceView from './views/marketplace';
import TeamsView from './views/teams';

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

  // Render active view
  let content;
  switch (activeView) {
    case 'agents':      content = <AgentsView />;      break;
    case 'editor':      content = <EditorView />;      break;
    case 'dashboard':   content = <DashboardView />;   break;
    case 'marketplace': content = <MarketplaceView />; break;
    case 'teams':       content = <TeamsView />;       break;
    default:            content = <AgentsView />;
  }

  // Render detail panel content
  let detailContent = null;
  if (detailPanel) {
    switch (detailPanel.type) {
      case 'agent':
        detailContent = <AgentPanel />;
        break;
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

export default function App() {
  const connect = useGrooveStore((s) => s.connect);
  useEffect(() => { connect(); }, [connect]);

  return (
    <ErrorBoundary>
      <ViewRouter />
    </ErrorBoundary>
  );
}
