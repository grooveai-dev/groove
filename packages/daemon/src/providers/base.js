// GROOVE — Base Provider Interface
// FSL-1.1-Apache-2.0 — see LICENSE

export class Provider {
  static name = 'base';
  static displayName = 'Base Provider';
  static command = '';
  static authType = 'none'; // 'subscription' | 'api-key' | 'local' | 'none'
  static managesOwnContext = false; // true if provider compacts context internally (e.g. Claude Code)
  static models = [];

  static isInstalled() {
    return false;
  }

  static installCommand() {
    return '';
  }

  buildSpawnCommand(agent) {
    throw new Error('Provider must implement buildSpawnCommand()');
  }

  buildHeadlessCommand(prompt, model) {
    throw new Error('Provider must implement buildHeadlessCommand()');
  }

  switchModel(agent, newModel) {
    return false; // Default: no hot-swap, needs rotation
  }

  parseOutput(line) {
    return null;
  }

  streamChat(messages, model, apiKey, onChunk, onDone, onError) {
    return null;
  }
}
