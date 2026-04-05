// GROOVE — Generic Terminal Adapter (fallback)
// FSL-1.1-Apache-2.0 — see LICENSE

import { TerminalAdapter } from './base.js';

export class GenericTerminal extends TerminalAdapter {
  static name = 'generic';
  static displayName = 'Generic Terminal';

  static isAvailable() {
    return true; // Always available as fallback
  }

  createPane(options) {
    // In generic mode, agents run as background processes
    // managed directly by the ProcessManager
    return { type: 'background', id: options.agentId };
  }

  closePane(paneId) {
    // Process cleanup handled by ProcessManager
  }

  sendKeys(paneId, keys) {
    // Not supported in generic mode
  }
}
