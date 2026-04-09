// FSL-1.1-Apache-2.0 — see LICENSE
import { Terminal, BookOpen } from 'lucide-react';
import { cn } from '../../lib/cn';
import { StatusDot } from '../ui/status-dot';
import { fmtUptime } from '../../lib/format';

export function StatusBar({
  connected,
  agentCount,
  runningCount,
  uptime,
  terminalVisible,
  onToggleTerminal,
}) {
  return (
    <footer className="h-6 flex-shrink-0 flex items-center px-3 bg-surface-3 border-t border-border text-2xs font-sans select-none">
      {/* Left: connection + stats */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <StatusDot status={connected ? 'running' : 'crashed'} size="sm" />
          <span className={connected ? 'text-text-2' : 'text-danger'}>
            {connected ? 'Connected' : 'Offline'}
          </span>
        </div>
        {connected && uptime > 0 && (
          <span className="text-text-4">Up {fmtUptime(uptime)}</span>
        )}
        {connected && agentCount > 0 && (
          <span className="text-text-4">{runningCount}/{agentCount} agents</span>
        )}
      </div>

      <div className="flex-1" />

      {/* Right: docs + terminal toggle */}
      <a
        href="https://docs.groovedev.ai"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-2 h-full text-text-3 hover:text-text-1 hover:bg-surface-5 transition-colors no-underline"
      >
        <BookOpen size={12} />
        <span>Docs</span>
      </a>
      <button
        onClick={onToggleTerminal}
        className={cn(
          'flex items-center gap-1.5 px-2 h-full transition-colors cursor-pointer',
          terminalVisible
            ? 'text-accent bg-accent/8 hover:bg-accent/12'
            : 'text-text-3 hover:text-text-1 hover:bg-surface-5',
        )}
      >
        <Terminal size={12} />
        <span>Terminal</span>
        <kbd className="font-mono text-text-4 ml-0.5">Cmd+J</kbd>
      </button>
    </footer>
  );
}
