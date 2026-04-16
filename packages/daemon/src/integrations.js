// GROOVE — Integration Store (MCP Server Management)
// FSL-1.1-Apache-2.0 — see LICENSE

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'fs';
import { resolve, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawn as cpSpawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const INTEGRATIONS_API = 'https://docs.groovedev.ai/api/v1';

export class IntegrationStore {
  constructor(daemon) {
    this.daemon = daemon;
    this.integrationsDir = resolve(daemon.grooveDir, 'integrations');
    mkdirSync(this.integrationsDir, { recursive: true });

    // Load bundled registry as fallback
    this.registry = [];
    try {
      const regPath = resolve(__dirname, '../integrations-registry.json');
      this.registry = JSON.parse(readFileSync(regPath, 'utf8'));
    } catch { /* no registry file */ }

    // Ensure the integrations directory has a package.json for npm installs
    this._ensurePackageJson();

    // Fetch live registry in background
    this._refreshRegistry();
  }

  _ensurePackageJson() {
    const pkgPath = resolve(this.integrationsDir, 'package.json');
    if (!existsSync(pkgPath)) {
      writeFileSync(pkgPath, JSON.stringify({
        name: 'groove-integrations',
        version: '1.0.0',
        private: true,
        description: 'MCP server packages managed by Groove',
      }, null, 2));
    }
  }

  async _refreshRegistry() {
    try {
      const res = await fetch(`${INTEGRATIONS_API}/integrations?limit=200`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        this.registry = data.integrations || data;
      }
    } catch { /* offline — use bundled */ }
  }

  /**
   * Get integrations from the registry with optional search/category filter.
   */
  async getRegistry(query) {
    let items = this.registry.map((s) => ({
      ...s,
      installed: this._isInstalled(s.id),
      configured: this._isConfigured(s),
    }));

    if (query?.search) {
      const q = query.search.toLowerCase();
      items = items.filter((s) =>
        s.name.toLowerCase().includes(q)
        || s.description.toLowerCase().includes(q)
        || (s.tags || []).some((t) => t.includes(q))
      );
    }

    if (query?.category && query.category !== 'all') {
      items = items.filter((s) => s.category === query.category);
    }

    return items;
  }

  /**
   * Get installed integrations only.
   */
  getInstalled() {
    const installed = [];
    const metaPath = resolve(this.integrationsDir, 'installed.json');
    let installedMeta = {};
    if (existsSync(metaPath)) {
      try { installedMeta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch { /* ignore */ }
    }

    for (const [id, meta] of Object.entries(installedMeta)) {
      const regEntry = this.registry.find((r) => r.id === id);
      if (!regEntry && !meta) continue;
      installed.push({
        ...(regEntry || {}),
        ...meta,
        id,
        installed: true,
        configured: this._isConfigured(regEntry || meta),
      });
    }

    return installed;
  }

  /**
   * Get available categories from the registry.
   */
  getCategories() {
    const cats = new Map();
    for (const item of this.registry) {
      const count = cats.get(item.category) || 0;
      cats.set(item.category, count + 1);
    }
    return Array.from(cats.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Install an integration (npm install the MCP server package).
   */
  async install(integrationId) {
    const entry = this.registry.find((s) => s.id === integrationId);
    if (!entry) throw new Error(`Integration not found: ${integrationId}`);
    if (this._isInstalled(integrationId)) throw new Error(`Integration already installed: ${integrationId}`);

    if (entry.npmPackage) {
      try {
        execFileSync('npm', ['install', entry.npmPackage], {
          cwd: this.integrationsDir,
          stdio: 'pipe',
          timeout: 120_000,
        });
      } catch (err) {
        throw new Error(`Failed to install ${entry.npmPackage}: ${err.message}`);
      }
    }

    // Record installation metadata
    const metaPath = resolve(this.integrationsDir, 'installed.json');
    let installedMeta = {};
    if (existsSync(metaPath)) {
      try { installedMeta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch { /* ignore */ }
    }
    installedMeta[integrationId] = {
      name: entry.name,
      installedAt: new Date().toISOString(),
      npmPackage: entry.npmPackage,
    };
    writeFileSync(metaPath, JSON.stringify(installedMeta, null, 2));

    this.daemon.audit.log('integration.install', { id: integrationId, name: entry.name });

    return { id: integrationId, name: entry.name, installed: true };
  }

  /**
   * Uninstall an integration.
   */
  async uninstall(integrationId) {
    if (!this._isInstalled(integrationId)) throw new Error(`Integration not installed: ${integrationId}`);

    const entry = this.registry.find((s) => s.id === integrationId);
    if (entry?.npmPackage) {
      try {
        execFileSync('npm', ['uninstall', entry.npmPackage], {
          cwd: this.integrationsDir,
          stdio: 'pipe',
          timeout: 60_000,
        });
      } catch { /* best effort */ }
    }

    // Remove from installed metadata
    const metaPath = resolve(this.integrationsDir, 'installed.json');
    let installedMeta = {};
    if (existsSync(metaPath)) {
      try { installedMeta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch { /* ignore */ }
    }
    delete installedMeta[integrationId];
    writeFileSync(metaPath, JSON.stringify(installedMeta, null, 2));

    // Remove credentials for this integration
    this._removeCredentials(integrationId);

    this.daemon.audit.log('integration.uninstall', { id: integrationId });

    return { id: integrationId, installed: false };
  }

  /**
   * Set a credential for an integration.
   */
  setCredential(integrationId, key, value) {
    const credKey = `integration:${integrationId}:${key}`;
    this.daemon.credentials.setKey(credKey, value);
    this.daemon.audit.log('integration.credential.set', { id: integrationId, key });
  }

  /**
   * Get a credential for an integration.
   */
  getCredential(integrationId, key) {
    const credKey = `integration:${integrationId}:${key}`;
    return this.daemon.credentials.getKey(credKey);
  }

  /**
   * Delete a credential for an integration.
   */
  deleteCredential(integrationId, key) {
    const credKey = `integration:${integrationId}:${key}`;
    this.daemon.credentials.deleteKey(credKey);
  }

  /**
   * Get the status of an integration (installed, configured, credential keys).
   */
  getStatus(integrationId) {
    const entry = this.registry.find((s) => s.id === integrationId);
    if (!entry) return null;

    const installed = this._isInstalled(integrationId);
    const envKeys = (entry.envKeys || []).map((ek) => ({
      ...ek,
      set: !!this.getCredential(integrationId, ek.key),
    }));
    const configured = envKeys.length === 0 || envKeys.every((ek) => !ek.required || ek.set);

    let authenticated = false;
    if (entry.authType === 'google-autoauth' && entry.oauthKeysDir) {
      const homedir = process.env.HOME || process.env.USERPROFILE || '~';
      authenticated = existsSync(resolve(homedir, entry.oauthKeysDir, 'credentials.json'));
    } else if (entry.authType === 'oauth-google') {
      authenticated = !!this.getCredential(integrationId, 'GOOGLE_REFRESH_TOKEN');
    } else if (entry.authType === 'api-key') {
      authenticated = configured;
    }

    let needsReauth = false;
    if (authenticated && entry.oauthScopes?.length) {
      const raw = this.getCredential(integrationId, 'GOOGLE_AUTHORIZED_SCOPES');
      if (raw) {
        try {
          const authorized = new Set(JSON.parse(raw));
          needsReauth = entry.oauthScopes.some((s) => !authorized.has(s));
        } catch {}
      } else {
        needsReauth = true;
      }
    }

    return { id: integrationId, installed, configured, envKeys, authenticated, needsReauth };
  }

  /**
   * Build MCP config object for a set of integration IDs.
   * Returns the mcpServers object to merge into .mcp.json.
   * SECURITY: credentials are NOT included in the config file.
   * They are injected at spawn time via process environment only.
   */
  buildMcpConfig(integrationIds) {
    const mcpServers = {};

    for (const id of integrationIds) {
      const entry = this.registry.find((s) => s.id === id);
      if (!entry) continue;
      if (!this._isInstalled(id)) continue;

      // No env block — credentials stay out of .mcp.json
      mcpServers[`groove-${id}`] = {
        command: entry.command || 'npx',
        args: entry.args || ['-y', entry.npmPackage],
      };
    }

    return mcpServers;
  }

  /**
   * Get environment variables with decrypted credentials for a set of integration IDs.
   * These are passed to the agent process at spawn time (in-memory only, never written to disk).
   */
  getSpawnEnv(integrationIds) {
    const env = {};
    for (const id of integrationIds) {
      const entry = this.registry.find((s) => s.id === id);
      if (!entry) continue;
      for (const ek of (entry.envKeys || [])) {
        const val = this.getCredential(id, ek.key);
        if (val) env[ek.key] = val;
      }
    }
    return env;
  }

  /**
   * Write/merge MCP config into the project root .mcp.json.
   * Only adds/updates groove-* entries, preserves user's own MCP configs.
   */
  writeMcpJson(integrationIds) {
    const mcpJsonPath = resolve(this.daemon.projectDir, '.mcp.json');
    let existing = {};

    // Read existing .mcp.json if present
    if (existsSync(mcpJsonPath)) {
      try {
        existing = JSON.parse(readFileSync(mcpJsonPath, 'utf8'));
      } catch { /* start fresh */ }
    }

    // Build MCP config for requested integrations
    const grooveServers = this.buildMcpConfig(integrationIds);

    // Remove all existing groove-* entries first
    if (existing.mcpServers) {
      for (const key of Object.keys(existing.mcpServers)) {
        if (key.startsWith('groove-')) {
          delete existing.mcpServers[key];
        }
      }
    }

    // Merge groove entries
    existing.mcpServers = { ...(existing.mcpServers || {}), ...grooveServers };

    writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2));
  }

  /**
   * Remove all groove-* entries from .mcp.json.
   * If only groove entries remain, delete the file.
   */
  cleanupMcpJson() {
    const mcpJsonPath = resolve(this.daemon.projectDir, '.mcp.json');
    if (!existsSync(mcpJsonPath)) return;

    try {
      const config = JSON.parse(readFileSync(mcpJsonPath, 'utf8'));
      if (!config.mcpServers) return;

      // Remove groove-* entries
      let hasUserEntries = false;
      for (const key of Object.keys(config.mcpServers)) {
        if (key.startsWith('groove-')) {
          delete config.mcpServers[key];
        } else {
          hasUserEntries = true;
        }
      }

      if (hasUserEntries) {
        writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2));
      } else if (Object.keys(config.mcpServers).length === 0) {
        // If we created this file and it's now empty, remove it
        // Only if no other top-level keys besides mcpServers
        const otherKeys = Object.keys(config).filter((k) => k !== 'mcpServers');
        if (otherKeys.length === 0) {
          rmSync(mcpJsonPath);
        } else {
          writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2));
        }
      }
    } catch { /* ignore cleanup errors */ }
  }

  /**
   * Get the combined set of integration IDs from all running agents.
   */
  getActiveIntegrations() {
    const agents = this.daemon.registry.getAll().filter(
      (a) => a.status === 'running' || a.status === 'starting'
    );
    const ids = new Set();
    for (const agent of agents) {
      for (const id of (agent.integrations || [])) {
        ids.add(id);
      }
    }
    return Array.from(ids);
  }

  /**
   * Refresh .mcp.json to reflect all currently running agents' integrations.
   */
  refreshMcpJson() {
    const activeIntegrations = this.getActiveIntegrations();
    if (activeIntegrations.length > 0) {
      this.writeMcpJson(activeIntegrations);
    } else {
      this.cleanupMcpJson();
    }
  }

  /**
   * Start an OAuth flow for a Google integration.
   * Returns the authorization URL to open in a browser.
   */
  getOAuthUrl(integrationId) {
    const entry = this.registry.find((s) => s.id === integrationId);
    if (!entry) throw new Error(`Integration not found: ${integrationId}`);
    if (entry.authType !== 'oauth-google' && entry.authType !== 'google-autoauth') {
      throw new Error('Integration does not use Google OAuth');
    }

    const creds = this._getGoogleOAuthCredentials();
    if (!creds) {
      throw new Error('Google OAuth not configured. Set up your Google Cloud project first.');
    }

    const redirectUri = `http://localhost:${this.daemon.port}/api/integrations/oauth/callback`;
    const scopes = entry.oauthScopes || [];

    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: integrationId,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  /**
   * Handle OAuth callback — exchange code for tokens.
   */
  async handleOAuthCallback(code, stateParam, redirectUri) {
    const creds = this._getGoogleOAuthCredentials();
    if (!creds) {
      throw new Error('Google OAuth credentials not found');
    }
    const { clientId, clientSecret } = creds;

    if (!redirectUri) {
      redirectUri = `http://localhost:${this.daemon.port}/api/integrations/oauth/callback`;
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`OAuth token exchange failed: ${err.error_description || err.error || 'unknown'}`);
    }

    const tokens = await res.json();

    // State can be a single ID or comma-separated list for combined auth
    const integrationIds = stateParam.split(',').filter(Boolean);

    for (const integrationId of integrationIds) {
      this.setCredential(integrationId, 'GOOGLE_CLIENT_ID', clientId);
      this.setCredential(integrationId, 'GOOGLE_CLIENT_SECRET', clientSecret);
      if (tokens.refresh_token) {
        this.setCredential(integrationId, 'GOOGLE_REFRESH_TOKEN', tokens.refresh_token);
      }

      const entry = this.registry.find((s) => s.id === integrationId);
      if (entry?.oauthScopes) {
        this.setCredential(integrationId, 'GOOGLE_AUTHORIZED_SCOPES', JSON.stringify(entry.oauthScopes));
      }

      if (entry?.authType === 'google-autoauth' && entry.oauthKeysDir && tokens.refresh_token) {
        this._writeAutoauthCredentials(entry, clientId, clientSecret, tokens.refresh_token);
      }

      this.daemon.audit.log('integration.oauth.complete', { id: integrationId });
    }

    return { ok: true, integrationIds };
  }

  /**
   * Build a combined OAuth URL for multiple Google integrations at once.
   * Aggregates scopes and uses comma-separated state.
   */
  getGoogleWorkspaceOAuthUrl(integrationIds) {
    const creds = this._getGoogleOAuthCredentials();
    if (!creds) {
      throw new Error('Google OAuth not configured. Set up your Google Cloud project first.');
    }

    const allScopes = new Set();
    for (const id of integrationIds) {
      const entry = this.registry.find((s) => s.id === id);
      if (entry?.oauthScopes) {
        for (const scope of entry.oauthScopes) allScopes.add(scope);
      }
    }

    const redirectUri = `http://localhost:${this.daemon.port}/api/integrations/oauth/callback`;

    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: Array.from(allScopes).join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: integrationIds.join(','),
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  /**
   * Check if Google OAuth is configured (user has set up their Cloud project).
   */
  /**
   * Get Google OAuth credentials from user config OR bundled defaults.
   * User-configured credentials take priority over bundled defaults.
   */
  _getGoogleOAuthCredentials() {
    // 1. Check user-configured credentials (encrypted store)
    let clientId = this.getCredential('google-oauth', 'GOOGLE_CLIENT_ID');
    let clientSecret = this.getCredential('google-oauth', 'GOOGLE_CLIENT_SECRET');
    if (clientId && clientSecret) return { clientId, clientSecret, source: 'user' };

    // 2. Check bundled defaults (shipped with Groove)
    try {
      const defaultsPath = resolve(__dirname, '../google-oauth.json');
      if (existsSync(defaultsPath)) {
        const defaults = JSON.parse(readFileSync(defaultsPath, 'utf8'));
        if (defaults.client_id && defaults.client_secret) {
          return { clientId: defaults.client_id, clientSecret: defaults.client_secret, source: 'bundled' };
        }
      }
    } catch { /* no bundled defaults */ }

    return null;
  }

  isGoogleOAuthConfigured() {
    return !!this._getGoogleOAuthCredentials();
  }

  /**
   * Pre-authenticate an auto-auth integration by running its MCP server
   * and sending the MCP handshake (initialize + tools/list). This triggers
   * the server's built-in OAuth flow which opens a browser for sign-in.
   * Returns a handle to track the auth process.
   */
  authenticate(integrationId) {
    const entry = this.registry.find((s) => s.id === integrationId);
    if (!entry) throw new Error(`Integration not found: ${integrationId}`);

    console.log(`[Groove:Integrations] authenticate(${integrationId}) — authType: ${entry.authType}`);

    // For google-autoauth integrations, write the gcp-oauth.keys.json file
    // that the MCP server expects before it can start the OAuth browser flow
    if (entry.authType === 'google-autoauth') {
      console.log(`[Groove:Integrations] Writing gcp-oauth.keys.json for ${integrationId}`);
      this._writeGoogleOAuthKeys(entry);
    }

    const command = entry.command || 'npx';
    const args = entry.args || ['-y', entry.npmPackage];
    console.log(`[Groove:Integrations] Spawning: ${command} ${args.join(' ')}`);

    // Build env with any configured credentials
    const env = {};
    for (const ek of (entry.envKeys || [])) {
      const val = this.getCredential(integrationId, ek.key);
      if (val) env[ek.key] = val;
    }

    // Spawn the MCP server with stdin/stdout for JSON-RPC,
    // stderr inherited so it can open browsers and show auth prompts
    const proc = cpSpawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'inherit'],
      detached: false,
    });

    console.log(`[Groove:Integrations] Process spawned, PID: ${proc.pid}`);

    // Send MCP handshake to initialize the server — this triggers auth
    const initMsg = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'groove', version: '1.0.0' },
      },
    });
    const listToolsMsg = JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    });
    const initializedNotif = JSON.stringify({
      jsonrpc: '2.0', method: 'notifications/initialized',
    });

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      console.log(`[Groove:Integrations] MCP stdout: ${text.slice(0, 200)}`);
      // After initialize response, send initialized notification + tools/list
      if (text.includes('"id":1') || text.includes('"id": 1')) {
        console.log('[Groove:Integrations] Got initialize response, sending initialized + tools/list');
        proc.stdin.write(initializedNotif + '\n');
        setTimeout(() => proc.stdin.write(listToolsMsg + '\n'), 500);
      }
    });

    proc.on('error', (err) => {
      console.log(`[Groove:Integrations] Process error: ${err.message}`);
    });

    proc.on('exit', (code, signal) => {
      console.log(`[Groove:Integrations] Process exited: code=${code} signal=${signal}`);
      clearTimeout(timeout);
    });

    // Send initialize after a brief delay for npx startup
    setTimeout(() => {
      console.log('[Groove:Integrations] Sending MCP initialize message');
      try { proc.stdin.write(initMsg + '\n'); } catch (e) { console.log('[Groove:Integrations] stdin write failed:', e.message); }
    }, 3000);

    // Auto-kill after 2 minutes
    const timeout = setTimeout(() => {
      console.log('[Groove:Integrations] Auth timeout — killing process');
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    }, 120_000);

    this.daemon.audit.log('integration.authenticate', { id: integrationId });

    return {
      pid: proc.pid,
      kill: () => { clearTimeout(timeout); try { proc.kill('SIGTERM'); } catch { /* ignore */ } },
    };
  }

  /**
   * Write gcp-oauth.keys.json for Google auto-auth MCP servers.
   * These servers need a Google Cloud OAuth client file at a specific path
   * before they can open the browser for user consent.
   */
  _writeGoogleOAuthKeys(entry) {
    const creds = this._getGoogleOAuthCredentials();
    if (!creds) {
      throw new Error('Google OAuth not configured. Set up your Google Cloud credentials first.');
    }
    const { clientId, clientSecret } = creds;

    const keysContent = JSON.stringify({
      installed: {
        client_id: clientId,
        client_secret: clientSecret,
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        redirect_uris: ['http://localhost'],
      },
    }, null, 2);

    const keysDir = entry.oauthKeysDir;
    if (keysDir) {
      const homedir = process.env.HOME || process.env.USERPROFILE || '~';
      const dirPath = resolve(homedir, keysDir);
      mkdirSync(dirPath, { recursive: true });
      const keysPath = resolve(dirPath, 'gcp-oauth.keys.json');
      writeFileSync(keysPath, keysContent, { mode: 0o600 });
      console.log(`[Groove:Integrations] Wrote OAuth keys to: ${keysPath}`);
    } else {
      console.log(`[Groove:Integrations] WARNING: No oauthKeysDir for ${entry.id}`);
    }
  }

  /**
   * Write credential files for google-autoauth MCP servers after OAuth completes.
   * Writes both the keys file (client config) and credentials file (refresh token)
   * so the MCP server finds valid auth at runtime without its own browser flow.
   */
  _writeAutoauthCredentials(entry, clientId, clientSecret, refreshToken) {
    const homedir = process.env.HOME || process.env.USERPROFILE || '~';
    const dirPath = resolve(homedir, entry.oauthKeysDir);
    mkdirSync(dirPath, { recursive: true });

    // Write the OAuth client config (gcp-oauth.keys.json)
    const keysPath = resolve(dirPath, 'gcp-oauth.keys.json');
    writeFileSync(keysPath, JSON.stringify({
      installed: {
        client_id: clientId,
        client_secret: clientSecret,
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        redirect_uris: ['http://localhost'],
      },
    }, null, 2), { mode: 0o600 });

    // Write the user credentials (credentials.json) in Google authorized_user format
    const credPath = resolve(dirPath, 'credentials.json');
    writeFileSync(credPath, JSON.stringify({
      type: 'authorized_user',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }, null, 2), { mode: 0o600 });

    console.log(`[Groove:Integrations] Wrote OAuth keys + credentials to: ${dirPath}`);
  }

  // --- Google Drive Upload ---

  static CONVERT_MAP = {
    '.pptx': { source: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', target: 'application/vnd.google-apps.presentation' },
    '.docx': { source: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', target: 'application/vnd.google-apps.document' },
    '.xlsx': { source: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', target: 'application/vnd.google-apps.spreadsheet' },
    '.csv':  { source: 'text/csv', target: 'application/vnd.google-apps.spreadsheet' },
    '.txt':  { source: 'text/plain', target: 'application/vnd.google-apps.document' },
    '.html': { source: 'text/html', target: 'application/vnd.google-apps.document' },
    '.pdf':  { source: 'application/pdf', target: null },
  };

  async getGoogleAccessToken() {
    const creds = this._getGoogleOAuthCredentials();
    if (!creds) throw new Error('Google OAuth not configured');

    const googleIds = ['google-drive', 'google-docs', 'google-sheets', 'google-slides', 'google-calendar', 'gmail'];
    let refreshToken = null;
    for (const id of googleIds) {
      refreshToken = this.getCredential(id, 'GOOGLE_REFRESH_TOKEN');
      if (refreshToken) break;
    }
    if (!refreshToken) throw new Error('No Google refresh token found. Authenticate a Google integration first.');

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Google token refresh failed: ${err.error_description || err.error || 'unknown'}`);
    }

    const data = await res.json();
    return data.access_token;
  }

  async uploadToGoogleDrive(filePath, options = {}) {
    const { name, folderId, convert = true } = options;

    if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

    const accessToken = await this.getGoogleAccessToken();

    const ext = extname(filePath).toLowerCase();
    const fileName = name || basename(filePath);
    const mapping = IntegrationStore.CONVERT_MAP[ext];
    const contentType = mapping?.source || 'application/octet-stream';

    const metadata = { name: fileName };
    if (convert && mapping?.target) metadata.mimeType = mapping.target;
    if (folderId) metadata.parents = [folderId];

    const fileContent = readFileSync(filePath);
    const boundary = `groove_upload_${Date.now()}`;
    const metadataJson = JSON.stringify(metadata);

    const header = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataJson}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--`);
    const body = Buffer.concat([header, fileContent, footer]);

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,mimeType',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.error?.message || res.statusText;
      if (res.status === 403 && msg.includes('insufficient')) {
        throw new Error(`Google Drive upload failed: insufficient permissions. Re-authenticate Google Drive with write access.`);
      }
      throw new Error(`Google Drive upload failed: ${msg}`);
    }

    return res.json();
  }

  // --- Internal ---

  _isInstalled(integrationId) {
    const metaPath = resolve(this.integrationsDir, 'installed.json');
    if (!existsSync(metaPath)) return false;
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      return !!meta[integrationId];
    } catch {
      return false;
    }
  }

  _isConfigured(entry) {
    if (!entry || !entry.envKeys || entry.envKeys.length === 0) return true;
    return entry.envKeys
      .filter((ek) => ek.required)
      .every((ek) => !!this.getCredential(entry.id, ek.key));
  }

  _removeCredentials(integrationId) {
    const entry = this.registry.find((s) => s.id === integrationId);
    if (!entry?.envKeys) return;
    for (const ek of entry.envKeys) {
      try { this.deleteCredential(integrationId, ek.key); } catch { /* ignore */ }
    }
  }
}
