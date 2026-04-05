// GROOVE — Base Terminal Adapter
// FSL-1.1-Apache-2.0 — see LICENSE

export class TerminalAdapter {
  static name = 'base';
  static displayName = 'Base Terminal';

  static isAvailable() {
    return false;
  }

  createPane(options) {
    throw new Error('Terminal adapter must implement createPane()');
  }

  closePane(paneId) {
    throw new Error('Terminal adapter must implement closePane()');
  }

  sendKeys(paneId, keys) {
    throw new Error('Terminal adapter must implement sendKeys()');
  }

  notify(message) {
    // Default: no-op
  }
}
