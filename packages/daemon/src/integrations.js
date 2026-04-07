// GROOVE — Integration Store (MCP Server Management)
// FSL-1.1-Apache-2.0 — see LICENSE

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
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

    return { id: integrationId, installed, configured, envKeys };
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
    if (entry.authType !== 'oauth-google') throw new Error('Integration does not use OAuth');

    // Check if user has provided their own Google OAuth client (stored globally)
    const clientId = this.getCredential('google-oauth', 'GOOGLE_CLIENT_ID');
    const clientSecret = this.getCredential('google-oauth', 'GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth not configured. Set up your Google Cloud project first.');
    }

    const port = this.daemon.port || 31415;
    const redirectUri = `http://localhost:${port}/api/integrations/oauth/callback`;
    const scopes = entry.oauthScopes || [];

    const params = new URLSearchParams({
      client_id: clientId,
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
  async handleOAuthCallback(code, integrationId) {
    const clientId = this.getCredential('google-oauth', 'GOOGLE_CLIENT_ID');
    const clientSecret = this.getCredential('google-oauth', 'GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth credentials not found');
    }

    const port = this.daemon.port || 31415;
    const redirectUri = `http://localhost:${port}/api/integrations/oauth/callback`;

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

    // Store the tokens for this integration
    this.setCredential(integrationId, 'GOOGLE_CLIENT_ID', clientId);
    this.setCredential(integrationId, 'GOOGLE_CLIENT_SECRET', clientSecret);
    if (tokens.refresh_token) {
      this.setCredential(integrationId, 'GOOGLE_REFRESH_TOKEN', tokens.refresh_token);
    }

    this.daemon.audit.log('integration.oauth.complete', { id: integrationId });

    return { ok: true, integrationId };
  }

  /**
   * Check if Google OAuth is configured (user has set up their Cloud project).
   */
  isGoogleOAuthConfigured() {
    const clientId = this.getCredential('google-oauth', 'GOOGLE_CLIENT_ID');
    const clientSecret = this.getCredential('google-oauth', 'GOOGLE_CLIENT_SECRET');
    return !!(clientId && clientSecret);
  }

  /**
   * Pre-authenticate an auto-auth integration by running its MCP server briefly.
   * The server will open a browser for OAuth. Once auth completes, the server
   * stores tokens locally so future agent spawns work without prompting.
   * Returns a handle to track the auth process.
   */
  authenticate(integrationId) {
    const entry = this.registry.find((s) => s.id === integrationId);
    if (!entry) throw new Error(`Integration not found: ${integrationId}`);

    const command = entry.command || 'npx';
    const args = entry.args || ['-y', entry.npmPackage];

    // Build env with any configured credentials
    const env = {};
    for (const ek of (entry.envKeys || [])) {
      const val = this.getCredential(integrationId, ek.key);
      if (val) env[ek.key] = val;
    }

    // Spawn the MCP server — it will trigger OAuth on startup
    const proc = cpSpawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });

    // Auto-kill after 2 minutes (auth should complete well before that)
    const timeout = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    }, 120_000);

    proc.on('exit', () => clearTimeout(timeout));

    this.daemon.audit.log('integration.authenticate', { id: integrationId });

    return {
      pid: proc.pid,
      kill: () => { clearTimeout(timeout); try { proc.kill('SIGTERM'); } catch { /* ignore */ } },
    };
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
