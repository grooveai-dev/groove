// GROOVE — Axom Provider (Endpoint Runtime)
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Axom is an ENDPOINT provider, not a CLI provider: the runtime is a daemon
// (`axom serve`, default port 8737) that GROOVE connects to over the Axom
// provider protocol. Sessions stream envelope events; the AxomConnector
// (src/axom-connector.js) owns the live connection. v0 has no session-create
// verb, so agents are not spawnable — the Axom tab is the surface.

import { Provider } from './base.js';
import { AXOM_DEFAULT_PORT } from '../axom-connector.js';

let _daemonRef = null;
export function bindDaemon(daemon) { _daemonRef = daemon; }

export class AxomProvider extends Provider {
  static name = 'axom';
  static displayName = 'Axom';
  static command = 'axom';
  static authType = 'endpoint'; // configured URL, no key — auth is a v1 protocol item
  static managesOwnContext = true; // memory ledger + rotation live in the runtime
  static singleTask = false;
  static models = []; // the live roster comes from GET /about, not a static list

  static isInstalled() {
    return (_daemonRef?.config?.axom?.endpoints || []).length > 0;
  }

  // Settings renders this verbatim as text (string contract — Ollama's object
  // shape only survives because its render branch never fires when installed).
  static installCommand() {
    return 'axom serve';
  }

  static async isServerRunning(url = `http://127.0.0.1:${AXOM_DEFAULT_PORT}`) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${url.replace(/\/+$/, '')}/about`, { signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  buildSpawnCommand() {
    throw new Error('Axom sessions are not spawnable in v0 — configure an endpoint and use the Axom tab');
  }

  buildHeadlessCommand() {
    throw new Error('Axom has no headless command — it is an endpoint runtime, not a CLI');
  }

  static setupGuide() {
    return {
      installSteps: [
        'Install the Axom runtime on the machine that will run it (localhost is the default topology)',
        `Start it with: axom serve  (binds 127.0.0.1:${AXOM_DEFAULT_PORT})`,
        'In GROOVE, open the Axom tab and add the endpoint URL',
      ],
      authMethods: [],
      authInstructions: {},
    };
  }
}
