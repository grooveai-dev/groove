// GROOVE — tmux Terminal Adapter
// FSL-1.1-Apache-2.0 — see LICENSE

import { execFileSync } from 'child_process';
import { TerminalAdapter } from './base.js';

export class TmuxTerminal extends TerminalAdapter {
  static name = 'tmux';
  static displayName = 'tmux';

  static isAvailable() {
    try {
      execFileSync('which', ['tmux'], { stdio: 'ignore' });
      return !!process.env.TMUX;
    } catch {
      return false;
    }
  }

  createPane(options) {
    try {
      const output = execFileSync('tmux', [
        'split-window', '-h', '-d', '-P', '-F', '#{pane_id}',
        options.command || 'bash',
      ], { encoding: 'utf8' }).trim();

      return { type: 'tmux', paneId: output };
    } catch (err) {
      console.error('  tmux: Failed to create pane:', err.message);
      return { type: 'background', id: options.agentId };
    }
  }

  closePane(paneId) {
    if (!this.isValidPaneId(paneId)) return;
    try {
      execFileSync('tmux', ['kill-pane', '-t', paneId], { stdio: 'ignore' });
    } catch {
      // Pane may already be closed
    }
  }

  sendKeys(paneId, keys) {
    if (!this.isValidPaneId(paneId)) return;
    try {
      execFileSync('tmux', ['send-keys', '-t', paneId, keys, 'Enter'], { stdio: 'ignore' });
    } catch {
      // Ignore errors
    }
  }

  notify(message) {
    try {
      execFileSync('tmux', ['display-message', String(message).slice(0, 200)], { stdio: 'ignore' });
    } catch {
      // tmux not available or not in session
    }
  }

  isValidPaneId(paneId) {
    // tmux pane IDs are like %0, %1, %12
    return typeof paneId === 'string' && /^%\d+$/.test(paneId);
  }
}
