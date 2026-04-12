// GROOVE — MCP Manager (Provider-Agnostic Integration Execution)
// FSL-1.1-Apache-2.0 — see LICENSE

import { spawn as cpSpawn } from 'child_process';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_RETRIES = 3;

export class McpManager {
  constructor(daemon) {
    this.daemon = daemon;
    this.servers = new Map();
    this._crashCounts = new Map();
    this._nextId = 1;
  }

  async startServer(integrationId) {
    if (this.servers.has(integrationId)) {
      const existing = this.servers.get(integrationId);
      if (existing.proc && !existing.proc.killed) {
        return existing.tools;
      }
      this._cleanup(integrationId);
    }

    const entry = this.daemon.integrations.registry.find((s) => s.id === integrationId);
    if (!entry) throw new Error(`Integration not found: ${integrationId}`);

    if (!this.daemon.integrations._isInstalled(integrationId)) {
      throw new Error(`Integration not installed: ${integrationId}`);
    }

    if ((this._crashCounts.get(integrationId) || 0) >= MAX_RETRIES) {
      throw new Error(`Integration ${integrationId} crashed ${MAX_RETRIES} times — not restarting`);
    }

    const command = entry.command || 'npx';
    const args = entry.args || ['-y', entry.npmPackage];

    const env = { ...process.env };
    const spawnEnv = this.daemon.integrations.getSpawnEnv([integrationId]);
    Object.assign(env, spawnEnv);

    const proc = cpSpawn(command, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });

    const server = {
      proc,
      integrationId,
      tools: [],
      pending: new Map(),
      buffer: '',
      lastCall: Date.now(),
      idleTimer: null,
    };

    this.servers.set(integrationId, server);

    proc.stdout.on('data', (chunk) => {
      server.buffer += chunk.toString();
      this._processBuffer(server);
    });

    proc.stderr.on('data', (chunk) => {
      console.log(`[Groove:MCP:${integrationId}] stderr: ${chunk.toString().slice(0, 200)}`);
    });

    proc.on('error', (err) => {
      console.log(`[Groove:MCP:${integrationId}] Process error: ${err.message}`);
      this._handleCrash(integrationId);
    });

    proc.on('exit', (code, signal) => {
      console.log(`[Groove:MCP:${integrationId}] Process exited: code=${code} signal=${signal}`);
      if ((code !== 0 && code !== null) || (code === null && signal)) {
        this._handleCrash(integrationId);
      }
    });

    const tools = await this._initialize(server);
    server.tools = tools;
    this._crashCounts.delete(integrationId);
    this._resetIdleTimer(server);

    console.log(`[Groove:MCP:${integrationId}] Started — ${tools.length} tools available`);
    return tools;
  }

  stopServer(integrationId) {
    const server = this.servers.get(integrationId);
    if (!server) return;
    this._cleanup(integrationId);
    console.log(`[Groove:MCP:${integrationId}] Stopped`);
  }

  async execTool(integrationId, toolName, params) {
    let server = this.servers.get(integrationId);
    if (!server || server.proc.killed) {
      await this.startServer(integrationId);
      server = this.servers.get(integrationId);
    }
    if (!server) throw new Error(`Failed to start MCP server for ${integrationId}`);

    server.lastCall = Date.now();
    this._resetIdleTimer(server);

    const id = this._nextId++;
    const msg = {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: toolName, arguments: params || {} },
    };

    const result = await this._sendRequest(server, id, msg);

    if (result.error) {
      throw new Error(result.error.message || JSON.stringify(result.error));
    }

    return result.result;
  }

  async listTools(integrationId) {
    const server = this.servers.get(integrationId);
    if (server && !server.proc.killed && server.tools.length > 0) {
      return server.tools;
    }
    return this.startServer(integrationId);
  }

  stopAll() {
    for (const integrationId of this.servers.keys()) {
      this._cleanup(integrationId);
    }
    console.log('[Groove:MCP] All servers stopped');
  }

  _processBuffer(server) {
    const lines = server.buffer.split('\n');
    server.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id !== undefined && server.pending.has(msg.id)) {
          const { resolve } = server.pending.get(msg.id);
          server.pending.delete(msg.id);
          resolve(msg);
        }
      } catch {
        // Not JSON — ignore
      }
    }
  }

  _sendRequest(server, id, msg) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        server.pending.delete(id);
        reject(new Error(`MCP request timed out (id=${id}, method=${msg.method})`));
      }, 30_000);

      server.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
      });

      try {
        server.proc.stdin.write(JSON.stringify(msg) + '\n');
      } catch (err) {
        clearTimeout(timeout);
        server.pending.delete(id);
        reject(new Error(`Failed to write to MCP server: ${err.message}`));
      }
    });
  }

  async _initialize(server) {
    const initId = this._nextId++;
    const initMsg = {
      jsonrpc: '2.0',
      id: initId,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'groove', version: '1.0.0' },
      },
    };

    const initResp = await this._sendRequest(server, initId, initMsg);
    if (initResp.error) {
      throw new Error(initResp.error.message || 'MCP initialize failed');
    }

    const notif = { jsonrpc: '2.0', method: 'notifications/initialized' };
    try {
      server.proc.stdin.write(JSON.stringify(notif) + '\n');
    } catch {
      throw new Error('MCP server died during initialization');
    }

    const listId = this._nextId++;
    const listMsg = {
      jsonrpc: '2.0',
      id: listId,
      method: 'tools/list',
      params: {},
    };

    const listResp = await this._sendRequest(server, listId, listMsg);
    return listResp.result?.tools || [];
  }

  _handleCrash(integrationId) {
    const server = this.servers.get(integrationId);
    if (!server) return;

    for (const [, { resolve }] of server.pending) {
      resolve({ error: { message: 'MCP server crashed' } });
    }
    server.pending.clear();

    const crashes = (this._crashCounts.get(integrationId) || 0) + 1;
    this._crashCounts.set(integrationId, crashes);

    if (crashes >= MAX_RETRIES) {
      console.log(`[Groove:MCP:${integrationId}] Max retries reached (${crashes}/${MAX_RETRIES}) — giving up`);
    } else {
      console.log(`[Groove:MCP:${integrationId}] Crash ${crashes}/${MAX_RETRIES} — will restart on next call`);
    }
    this._cleanup(integrationId);
  }

  _resetIdleTimer(server) {
    if (server.idleTimer) clearTimeout(server.idleTimer);
    server.idleTimer = setTimeout(() => {
      console.log(`[Groove:MCP:${server.integrationId}] Idle timeout — stopping`);
      this.stopServer(server.integrationId);
    }, IDLE_TIMEOUT_MS);
  }

  _cleanup(integrationId) {
    const server = this.servers.get(integrationId);
    if (!server) return;

    if (server.idleTimer) clearTimeout(server.idleTimer);

    for (const [, { resolve }] of server.pending) {
      resolve({ error: { message: 'MCP server stopped' } });
    }
    server.pending.clear();

    try {
      if (server.proc && !server.proc.killed) {
        server.proc.kill('SIGTERM');
      }
    } catch { /* ignore */ }

    this.servers.delete(integrationId);
  }
}
