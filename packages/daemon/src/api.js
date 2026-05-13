// GROOVE — REST API
// FSL-1.1-Apache-2.0 — see LICENSE

import express from 'express';
import { resolve, dirname, join, sep, relative, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, unlinkSync, renameSync, rmSync, createReadStream, copyFileSync, realpathSync } from 'fs';
import { spawn, execFile, execFileSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { hostname, networkInterfaces, homedir } from 'os';
import { StringDecoder } from 'string_decoder';
import { request as httpRequest } from 'http';
import { lookup as mimeLookup } from './mimetypes.js';
import { listProviders, getProvider, clearInstallCache, getProviderMetadata, getProviderPath, setProviderPaths, isProviderInstalled } from './providers/index.js';
import { OllamaProvider } from './providers/ollama.js';
import { ClaudeCodeProvider } from './providers/claude-code.js';
import { supportsSignalFlag, compareSemver, parseSemver } from './providers/groove-network.js';
import { ConsentManager } from '../../../moe-training/client/index.js';
import { validateAgentConfig, validateReasoningEffort, validateVerbosity, validateTeamMode, validateLabRuntimeConfig, validateLabInferenceParams, validateLabPresetConfig } from './validate.js';
import { ROLE_INTEGRATIONS, wrapWithRoleReminder } from './process.js';
import { Keeper, KEEPER_COMMANDS } from './keeper.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerCoordinationRoutes } from './routes/coordination.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerTeamRoutes } from './routes/teams.js';
import { registerIntegrationRoutes } from './routes/integrations.js';
import { registerFileRoutes, resetEditorRoot } from './routes/files.js';
import { registerNetworkRoutes } from './routes/network.js';
import { registerScheduleRoutes } from './routes/schedules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

let _daemon = null;

// Single source of truth for Pro features: the signed-in user's subscription
// status, populated by the daemon polling the backend with the stored JWT.
// There is no build-time "Pro edition" flag — one binary, account-gated.
function proOnly(req, res, next) {
  const sub = _daemon?.subscriptionCache || {};
  if (sub.active) return next();
  return res.status(403).json({
    error: 'Pro subscription required',
    edition: 'community',
    plan: sub.plan || 'community',
    subscriptionActive: false,
    upgrade: 'https://groovedev.ai/pro',
  });
}

function hasFeature(name) {
  return (_daemon?.subscriptionCache?.features || []).includes(name);
}

async function _executeApprovalRetry(daemon, approval) {
  const rp = approval.retryPayload;
  if (!rp) return;
  try {
    let resultText;
    if (rp.type === 'integration_exec') {
      const result = await daemon.mcpManager.execTool(rp.integrationId, rp.tool, rp.params);
      resultText = JSON.stringify(result).slice(0, 2000);
      daemon.audit.log('approval.autoRetry', { type: rp.type, integrationId: rp.integrationId, tool: rp.tool, agentId: rp.agentId, approvalId: approval.id });
    } else if (rp.type === 'google_drive_upload') {
      const result = await daemon.integrations.uploadToGoogleDrive(rp.filePath, {
        name: rp.name, folderId: rp.folderId, convert: rp.convert !== false,
      });
      resultText = JSON.stringify(result).slice(0, 2000);
      daemon.audit.log('approval.autoRetry', { type: rp.type, filePath: rp.filePath, agentId: rp.agentId, approvalId: approval.id });
    } else {
      return;
    }
    if (rp.agentId) {
      await daemon.processes.sendMessage(rp.agentId, `Your ${rp.type === 'integration_exec' ? 'integration action' : 'upload'} was approved and executed successfully. Result: ${resultText}`, 'system');
    }
  } catch (err) {
    console.log(`[Groove] Auto-retry for approval ${approval.id} failed: ${err.message}`);
    if (rp.agentId) {
      daemon.processes.sendMessage(rp.agentId, `Your ${rp.type === 'integration_exec' ? 'integration action' : 'upload'} was approved but execution failed: ${err.message}`, 'system').catch(() => {});
    }
  }
}

const FILE_READ_TOOLS = new Set(['Read', 'read_file']);
const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'write_file', 'edit_file', 'create_file']);

export function createApi(app, daemon) {
  _daemon = daemon;

  // CORS — restrict to localhost + bound interface origins
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    let allowed = false;
    if (!origin) {
      allowed = true;
    } else {
      try {
        const url = new URL(origin);
        // Allow any localhost origin (any port — tunnels change the port)
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') allowed = true;
        // Allow the bound interface (for Tailscale/LAN access)
        if (daemon.host && daemon.host !== '127.0.0.1' && url.hostname === daemon.host) allowed = true;
      } catch { /* invalid origin */ }
    }
    if (allowed) {
      res.header('Access-Control-Allow-Origin', origin || '*');
    }
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Security headers — preview proxy routes get relaxed framing policy so the
  // GUI can iframe the proxied dev server content.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '0');
    const isPreviewProxy = req.path.match(/^\/api\/preview\/[^/]+\/proxy/);
    if (isPreviewProxy) {
      res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors 'self'");
    } else {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-src 'self' http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'");
    }
    next();
  });

  app.use(express.json({ limit: '6mb' }));

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // Debug: test fetch to llama-server from daemon runtime
  app.get('/api/lab/debug-fetch', async (req, res) => {
    const target = req.query.url || 'http://localhost:8081/v1/chat/completions';
    const log = [];
    try {
      log.push(`fetch → ${target}`);
      log.push(`node ${process.version}, electron ${process.versions.electron || 'N/A'}`);
      const start = Date.now();
      const r = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'Qwen3-0.6B-Q8_0.gguf', messages: [{ role: 'user', content: 'Say ok' }], stream: true, max_tokens: 10 }),
        signal: AbortSignal.timeout(10000),
      });
      log.push(`status=${r.status} in ${Date.now() - start}ms`);
      const reader = r.body.getReader();
      let chunks = 0;
      while (chunks < 5) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks++;
        log.push(`chunk ${chunks}: ${new TextDecoder().decode(value).slice(0, 120)}`);
      }
      reader.cancel();
      log.push(`total chunks read: ${chunks}`);
      res.json({ ok: true, log });
    } catch (err) {
      log.push(`ERROR: ${err.message}`);
      res.json({ ok: false, log, error: err.message });
    }
  });


  // --- Route sub-modules ---
  registerAgentRoutes(app, daemon);
  registerCoordinationRoutes(app, daemon);
  registerProviderRoutes(app, daemon);
  registerTeamRoutes(app, daemon);
  registerIntegrationRoutes(app, daemon);
  registerFileRoutes(app, daemon);
  registerNetworkRoutes(app, daemon);
  registerScheduleRoutes(app, daemon);


  // Token usage
  app.get('/api/tokens', (req, res) => {
    res.json(daemon.tokens.getAll());
  });


  // --- Model Routing ---

  app.get('/api/routing', (req, res) => {
    res.json(daemon.router.getStatus());
  });

  // Edition
  app.get('/api/edition', (req, res) => {
    const sub = daemon.subscriptionCache || {};
    res.json({
      edition: sub.active ? 'pro' : 'community',
      plan: sub.plan || 'community',
      subscriptionActive: sub.active || false,
      features: sub.features || [],
      seats: sub.seats || 1,
      periodEnd: sub.periodEnd || null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd || false,
      status: sub.status || 'none',
    });
  });

  // Daemon status
  app.get('/api/status', (req, res) => {
    const sub = daemon.subscriptionCache || {};
    res.json({
      version: pkgVersion,
      pid: process.pid,
      uptime: process.uptime(),
      agents: daemon.registry.getAll().length,
      running: daemon.processes.getRunningCount(),
      host: daemon.host,
      port: daemon.port,
      projectDir: daemon.projectDir,
      edition: sub.active ? 'pro' : 'community',
      homedir: homedir(),
    });
  });

  // --- Project Directory ---

  app.get('/api/project-dir', (req, res) => {
    res.json({
      projectDir: daemon.projectDir,
      recentProjects: daemon.config.recentProjects || [],
    });
  });

  app.post('/api/project-dir', (req, res) => {
    const { path: dirPath } = req.body || {};
    if (!dirPath || typeof dirPath !== 'string') {
      return res.status(400).json({ error: 'path is required' });
    }
    try {
      daemon.setProjectDir(dirPath);
      resetEditorRoot();
      res.json({ projectDir: daemon.projectDir, recentProjects: daemon.config.recentProjects || [] });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Conversations ---

  // --- Approvals ---

  app.get('/api/approvals', (req, res) => {
    res.json({
      pending: daemon.supervisor.getPending(),
      resolved: daemon.supervisor.getResolved().slice(-20),
      status: daemon.supervisor.getStatus(),
    });
  });

  app.post('/api/approvals/:id/approve', async (req, res) => {
    const result = daemon.supervisor.approve(req.params.id);
    if (!result) return res.status(404).json({ error: 'Approval not found' });
    daemon.audit.log('approval.approve', { id: req.params.id });
    if (result.retryPayload) {
      _executeApprovalRetry(daemon, result).catch((err) => {
        console.log(`[Groove] Approval auto-retry failed: ${err.message}`);
      });
    }
    res.json(result);
  });

  app.post('/api/approvals/:id/reject', (req, res) => {
    const result = daemon.supervisor.reject(req.params.id, req.body.reason);
    if (!result) return res.status(404).json({ error: 'Approval not found' });
    daemon.audit.log('approval.reject', { id: req.params.id, reason: req.body.reason });
    res.json(result);
  });

  // --- Token Summary ---

  app.get('/api/tokens/summary', (req, res) => {
    res.json(daemon.tokens.getSummary());
  });

  // Per-team token burn ranked by total. Answers "which team burned the most?"
  app.get('/api/tokens/by-team', (req, res) => {
    const agents = daemon.registry.getAll();
    const usage = daemon.tokens.getAll();
    const teams = daemon.teams.list();
    const unassignedId = '__unassigned__';

    const perTeam = new Map();
    for (const t of teams) {
      perTeam.set(t.id, {
        teamId: t.id,
        teamName: t.name,
        isDefault: !!t.isDefault,
        agentCount: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        avgTokensPerAgent: 0,
      });
    }
    perTeam.set(unassignedId, {
      teamId: unassignedId,
      teamName: '(unassigned)',
      isDefault: false,
      agentCount: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      avgTokensPerAgent: 0,
    });

    for (const agent of agents) {
      const bucket = perTeam.get(agent.teamId) || perTeam.get(unassignedId);
      const u = usage[agent.id];
      if (!u) continue;
      bucket.agentCount += 1;
      bucket.totalTokens += u.total || 0;
      bucket.totalCostUsd += u.totalCostUsd || 0;
    }

    const result = [...perTeam.values()]
      .map((t) => ({
        ...t,
        avgTokensPerAgent: t.agentCount > 0 ? Math.round(t.totalTokens / t.agentCount) : 0,
      }))
      .filter((t) => t.agentCount > 0 || t.isDefault)
      .sort((a, b) => b.totalTokens - a.totalTokens);

    res.json({ teams: result });
  });

  // Rotation stats
  app.get('/api/rotation', (req, res) => {
    res.json({
      ...daemon.rotator.getStats(),
      history: daemon.rotator.getHistory(),
    });
  });

  // Journalist status & history
  app.get('/api/journalist', (req, res) => {
    res.json({
      ...daemon.journalist.getStatus(),
      history: daemon.journalist.getHistory(),
      lastSynthesis: daemon.journalist.getLastSynthesis(),
    });
  });

  // Plan chat — direct API (fast, sub-second) when API key available, CLI fallback otherwise
  const PLAN_SYSTEM = `You are the planning assistant built into Groove's spawn panel. The user is configuring an AI agent right now — they're looking at a form with role selection, file scope, skills, integrations, effort level, and a task prompt. Your conversation will be synthesized into the agent's task prompt when they click "Generate Prompt."

Your job: help them think through what the agent should do, then craft a clear plan. Be direct and practical. Don't ask how they'll feed input to agents or what tools to use — they're already inside Groove doing it. Focus on the TASK itself.

What you know about the system:
- The user is in the spawn panel, configuring an agent before launching it
- The left panel has: role picker, directory, permissions, effort, integrations, skills, schedule
- When done planning, "Generate Prompt" synthesizes this chat into the agent's task prompt
- Agents are Claude Code instances with full terminal/file access in the specified directory
- Agents can read/write files, run commands, use MCP integrations (Slack, GitHub, etc.)
- The journalist system prevents cold starts during context rotation — agents don't lose context

Keep responses concise. Help them think, don't lecture them about the system they built.`;

  app.post('/api/journalist/query', async (req, res) => {
    try {
      const { prompt } = req.body || {};
      if (!prompt) return res.status(400).json({ error: 'prompt is required' });

      // Fast path: direct Anthropic API call (sub-second)
      const apiKey = daemon.credentials.getKey('anthropic-api');
      if (apiKey) {
        const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            system: PLAN_SYSTEM,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        const data = await apiRes.json();
        if (data.content?.[0]?.text) {
          return res.json({ response: data.content[0].text, mode: 'fast' });
        }
        if (data.error) {
          return res.status(400).json({ error: data.error.message || 'API error' });
        }
      }

      // Slow path: CLI fallback for subscription auth (~10s)
      const fullPrompt = `${PLAN_SYSTEM}\n\n${prompt}`;
      const response = await daemon.journalist.callHeadless(fullPrompt, { trackAs: '__planner__' });
      res.json({ response, mode: 'cli' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Check if Anthropic API key is configured
  app.get('/api/anthropic-key/status', (req, res) => {
    const hasKey = !!daemon.credentials.getKey('anthropic-api');
    res.json({ configured: hasKey });
  });

  // Trigger journalist cycle manually
  app.post('/api/journalist/cycle', async (req, res) => {
    try {
      await daemon.journalist.cycle();
      res.json({ ok: true, cycle: daemon.journalist.cycleCount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Adaptive thresholds
  app.get('/api/adaptive', (req, res) => {
    res.json(daemon.adaptive.getAllProfiles());
  });

  // --- Marketplace Auth ---

  // Browser login callback — Studio redirects here with the JWT
  app.get('/api/auth/callback', async (req, res) => {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send('<html><body><h2>Missing token</h2><p>Login failed. Close this tab and try again.</p></body></html>');
    }

    const user = await daemon.skills.setAuth(token);
    if (user) await daemon.setAuthToken(token);
    if (!user) {
      return res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Groove — Login Failed</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#1a1e25;color:#bcc2cd;font-family:-apple-system,system-ui,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}
  .card{text-align:center;padding:48px;border-radius:8px;border:1px solid #2c313a;background:#20242b;max-width:380px;width:100%}
  .icon{width:48px;height:48px;border-radius:12px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;background:rgba(224,108,117,0.1);border:1px solid rgba(224,108,117,0.2)}
  .icon svg{width:24px;height:24px;color:#e06c75}
  h2{font-size:16px;font-weight:600;color:#e6e6e6;margin-bottom:8px}
  p{font-size:13px;color:#505862;line-height:1.5}
</style>
</head><body>
<div class="card">
  <div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>
  <h2>Login failed</h2>
  <p>Invalid or expired token. Close this tab and try again from the app.</p>
</div>
</body></html>`);
    }

    const rawName = user?.displayName || user?.id || '';
    const displayName = rawName.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Groove — Signed In</title>
<link rel="icon" href="/favicon.png">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#1a1e25;color:#bcc2cd;font-family:-apple-system,system-ui,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;overflow:hidden}
  .card{text-align:center;padding:48px;border-radius:8px;border:1px solid #2c313a;background:#20242b;max-width:380px;width:100%}
  .logo{width:48px;height:48px;border-radius:12px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;background:rgba(51,175,188,0.1);border:1px solid rgba(51,175,188,0.2)}
  .logo svg{width:24px;height:24px;color:#33afbc}
  h2{font-size:16px;font-weight:600;color:#e6e6e6;margin-bottom:6px}
  .user{font-size:13px;color:#33afbc;margin-bottom:16px}
  p{font-size:13px;color:#505862;line-height:1.5}
  .btn{display:inline-block;margin-top:20px;padding:8px 20px;font-size:13px;font-weight:500;color:#e6e6e6;background:#2c313a;border:1px solid #3a3f48;border-radius:999px;cursor:pointer;transition:background 0.15s}
  .btn:hover{background:#33afbc;border-color:#33afbc;color:#1a1e25}
</style>
</head><body>
<div class="card">
  <div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
  <h2>Connected to Groove</h2>
  ${displayName ? `<div class="user">${displayName}</div>` : ''}
  <p id="msg">You can close this tab and return to Groove.</p>
  <button class="btn" onclick="window.close()">Close tab</button>
</div>
<script>setTimeout(()=>{try{window.close()}catch(e){}setTimeout(()=>{document.getElementById('msg').textContent='Return to the Groove app to continue.'},500)},3000)</script>
</body></html>`);
  });

  // Auth status — returns current user + subscription or { authenticated: false }
  app.get('/api/auth/status', async (req, res) => {
    const user = daemon.skills.getUser();
    const token = daemon.skills.getToken();
    if (!user || !token) return res.json({ authenticated: false });
    const sub = daemon.subscriptionCache || {};
    res.json({ authenticated: true, user, subscription: sub });
  });

  // Validate stored token (hits remote API)
  app.post('/api/auth/validate', async (req, res) => {
    const user = await daemon.skills.validateAuth();
    if (!user) return res.json({ authenticated: false });
    res.json({ authenticated: true, user });
  });

  // Get login URL for browser redirect
  app.get('/api/auth/login-url', (req, res) => {
    res.json({ url: daemon.skills.getLoginUrl() });
  });

  // Logout — clear stored token
  app.post('/api/auth/logout', async (req, res) => {
    await daemon.skills.clearAuth();
    res.json({ ok: true });
  });

  // User's purchases
  app.get('/api/auth/purchases', async (req, res) => {
    const purchases = await daemon.skills.getPurchases();
    res.json({ purchases });
  });

  // Check single purchase
  app.get('/api/auth/purchases/check/:skillId', async (req, res) => {
    const purchased = await daemon.skills.checkPurchase(req.params.skillId);
    res.json({ purchased });
  });

  // Start Stripe checkout for paid skill
  app.post('/api/auth/checkout', async (req, res) => {
    try {
      const { skillId } = req.body;
      if (!skillId) return res.status(400).json({ error: 'skillId required' });
      const result = await daemon.skills.checkout(skillId);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Subscription ---

  const SUB_API = 'https://docs.groovedev.ai/api/v1';

  app.get('/api/subscription/plans', async (req, res) => {
    try {
      const resp = await fetch(`${SUB_API}/subscription/plans`);
      const data = await resp.json();
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: 'Failed to fetch plans', message: err.message });
    }
  });

  app.get('/api/subscription/status', (req, res) => {
    const sub = daemon.subscriptionCache || {};
    res.json(sub);
  });

  app.post('/api/subscription/checkout', async (req, res) => {
    if (!daemon.authToken) return res.status(401).json({ error: 'Not authenticated' });
    const { priceId } = req.body;
    if (!priceId || typeof priceId !== 'string') return res.status(400).json({ error: 'priceId required' });
    try {
      const resp = await fetch(`${SUB_API}/subscription/checkout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${daemon.authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId }),
      });
      const data = await resp.json();
      if (!resp.ok) return res.status(resp.status).json(data);
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: 'Checkout failed', message: err.message });
    }
  });

  app.post('/api/subscription/portal', async (req, res) => {
    if (!daemon.authToken) return res.status(401).json({ error: 'Not authenticated' });
    try {
      const resp = await fetch(`${SUB_API}/subscription/portal`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${daemon.authToken}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await resp.json();
      if (!resp.ok) return res.status(resp.status).json(data);
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: 'Portal failed', message: err.message });
    }
  });

  app.patch('/api/subscription', async (req, res) => {
    if (!daemon.authToken) return res.status(401).json({ error: 'Not authenticated' });
    const { seats } = req.body;
    if (!seats || typeof seats !== 'number' || seats < 1 || seats > 999 || !Number.isInteger(seats)) {
      return res.status(400).json({ error: 'seats must be integer 1-999' });
    }
    try {
      const resp = await fetch(`${SUB_API}/subscription`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${daemon.authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ seats }),
      });
      const data = await resp.json();
      if (!resp.ok) return res.status(resp.status).json(data);
      daemon._pollSubscription();
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: 'Seat update failed', message: err.message });
    }
  });


  // Preview service — one-click View Site for completed teams
  app.get('/api/preview', (req, res) => {
    res.json({ previews: daemon.preview?.list() || [] });
  });

  app.get('/api/preview/:teamId', (req, res) => {
    const entry = daemon.preview?.get(req.params.teamId);
    if (!entry) return res.status(404).json({ error: 'No preview for this team' });
    res.json(entry);
  });

  app.delete('/api/preview/:teamId', async (req, res) => {
    const killed = await daemon.preview?.kill(req.params.teamId);
    res.json({ stopped: !!killed });
  });

  // Manually (re)launch the preview for a team using the stashed plan.
  app.post('/api/preview/:teamId/launch', async (req, res) => {
    const plan = daemon.preview?.getPlan(req.params.teamId);
    if (!plan) return res.status(404).json({ error: 'No preview plan stashed for this team' });
    const result = await daemon.preview.launch(req.params.teamId, plan.workingDir, plan.preview);
    res.json(result);
  });

  // --- Preview Proxy (same-origin iframe support) ---
  // Forwards HTTP requests to the dev server so the GUI can iframe the preview
  // without cross-origin issues. WebSocket upgrade for HMR is handled in index.js.

  function rewriteAbsoluteUrls(body, proxyBase) {
    let out = body;
    // HTML attributes: src, href, action, poster
    out = out.replace(/((?:src|href|action|poster)\s*=\s*(["']))\/(?!\/|api\/preview\/)/g, `$1${proxyBase}/`);
    // JS imports: from '/' and import('/')
    out = out.replace(/(from\s+(["']))\/(?!\/|api\/preview\/)/g, `$1${proxyBase}/`);
    out = out.replace(/(import\s*\(\s*(["']))\/(?!\/|api\/preview\/)/g, `$1${proxyBase}/`);
    // JS bare import: import '/path'
    out = out.replace(/(import\s+(["']))\/(?!\/|api\/preview\/)/g, `$1${proxyBase}/`);
    // CSS url()
    out = out.replace(/(url\s*\(\s*(["']?))\/(?!\/|api\/preview\/)/g, `$1${proxyBase}/`);
    // CSS @import '/path'
    out = out.replace(/(@import\s+(["']))\/(?!\/|api\/preview\/)/g, `$1${proxyBase}/`);
    // Vite base assignments: globalThis.__vite_base = "/" or window.__vite_base = "/"
    out = out.replace(/((?:globalThis|window)\.__vite_base\s*=\s*(["']))\/(?=["'])/g, `$1${proxyBase}/`);
    return out;
  }

  const REWRITABLE_TYPES = ['text/html', 'application/javascript', 'text/javascript', 'text/css'];

  function handleProxyResponse(proxyRes, res, proxyBase) {
    const fwdHeaders = { ...proxyRes.headers };
    delete fwdHeaders['content-security-policy'];
    delete fwdHeaders['x-frame-options'];

    const ct = (fwdHeaders['content-type'] || '').toLowerCase();
    const shouldRewrite = REWRITABLE_TYPES.some((t) => ct.includes(t));

    if (!shouldRewrite) {
      res.writeHead(proxyRes.statusCode, fwdHeaders);
      proxyRes.pipe(res);
      return;
    }

    const chunks = [];
    proxyRes.on('data', (c) => chunks.push(c));
    proxyRes.on('end', () => {
      let body = Buffer.concat(chunks).toString('utf8');
      body = rewriteAbsoluteUrls(body, proxyBase);
      const buf = Buffer.from(body, 'utf8');
      fwdHeaders['content-length'] = buf.length;
      delete fwdHeaders['transfer-encoding'];
      res.writeHead(proxyRes.statusCode, fwdHeaders);
      res.end(buf);
    });
  }

  app.all('/api/preview/:teamId/proxy/*', (req, res) => {
    const entry = daemon.preview?.get(req.params.teamId);
    if (!entry || !entry.url) return res.status(404).json({ error: 'No active preview for this team' });

    let targetUrl;
    try { targetUrl = new URL(entry.devUrl || entry.url); } catch { return res.status(500).json({ error: 'Invalid preview URL' }); }

    const proxyPath = req.params[0] || '';
    const search = req.url.includes('?') ? '?' + req.url.split('?').slice(1).join('?') : '';
    const fullPath = '/' + proxyPath + search;
    const proxyBase = `/api/preview/${req.params.teamId}/proxy`;

    const headers = { ...req.headers };
    delete headers.host;
    delete headers['accept-encoding'];
    headers.host = targetUrl.host;

    const proxyReq = httpRequest({
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: fullPath,
      method: req.method,
      headers,
    }, (proxyRes) => handleProxyResponse(proxyRes, res, proxyBase));

    proxyReq.on('error', (err) => {
      if (!res.headersSent) res.status(502).json({ error: `Proxy error: ${err.message}` });
    });
    req.pipe(proxyReq);
  });

  // Also handle the bare path (no trailing wildcard)
  app.all('/api/preview/:teamId/proxy', (req, res) => {
    const entry = daemon.preview?.get(req.params.teamId);
    if (!entry || !entry.url) return res.status(404).json({ error: 'No active preview for this team' });

    let targetUrl;
    try { targetUrl = new URL(entry.devUrl || entry.url); } catch { return res.status(500).json({ error: 'Invalid preview URL' }); }

    const search = req.url.includes('?') ? '?' + req.url.split('?').slice(1).join('?') : '';
    const proxyBase = `/api/preview/${req.params.teamId}/proxy`;

    const headers = { ...req.headers };
    delete headers.host;
    delete headers['accept-encoding'];
    headers.host = targetUrl.host;

    const proxyReq = httpRequest({
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: '/' + search,
      method: req.method,
      headers,
    }, (proxyRes) => handleProxyResponse(proxyRes, res, proxyBase));

    proxyReq.on('error', (err) => {
      if (!res.headersSent) res.status(502).json({ error: `Proxy error: ${err.message}` });
    });
    req.pipe(proxyReq);
  });

  // --- Iteration endpoint (planner routing for live preview feedback) ---
  app.post('/api/preview/:teamId/iterate', async (req, res) => {
    try {
      const { message, screenshot } = req.body;
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'message is required and must be a non-empty string' });
      }

      const teamId = req.params.teamId;
      const agents = daemon.registry.getAll().filter((a) => a.teamId === teamId);
      const planner = agents.find((a) => a.role === 'planner');

      if (!planner) {
        return res.status(400).json({ error: 'No planner found for this team. Iteration routing requires a planner-based team.' });
      }

      const terminal = new Set(['completed', 'crashed', 'stopped', 'killed']);
      const feedbackPrompt = [
        'ITERATION REQUEST: The user is viewing the live preview and wants changes.',
        '',
        `User feedback: ${message.trim()}`,
        '',
        screenshot ? 'The user attached a screenshot highlighting what they want changed.' : '',
        '',
        'Analyze this feedback and route it to the appropriate team agent (frontend, backend, or fullstack) by writing .groove/recommended-team.json. Be specific about what files to change and what the change should be.',
      ].filter(Boolean).join('\n');

      if (terminal.has(planner.status)) {
        const newAgent = await daemon.processes.spawn({
          role: planner.role,
          scope: planner.scope,
          provider: planner.provider,
          model: planner.model,
          prompt: feedbackPrompt,
          permission: planner.permission || 'full',
          workingDir: planner.workingDir,
          name: planner.name,
          teamId: planner.teamId,
        });
        daemon.audit.log('preview.iterate', { teamId, plannerId: newAgent.id, respawned: true });
        return res.json({ status: 'routed', plannerAgent: newAgent.id, message: 'Feedback sent to respawned planner for routing' });
      }

      if (daemon.processes.hasAgentLoop(planner.id)) {
        await daemon.processes.sendMessage(planner.id, feedbackPrompt);
      } else if (daemon.processes.isRunning(planner.id)) {
        daemon.processes.queueMessage(planner.id, feedbackPrompt);
      } else {
        return res.status(400).json({ error: 'Planner exists but is not reachable. Try again.' });
      }

      daemon.audit.log('preview.iterate', { teamId, plannerId: planner.id, respawned: false });
      res.json({ status: 'routed', plannerAgent: planner.id, message: 'Feedback sent to planner for routing' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Screenshot storage for preview iteration ---
  app.post('/api/preview/:teamId/screenshot', (req, res) => {
    try {
      const { image, filename } = req.body;
      if (!image || typeof image !== 'string') {
        return res.status(400).json({ error: 'image (base64 string) is required' });
      }

      const teamId = req.params.teamId;
      const agents = daemon.registry.getAll().filter((a) => a.teamId === teamId);
      const teamAgent = agents[0];
      if (!teamAgent) return res.status(404).json({ error: 'No agents found for this team' });

      const workDir = teamAgent.workingDir || daemon.projectDir;
      const screenshotDir = resolve(workDir, '.groove', 'screenshots');
      mkdirSync(screenshotDir, { recursive: true });

      const ts = Date.now();
      const safeName = (filename || 'screenshot').replace(/[^a-zA-Z0-9._-]/g, '_');
      const fname = `${ts}-${safeName}.png`;
      const filePath = resolve(screenshotDir, fname);

      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

      const relativePath = `.groove/screenshots/${fname}`;
      daemon.audit.log('preview.screenshot', { teamId, path: relativePath });
      res.json({
        path: relativePath,
        url: `/api/preview/${teamId}/screenshots/${fname}`,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/preview/:teamId/screenshots/:filename', (req, res) => {
    const teamId = req.params.teamId;
    const fname = req.params.filename;
    if (!fname || fname.includes('..') || fname.includes('/') || fname.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const agents = daemon.registry.getAll().filter((a) => a.teamId === teamId);
    const teamAgent = agents[0];
    if (!teamAgent) return res.status(404).json({ error: 'No agents found for this team' });

    const workDir = teamAgent.workingDir || daemon.projectDir;
    const filePath = resolve(workDir, '.groove', 'screenshots', fname);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'Screenshot not found' });

    res.setHeader('Content-Type', 'image/png');
    createReadStream(filePath).pipe(res);
  });

  // Clean up stale artifacts. Scope to a single team when teamId is provided —
  // wiping every agent's working dir on a global cleanup would delete other
  // in-flight teams' unlaunched plans. When called with no teamId, only the
  // daemon-root plan file is touched (safe baseline).
  app.post('/api/cleanup', (req, res) => {
    const teamId = req.body?.teamId || req.query?.teamId || null;
    let cleaned = 0;
    const locations = [resolve(daemon.grooveDir, 'recommended-team.json')];

    if (teamId) {
      // Only agents in this team get their workspace scanned
      for (const agent of daemon.registry.getAll()) {
        if (agent.teamId === teamId && agent.workingDir) {
          locations.push(resolve(agent.workingDir, '.groove', 'recommended-team.json'));
        }
      }
    }

    for (const p of locations) {
      if (existsSync(p)) { try { unlinkSync(p); cleaned++; } catch { /* */ } }
    }
    daemon.audit.log('cleanup', { cleaned, teamId });
    res.json({ ok: true, cleaned });
  });

  // --- Command Center Dashboard ---

  app.get('/api/dashboard', (req, res) => {
    const agents = daemon.registry.getAll();
    const tokenSummary = daemon.tokens.getSummary();

    // Token tracker might not have been fed — use registry as source of truth
    const registryTokens = agents.reduce((sum, a) => sum + (a.tokensUsed || 0), 0);
    if (registryTokens > tokenSummary.totalTokens) {
      tokenSummary.totalTokens = registryTokens;
      // Recalculate savings estimates
      const estimated = registryTokens + tokenSummary.savings.total;
      tokenSummary.savings.estimatedWithoutGroove = estimated;
      const rawPct = estimated > 0 ? (tokenSummary.savings.total / estimated) * 100 : 0;
      tokenSummary.savings.percentage = rawPct > 0 && rawPct < 1
        ? Math.round(rawPct * 10) / 10 : Math.round(rawPct);
    }
    const rotationStats = daemon.rotator.getStats();
    const rotationHistory = daemon.rotator.getHistory();
    const routingStatus = daemon.router.getStatus();
    const journalistStatus = daemon.journalist.getStatus();

    // Aggregate routing cost log by tier (count + tokens, no fake cost estimates)
    const routingByTier = { light: 0, medium: 0, heavy: 0 };
    const tokensByTier = { light: 0, medium: 0, heavy: 0 };
    let autoRoutedCount = 0;
    for (const [, mode] of Object.entries(routingStatus.agentModes || {})) {
      if (mode.mode === 'auto') autoRoutedCount++;
    }
    for (const entry of daemon.router.costLog || []) {
      if (routingByTier[entry.tier] !== undefined) routingByTier[entry.tier]++;
      if (entry.tokens && entry.tier && tokensByTier[entry.tier] !== undefined) {
        tokensByTier[entry.tier] += entry.tokens;
      }
    }

    // Per-agent enriched data with quality signals
    const agentBreakdown = agents.map((a) => {
      const tokenData = daemon.tokens.getAgent(a.id);
      // Cache rate denominator: reads + creation (cacheable), excludes fresh inputTokens
      const agentCacheable = (tokenData.cacheReadTokens || 0) + (tokenData.cacheCreationTokens || 0);

      let quality = null;
      try {
        const events = daemon.classifier.agentWindows[a.id] || [];
        const signals = events.length >= 6 ? daemon.adaptive.extractSignals(events, a.scope) : null;
        const score = signals ? daemon.adaptive.scoreSession(signals) : null;
        const classification = daemon.classifier.classify(a.id);
        const history = daemon.rotator.scoreHistory[a.id] || [];
        quality = {
          score,
          scoreHistory: history,
          errorCount: signals?.errorCount || 0,
          toolCalls: signals?.toolCalls || 0,
          toolFailures: signals?.toolFailures || 0,
          toolSuccessRate: signals?.toolCalls > 0 ? 1 - (signals.toolFailures / signals.toolCalls) : 1,
          filesWritten: signals?.filesWritten || 0,
          fileChurn: signals?.fileChurn || 0,
          repetitions: signals?.repetitions || 0,
          errorTrend: signals?.errorTrend || 0,
          tier: classification?.tier || classification || 'medium',
          eventCount: events.length,
        };
      } catch { /* classifier/adaptive may not have data yet */ }

      return {
        id: a.id,
        name: a.name,
        role: a.role,
        status: a.status,
        provider: a.provider,
        model: a.model || 'default',
        routingMode: a.routingMode || 'fixed',
        routingReason: a.routingReason || null,
        tokens: a.tokensUsed || 0,
        costUsd: a.costUsd || tokenData.totalCostUsd || 0,
        costSource: a.provider === 'claude-code' ? 'actual' : a.provider === 'ollama' ? 'local' : 'estimated',
        inputTokens: tokenData.inputTokens || 0,
        outputTokens: tokenData.outputTokens || 0,
        cacheHitRate: agentCacheable > 0 ? Math.round(((tokenData.cacheReadTokens || 0) / agentCacheable) * 1000) / 1000 : 0,
        contextUsage: a.contextUsage || 0,
        rotationThreshold: daemon.adaptive.getThreshold(a.provider, a.role),
        durationMs: a.durationMs || tokenData.totalDurationMs || 0,
        turns: a.turns || tokenData.totalTurns || 0,
        modelDistribution: tokenData.modelDistribution || {},
        teamId: a.teamId || null,
        spawnedAt: a.spawnedAt,
        lastActivity: a.lastActivity || null,
        quality,
      };
    });

    // Adaptive profiles summary — include history for threshold drift charts
    const profiles = daemon.adaptive.getAllProfiles();
    const profileSummary = Object.entries(profiles).map(([key, p]) => ({
      key,
      threshold: p.threshold,
      converged: p.converged,
      adjustments: p.adjustmentCount,
      recentScores: (p.history || []).slice(-20).map((h) => h.score),
      thresholdHistory: (p.history || []).slice(-20).map((h) => ({ t: h.timestamp, v: h.newThreshold })),
      lastSignals: p.history?.length > 0 ? p.history[p.history.length - 1].signals : null,
    }));

    // Journalist — include synthesis summary and recent history
    const lastSynthesis = daemon.journalist.getLastSynthesis();
    const journalistHistory = daemon.journalist.getHistory().slice(-10);

    // Timeline data
    const timelineData = daemon.timeline ? {
      snapshots: daemon.timeline.getSnapshots(200),
      events: daemon.timeline.getEvents(100),
    } : { snapshots: [], events: [] };

    res.json({
      tokens: tokenSummary,
      agents: {
        total: agents.length,
        running: agents.filter((a) => a.status === 'running').length,
        completed: agents.filter((a) => a.status === 'completed').length,
        crashed: agents.filter((a) => a.status === 'crashed').length,
        breakdown: agentBreakdown,
      },
      routing: {
        autoRoutedCount,
        byTier: routingByTier,
        tokensByTier,
        totalDecisions: daemon.router.costLog?.length || 0,
      },
      rotation: {
        ...rotationStats,
        history: rotationHistory.slice(-20),
      },
      adaptive: profileSummary,
      journalist: {
        ...journalistStatus,
        lastSummary: lastSynthesis?.summary || '',
        projectMap: lastSynthesis?.projectMap || '',
        decisions: lastSynthesis?.decisions || '',
        recentHistory: journalistHistory,
      },
      timeline: timelineData,
      activeTeam: daemon.teams?.getActiveTeam?.() || null,
      uptime: process.uptime(),
    });
  });

  app.get('/api/audit', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    res.json(daemon.audit.recent(limit));
  });

  // --- Repo Import ---

  app.post('/api/repos/preview', async (req, res) => {
    try {
      const { repoUrl } = req.body;
      if (!repoUrl || typeof repoUrl !== 'string') {
        return res.status(400).json({ error: 'repoUrl is required (string)' });
      }
      const result = await daemon.repoImporter.preview(repoUrl);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/repos/import', async (req, res) => {
    try {
      const { repoUrl, targetPath, createTeam, teamName } = req.body;
      if (!repoUrl || typeof repoUrl !== 'string') {
        return res.status(400).json({ error: 'repoUrl is required (string)' });
      }
      if (!targetPath || typeof targetPath !== 'string') {
        return res.status(400).json({ error: 'targetPath is required (string)' });
      }

      // Resolve shell shortcuts — GUI sends ~/... and ./...
      let resolvedPath = targetPath;
      if (resolvedPath.startsWith('~/') || resolvedPath === '~') {
        resolvedPath = resolve(homedir(), resolvedPath.slice(2));
      } else if (!resolvedPath.startsWith('/')) {
        resolvedPath = resolve(daemon.projectDir, resolvedPath);
      }

      const result = await daemon.repoImporter.import(repoUrl, resolvedPath, {});

      let teamId = null;
      if (createTeam) {
        try {
          const team = daemon.teams.create(teamName || result.stackInfo?.name || 'imported-repo');
          teamId = team.id;
          const manifest = daemon.repoImporter.getImport(result.importId);
          if (manifest) {
            manifest.teamId = teamId;
            daemon.repoImporter._saveManifest(manifest);
          }
        } catch { /* team creation is optional */ }
      }

      // Spawn setup agent
      let agentId = null;
      try {
        const setupPrompt = daemon.repoImporter.generateSetupPrompt(resolvedPath, result.stackInfo, '');
        const agent = await daemon.processes.spawn({
          role: 'fullstack',
          name: `setup-${result.importId.slice(0, 4)}`,
          workingDir: resolvedPath,
          prompt: setupPrompt,
          provider: daemon.config?.defaultProvider || 'claude-code',
        });
        agentId = agent.id;
        const manifest = daemon.repoImporter.getImport(result.importId);
        if (manifest) {
          manifest.agents.push(agentId);
          daemon.repoImporter._saveManifest(manifest);
        }
      } catch { /* agent spawn is best-effort */ }

      res.json({ importId: result.importId, path: result.path, agentId, teamId });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/repos/imported', (req, res) => {
    res.json(daemon.repoImporter.getImported());
  });

  app.get('/api/repos/:id', (req, res) => {
    const manifest = daemon.repoImporter.getImport(req.params.id);
    if (!manifest) return res.status(404).json({ error: 'Import not found' });
    res.json(manifest);
  });

  app.get('/api/repos/:id/sandbox', (req, res) => {
    const manifest = daemon.repoImporter.getImport(req.params.id);
    if (!manifest) return res.status(404).json({ error: 'Import not found' });
    res.json(manifest);
  });

  app.post('/api/repos/:id/process', (req, res) => {
    try {
      const { pid, command } = req.body;
      daemon.repoImporter.recordProcess(req.params.id, pid, command);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/repos/:id/remove', async (req, res) => {
    try {
      await daemon.repoImporter.softRemove(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/repos/:id/nuke', async (req, res) => {
    try {
      const deleteFiles = req.query.deleteFiles !== 'false';
      await daemon.repoImporter.hardNuke(req.params.id, { deleteFiles });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Personalities ---

  app.get('/api/personalities', (req, res) => {
    const dir = resolve(daemon.grooveDir, 'personalities');
    mkdirSync(dir, { recursive: true });
    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.md'));
      const personalities = files.map(f => ({
        name: f.replace(/\.md$/, ''),
      }));
      res.json({ personalities });
    } catch {
      res.json({ personalities: [] });
    }
  });

  app.get('/api/personalities/:name', (req, res) => {
    const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!name) return res.status(400).json({ error: 'Invalid name' });
    const file = resolve(daemon.grooveDir, 'personalities', `${name}.md`);
    if (!existsSync(file)) return res.status(404).json({ error: 'Personality not found' });
    res.json({ name, content: readFileSync(file, 'utf8') });
  });

  app.put('/api/personalities/:name', (req, res) => {
    const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!name) return res.status(400).json({ error: 'Invalid name' });
    const content = typeof req.body?.content === 'string' ? req.body.content.slice(0, 10000) : '';
    const dir = resolve(daemon.grooveDir, 'personalities');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${name}.md`), content, { mode: 0o600 });
    daemon.audit.log('personality.update', { name });
    res.json({ name, content });
  });

  app.post('/api/personalities/:name/clone', (req, res) => {
    const source = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
    const target = (req.body?.name || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!source || !target) return res.status(400).json({ error: 'Source and target name required' });
    const dir = resolve(daemon.grooveDir, 'personalities');
    const sourceFile = resolve(dir, `${source}.md`);
    if (!existsSync(sourceFile)) return res.status(404).json({ error: 'Source personality not found' });
    copyFileSync(sourceFile, resolve(dir, `${target}.md`));
    daemon.audit.log('personality.clone', { source, target });
    res.json({ name: target, clonedFrom: source });
  });


  // --- Onboarding (Electron wizard) ---

  const INSTALLABLE_PROVIDERS = {
    'claude-code': '@anthropic-ai/claude-code',
    'codex': '@openai/codex',
    'gemini': '@google/gemini-cli',
  };

  app.get('/api/onboarding/status', (req, res) => {
    const providers = listProviders();
    const enriched = providers.map((p) => {
      const hasKey = daemon.credentials.hasKey(p.id);
      let authStatus = 'not-configured';
      if (p.authType === 'subscription') {
        if (!p.installed) {
          authStatus = 'not-configured';
        } else {
          const provObj = getProvider(p.id);
          const authResult = provObj?.constructor?.isAuthenticated?.();
          authStatus = authResult?.authenticated ? 'authenticated' : 'not-configured';
        }
      } else if (p.authType === 'api-key') {
        authStatus = hasKey ? 'key-set' : 'not-configured';
        if (p.authStatus?.authenticated) authStatus = 'authenticated';
      } else if (p.authType === 'local') {
        authStatus = p.installed ? 'authenticated' : 'not-configured';
      }
      return {
        id: p.id,
        displayName: p.name,
        installed: p.installed,
        authType: p.authType,
        authStatus,
        hasKey,
        models: p.models,
        installCommand: p.installCommand,
        installable: !!INSTALLABLE_PROVIDERS[p.id],
      };
    });

    const dismissed = !!(daemon.config.onboardingDismissed);
    const hasReadyProvider = enriched.some((p) =>
      p.installed && (p.authStatus === 'authenticated' || p.authStatus === 'key-set'),
    );

    res.json({
      complete: dismissed || hasReadyProvider,
      dismissed,
      providers: enriched,
      defaultProvider: daemon.config.defaultProvider || 'claude-code',
      defaultModel: daemon.config.defaultModel || null,
    });
  });

  app.post('/api/onboarding/dismiss', async (req, res) => {
    daemon.config.onboardingDismissed = true;
    const { saveConfig } = await import('./firstrun.js');
    saveConfig(daemon.grooveDir, daemon.config);
    daemon.audit.log('onboarding.dismiss', {});
    daemon.broadcast({ type: 'onboarding:dismissed' });
    res.json({ ok: true });
  });

  app.post('/api/onboarding/install-provider', (req, res) => {
    const { provider } = req.body;
    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({ error: 'provider is required' });
    }
    const pkg = INSTALLABLE_PROVIDERS[provider];
    if (!pkg) {
      return res.status(400).json({ error: `Provider '${provider}' is not installable via npm. Valid: ${Object.keys(INSTALLABLE_PROVIDERS).join(', ')}` });
    }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');

    const write = (obj) => {
      try { res.write(JSON.stringify(obj) + '\n'); } catch { /* client disconnected */ }
    };

    write({ status: 'installing', output: `Installing ${pkg}...`, progress: 0 });

    const proc = spawn('bash', ['-lc', `npm install -g ${pkg}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: undefined },
    });

    let output = '';
    let errOutput = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
      write({ status: 'installing', output: data.toString().trim(), progress: 50 });
    });

    proc.stderr.on('data', (data) => {
      errOutput += data.toString();
      const line = data.toString().trim();
      if (line) write({ status: 'installing', output: line, progress: 50 });
    });

    proc.on('close', (code) => {
      const providerObj = getProvider(provider);
      const installed = providerObj ? providerObj.constructor.isInstalled() : false;

      if (code === 0 && installed) {
        clearInstallCache();
        write({ status: 'complete', output: `${pkg} installed successfully`, progress: 100, installed: true });
        daemon.audit.log('onboarding.installProvider', { provider, pkg, success: true });
        daemon.broadcast({ type: 'onboarding:provider-installed', provider });
        daemon.broadcast({ type: 'provider:status-changed', provider });
      } else {
        const reason = code !== 0
          ? (errOutput || output).slice(-500)
          : 'Install succeeded but provider binary not found in PATH';
        write({ status: 'error', output: reason, progress: 100, installed: false });
        daemon.audit.log('onboarding.installProvider', { provider, pkg, success: false, code });
      }
      res.end();
    });

    proc.on('error', (err) => {
      write({ status: 'error', output: `Failed to start npm: ${err.message}`, progress: 100, installed: false });
      res.end();
    });

    req.on('close', () => {
      try { proc.kill(); } catch { /* already exited */ }
    });
  });

  app.post('/api/onboarding/set-default', async (req, res) => {
    const { provider, model } = req.body;
    const validProviders = ['claude-code', 'codex', 'gemini', 'grok', 'ollama', 'local'];
    if (!provider || !validProviders.includes(provider)) {
      return res.status(400).json({ error: `Invalid provider. Valid: ${validProviders.join(', ')}` });
    }

    daemon.config.defaultProvider = provider;
    daemon.config.defaultChatProvider = provider;
    if (model && typeof model === 'string' && model.length <= 100) {
      daemon.config.defaultModel = model.trim();
      daemon.config.defaultChatModel = model.trim();
    }
    const { saveConfig } = await import('./firstrun.js');
    saveConfig(daemon.grooveDir, daemon.config);
    daemon.audit.log('onboarding.setDefault', { provider, model: model || null });
    daemon.broadcast({ type: 'onboarding:default-changed', provider, model });
    res.json({ ok: true });
  });

  // --- Training Data ---

  app.get('/api/training/status', (req, res) => {
    let userId = null;
    let optedIn = false;
    try {
      userId = ConsentManager.getOrCreateUserId();
      optedIn = ConsentManager.isCaptureEnabled();
    } catch (e) { /* */ }
    res.json({
      optedIn,
      userId: userId ? userId.substring(0, 8) + '...' : null,
      captureActive: !!daemon.trajectoryCapture,
      sessionsCaptured: daemon.state.get('training_sessions_captured') || 0,
      envelopesSent: daemon.state.get('training_envelopes_sent') || 0,
    });
  });

  app.post('/api/training/opt-in', async (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });

    try {
      const userId = ConsentManager.getOrCreateUserId();
      const consent = new ConsentManager();
      if (enabled) {
        consent.recordConsent(userId, true, '1.0');
        await daemon._initTrajectoryCapture();
        daemon.state.set('training_enrolled_at', new Date().toISOString());
      } else {
        consent.revokeConsent(userId);
        if (daemon.trajectoryCapture) {
          try { await daemon.trajectoryCapture.shutdown(); } catch (e) { /* */ }
          daemon.trajectoryCapture = null;
        }
      }
    } catch (e) {
      console.error('[training/opt-in] Failed to update data sharing:', e);
      return res.status(500).json({ error: 'Failed to update data sharing', detail: e.message });
    }

    daemon.broadcast({ type: 'training:status', data: { optedIn: enabled, captureActive: !!daemon.trajectoryCapture } });
    if (daemon.audit) daemon.audit.log('training.consent', { opt_in: enabled });
    res.json({ ok: true, optedIn: enabled });
  });

  app.post('/api/training/opt-in/delete', async (req, res) => {
    try {
      const userId = ConsentManager.getOrCreateUserId();
      const consent = new ConsentManager();
      consent.revokeConsent(userId);
      if (daemon.trajectoryCapture) {
        try { await daemon.trajectoryCapture.shutdown(); } catch (e) { /* */ }
        daemon.trajectoryCapture = null;
      }
      daemon.broadcast({ type: 'training:status', data: { optedIn: false, captureActive: false } });
      if (daemon.audit) daemon.audit.log('training.delete', {});
      res.json({ ok: true, deleted: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to delete data' });
    }
  });

  // --- Config ---

  app.get('/api/config', (req, res) => {
    const cfg = daemon.config || {};
    const sanitized = { ...cfg };
    if (sanitized.networkBeta) {
      sanitized.networkBeta = { ...sanitized.networkBeta };
      delete sanitized.networkBeta.code;
    }
    res.json(sanitized);
  });

  app.patch('/api/config', async (req, res) => {
    const ALLOWED_KEYS = [
      'port', 'journalistInterval', 'rotationThreshold', 'autoRotation',
      'qcThreshold', 'maxAgents', 'defaultProvider', 'defaultWorkingDir',
      'onboardingDismissed', 'defaultModel', 'defaultChatProvider', 'defaultChatModel',
      'dataSharingDismissed',
    ];
    for (const key of Object.keys(req.body)) {
      if (!ALLOWED_KEYS.includes(key)) {
        return res.status(400).json({ error: `Unknown config key: ${key}` });
      }
      daemon.config[key] = req.body[key];
    }
    const { saveConfig } = await import('./firstrun.js');
    saveConfig(daemon.grooveDir, daemon.config);
    daemon.audit.log('config.set', { keys: Object.keys(req.body) });
    res.json(daemon.config);
  });

  // --- Toys ---

  app.get('/api/toys', (req, res) => {
    const category = req.query.category;
    if (category && (typeof category !== 'string' || category.length > 30)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    res.json(daemon.toys.list(category || undefined));
  });

  app.get('/api/toys/:id', (req, res) => {
    const toy = daemon.toys.get(req.params.id);
    if (!toy) return res.status(404).json({ error: 'Toy not found' });
    res.json(toy);
  });

  app.post('/api/toys/:id/launch', async (req, res) => {
    try {
      const { apiKey, starterPrompt } = req.body || {};
      const result = await daemon.toys.launch(req.params.id, { apiKey, starterPrompt });
      daemon.audit.log('toy.launch', { toyId: req.params.id, teamId: result.team.id });
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Model Lab ---

  app.get('/api/lab/runtimes', async (req, res) => {
    try {
      const runtimes = daemon.modelLab.listRuntimes();
      const results = await Promise.all(runtimes.map(async (rt) => {
        const status = await daemon.modelLab.getRuntimeStatus(rt);
        return { ...rt, ...status };
      }));
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/lab/runtimes', async (req, res) => {
    try {
      const config = validateLabRuntimeConfig(req.body);
      const runtime = await daemon.modelLab.addRuntime(config);
      res.status(201).json(runtime);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/lab/runtimes/:id', (req, res) => {
    const removed = daemon.modelLab.removeRuntime(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Runtime not found' });
    res.json({ ok: true });
  });

  app.post('/api/lab/runtimes/:id/start', async (req, res) => {
    try {
      const rt = await daemon.modelLab.startRuntime(req.params.id);
      res.json({ ok: true, name: rt.name });
    } catch (err) {
      const status = err.message === 'Runtime not found' ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  });

  app.post('/api/lab/runtimes/:id/stop', async (req, res) => {
    try {
      const rt = await daemon.modelLab.stopRuntime(req.params.id);
      res.json({ ok: true, name: rt.name });
    } catch (err) {
      const status = err.message === 'Runtime not found' ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  app.post('/api/lab/runtimes/:id/test', async (req, res) => {
    try {
      const result = await daemon.modelLab.testRuntime(req.params.id);
      res.json(result);
    } catch (err) {
      const status = err.message === 'Runtime not found' ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  app.get('/api/lab/runtimes/:id/models', async (req, res) => {
    try {
      const models = await daemon.modelLab.discoverModels(req.params.id);
      res.json(models);
    } catch (err) {
      const status = err.message === 'Runtime not found' ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  app.get('/api/lab/local-models', (req, res) => {
    try {
      res.json(daemon.modelLab.listLocalModels());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/lab/suggest-model', async (req, res) => {
    try {
      const { modelId, targetBackend } = req.query;
      if (!modelId || !targetBackend) return res.status(400).json({ error: 'modelId and targetBackend required' });
      const suggestion = await daemon.modelLab.suggestAlternativeModel(modelId, targetBackend);
      res.json({ suggestion });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/lab/launch-local', async (req, res) => {
    try {
      const { modelId } = req.body;
      if (!modelId || typeof modelId !== 'string') {
        return res.status(400).json({ error: 'modelId is required' });
      }
      const result = await daemon.modelLab.launchLocalModel(modelId);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/lab/inference', async (req, res) => {
    try {
      const params = validateLabInferenceParams(req.body);
      const rt = daemon.modelLab.getRuntime(params.runtimeId);
      if (!rt) throw new Error('Runtime not found');

      const url = new URL(`${rt.endpoint.replace('localhost', '127.0.0.1')}/v1/chat/completions`);
      const reqHeaders = { 'Content-Type': 'application/json' };
      if (rt.apiKey) reqHeaders['Authorization'] = `Bearer ${rt.apiKey}`;

      const body = {
        model: params.model,
        messages: params.messages,
        stream: true,
      };
      const pb = params.parameters || {};
      if (pb.temperature !== undefined) body.temperature = pb.temperature;
      if (pb.top_p !== undefined) body.top_p = pb.top_p;
      if (pb.top_k !== undefined) body.top_k = pb.top_k;
      if (pb.repeat_penalty !== undefined) body.repeat_penalty = pb.repeat_penalty;
      if (pb.max_tokens !== undefined) body.max_tokens = pb.max_tokens;
      if (pb.stop !== undefined) body.stop = pb.stop;
      if (pb.frequency_penalty !== undefined) body.frequency_penalty = pb.frequency_penalty;
      if (pb.presence_penalty !== undefined) body.presence_penalty = pb.presence_penalty;
      if (pb.seed !== undefined) body.seed = pb.seed;
      if (pb.min_p !== undefined) body.min_p = pb.min_p;
      if (pb.response_format) body.response_format = pb.response_format;
      if (pb.enable_thinking !== undefined) body.enable_thinking = pb.enable_thinking;

      const payload = JSON.stringify(body);

      // Use Node http module directly — Electron's fetch has stream issues
      const { request: httpRequest } = await import('http');
      const upstream = await new Promise((resolve, reject) => {
        const r = httpRequest({
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: { ...reqHeaders, 'Content-Length': Buffer.byteLength(payload) },
          timeout: 300000,
        }, resolve);
        r.on('error', reject);
        r.on('timeout', () => { r.destroy(); reject(new Error('Upstream timeout')); });
        r.write(payload);
        r.end();
      });

      if (upstream.statusCode !== 200) {
        let errMsg = `HTTP ${upstream.statusCode}`;
        try {
          const chunks = [];
          for await (const c of upstream) chunks.push(c);
          const data = JSON.parse(Buffer.concat(chunks).toString());
          errMsg = data.error?.message || errMsg;
        } catch { /* ignore */ }
        throw new Error(errMsg);
      }

      // Pipe raw OpenAI-compatible SSE straight to client
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      upstream.pipe(res);

      // Collect content for session persistence
      if (params.sessionId) {
        let full = '';
        upstream.on('data', (chunk) => {
          const text = chunk.toString('utf8');
          for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const d = trimmed.slice(6);
            if (d === '[DONE]') continue;
            try {
              const p = JSON.parse(d);
              const delta = p.choices?.[0]?.delta;
              const c = delta?.content || delta?.reasoning_content || delta?.reasoning;
              if (c) full += c;
            } catch { /* skip */ }
          }
        });
        upstream.on('end', () => {
          if (full) daemon.modelLab._appendToSession(params.sessionId, params.messages, { role: 'assistant', content: full });
        });
      }

      req.on('close', () => { upstream.destroy(); });
    } catch (err) {
      if (!res.headersSent) {
        res.status(400).json({ error: err.message });
      } else {
        try { res.end(); } catch { /* ignore */ }
      }
    }
  });

  app.get('/api/lab/presets', (req, res) => {
    res.json(daemon.modelLab.listPresets());
  });

  app.post('/api/lab/presets', (req, res) => {
    try {
      const config = validateLabPresetConfig(req.body);
      const preset = daemon.modelLab.createPreset(config);
      res.status(201).json(preset);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch('/api/lab/presets/:id', (req, res) => {
    try {
      const updates = validateLabPresetConfig({ ...req.body, name: req.body.name || 'temp' });
      const preset = daemon.modelLab.updatePreset(req.params.id, updates);
      if (!preset) return res.status(404).json({ error: 'Preset not found' });
      res.json(preset);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/lab/presets/:id', (req, res) => {
    const removed = daemon.modelLab.deletePreset(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Preset not found' });
    res.json({ ok: true });
  });

  app.get('/api/lab/sessions', (req, res) => {
    res.json(daemon.modelLab.listSessions());
  });

  app.get('/api/lab/sessions/:id', (req, res) => {
    const session = daemon.modelLab.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  });

  app.post('/api/lab/assistant', async (req, res) => {
    try {
      const { backend, model } = req.body || {};
      const validBackends = ['vllm', 'tgi', 'mlx', 'llama-cpp', 'lab-general'];
      if (!backend || !validBackends.includes(backend)) {
        return res.status(400).json({ error: `backend must be one of: ${validBackends.join(', ')}` });
      }
      const templatePath = resolve(__dirname, `../templates/${backend}-setup.json`);
      const template = JSON.parse(readFileSync(templatePath, 'utf8'));
      const agentConfig = template.agents[0];
      let prompt = agentConfig.prompt;
      if (model) {
        const parts = [model.filename, model.parameters, model.quantization].filter(Boolean);
        const desc = parts.join(', ');
        prompt = `The user has selected a local model: ${desc} (id: ${model.id}).\nUse this model for setup instead of recommending a different one. If this exact model isn't available in the runtime's format, find the closest equivalent (same base model, similar quantization).\n\n${prompt}`;
      }
      // Pick best available CLI provider: prefer user's default, fall back through tool-use capable providers
      const cliProviders = ['claude-code', 'codex', 'gemini'];
      const defaultProv = daemon.config.defaultProvider;
      let assistantProvider = cliProviders.includes(defaultProv) && isProviderInstalled(defaultProv)
        ? defaultProv
        : cliProviders.find((p) => isProviderInstalled(p)) || 'claude-code';
      const config = {
        role: 'lab-assistant',
        scope: agentConfig.scope || [],
        provider: assistantProvider,
        prompt,
        metadata: { labAssistant: true, backend },
      };
      const agent = await daemon.processes.spawn(config);
      daemon.audit.log('lab.assistant.spawn', { id: agent.id, backend });
      res.status(201).json({ agentId: agent.id, backend });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });


  // Serve GUI static files (built GUI) — no-cache headers prevent stale bundles on SSH reconnect
  const guiPath = process.env.GROOVE_GUI_PATH || resolve(__dirname, '../../gui/dist');
  app.use(express.static(guiPath, {
    etag: false,
    maxAge: 0,
    lastModified: false,
    setHeaders: (res) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.set('Pragma', 'no-cache');
    },
  }));

  // SPA fallback
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.sendFile(resolve(guiPath, 'index.html'), (err) => {
      if (err) res.status(404).json({ error: 'GUI not built yet. Run: npm run build:gui' });
    });
  });
}
