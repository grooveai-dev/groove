// FSL-1.1-Apache-2.0 — see LICENSE
import { resolve, join, dirname, sep } from 'path';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, rmSync, realpathSync } from 'fs';
import { spawn, execFile, execFileSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { hostname, homedir } from 'os';
import { StringDecoder } from 'string_decoder';
import { OllamaProvider } from '../providers/ollama.js';
import { supportsSignalFlag, compareSemver, parseSemver } from '../providers/groove-network.js';

export function registerNetworkRoutes(app, daemon) {

  // --- Federation ---

  // Federation status (v1 — includes whitelist, connections, ambassadors)
  app.get('/api/federation', (req, res) => {
    res.json(daemon.federation.getStatus());
  });

  app.get('/api/federation/test', async (req, res) => {
    const target = req.query.target;
    if (!target) return res.status(400).json({ error: 'target required' });
    let host;
    try {
      const parsed = new URL(`http://${target}`);
      host = parsed.hostname.replace(/^\[|]$/g, '');
    } catch {
      return res.status(400).json({ error: 'Invalid target' });
    }
    const privatePatterns = [
      /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
      /^0\./, /^169\.254\./, /^localhost$/i, /^::1$/,
      /^0\.0\.0\.0$/, /^fc/i, /^fd/i, /^fe80/i,
    ];
    if (privatePatterns.some(p => p.test(host))) {
      return res.status(400).json({ error: 'Private/local addresses are not allowed' });
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`http://${target}/api/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (resp.ok) {
        const data = await resp.json();
        return res.json({ reachable: true, version: data.version, peerId: data.daemonId, agents: data.agents });
      }
      res.json({ reachable: false });
    } catch {
      res.json({ reachable: false });
    }
  });

  // List peers
  app.get('/api/federation/peers', (req, res) => {
    res.json(daemon.federation.getPeers());
  });

  // Unpair a peer
  app.delete('/api/federation/peers/:id', (req, res) => {
    try {
      daemon.federation.unpair(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Initiate pairing with a remote daemon
  app.post('/api/federation/initiate', async (req, res) => {
    try {
      const { remoteUrl } = req.body;
      if (!remoteUrl || typeof remoteUrl !== 'string') {
        return res.status(400).json({ error: 'remoteUrl is required (string)' });
      }
      const result = await daemon.federation.initiatePairing(remoteUrl);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Federation v1: Whitelist ---

  app.get('/api/federation/whitelist', (req, res) => {
    res.json(daemon.federation.whitelist?.list() || []);
  });

  app.post('/api/federation/whitelist', (req, res) => {
    try {
      const { ip, port, name } = req.body;
      if (!ip || typeof ip !== 'string') {
        return res.status(400).json({ error: 'ip is required (string)' });
      }
      const entry = daemon.federation.whitelist.add(ip, port, name);
      daemon.broadcast({ type: 'federation:whitelist', data: daemon.federation.whitelist.list() });
      res.json(entry);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/federation/whitelist/:ip', (req, res) => {
    try {
      daemon.federation.whitelist.remove(req.params.ip);
      daemon.broadcast({ type: 'federation:whitelist', data: daemon.federation.whitelist.list() });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Probe endpoint — remote daemons hit this to check if they are whitelisted
  app.get('/api/federation/whitelist-check', (req, res) => {
    const ip = req.ip?.replace('::ffff:', '') || req.socket?.remoteAddress?.replace('::ffff:', '') || '';
    const whitelisted = daemon.federation.isWhitelisted(ip);
    res.json({
      whitelisted,
      ...(whitelisted ? { daemonId: daemon.federation._daemonId() } : {}),
    });
  });

  // --- Federation v1: Knock ---

  app.post('/api/federation/knock', (req, res) => {
    try {
      const callerIp = req.ip?.replace('::ffff:', '') || req.socket?.remoteAddress?.replace('::ffff:', '') || '';
      const { senderId, publicKey, payload, signature } = req.body;
      if (!senderId || !publicKey || !payload || !signature) {
        return res.status(400).json({ error: 'senderId, publicKey, payload, and signature are required' });
      }
      const result = daemon.federation.handleKnock(senderId, publicKey, payload, signature, callerIp);
      res.json(result);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  });

  // --- Federation v1: Connections ---

  app.get('/api/federation/connections', (req, res) => {
    res.json(daemon.federation.connections?.getStatus() || []);
  });

  // --- Federation v1: Diplomatic Pouch ---

  app.post('/api/federation/pouch', (req, res) => {
    try {
      const callerIp = req.ip?.replace('::ffff:', '') || req.socket?.remoteAddress?.replace('::ffff:', '') || '';
      if (!callerIp || !daemon.federation.isWhitelisted(callerIp)) {
        return res.status(403).json({ error: 'Caller IP not whitelisted' });
      }
      const { senderId, payload, signature } = req.body;
      if (!senderId || !payload || !signature) {
        return res.status(400).json({ error: 'senderId, payload, and signature are required' });
      }
      const result = daemon.federation.ambassadors.receivePouch(senderId, payload, signature);
      res.json(result);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  });

  app.get('/api/federation/pouch/log', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    res.json(daemon.federation.ambassadors?.getPouchLog(limit) || []);
  });

  // Send a pouch message to a peer (local agents/GUI call this)
  app.post('/api/federation/pouch/send', async (req, res) => {
    try {
      const { peerId, contract } = req.body;
      if (!peerId || !contract) {
        return res.status(400).json({ error: 'peerId and contract are required' });
      }
      const result = await daemon.federation.ambassadors.sendPouch(peerId, contract);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Accept incoming pairing request from a remote daemon
  app.post('/api/federation/pair', (req, res) => {
    try {
      const callerIp = req.ip?.replace('::ffff:', '') || req.socket?.remoteAddress?.replace('::ffff:', '') || '';
      const { id, name, port, publicKey } = req.body;
      if (!id || !publicKey) {
        return res.status(400).json({ error: 'id and publicKey are required' });
      }
      const result = daemon.federation.acceptPairing({ id, name, port, publicKey }, callerIp);
      res.json(result);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  });

  // Legacy contract endpoints (kept for backward compat)
  app.post('/api/federation/contract', (req, res) => {
    try {
      const callerIp = req.ip?.replace('::ffff:', '') || req.socket?.remoteAddress?.replace('::ffff:', '') || '';
      if (!callerIp || !daemon.federation.isWhitelisted(callerIp)) {
        return res.status(403).json({ error: 'Caller IP not whitelisted' });
      }
      const { senderId, payload, signature } = req.body;
      if (!senderId || !payload || !signature) {
        return res.status(400).json({ error: 'senderId, payload, and signature are required' });
      }
      const result = daemon.federation.receiveContract(senderId, payload, signature);
      res.json(result);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  });

  app.post('/api/federation/contract/send', async (req, res) => {
    try {
      const { peerId, contract } = req.body;
      if (!peerId || !contract) {
        return res.status(400).json({ error: 'peerId and contract are required' });
      }
      const result = await daemon.federation.sendContract(peerId, contract);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Tunnels (Remote Access) ---

  app.get('/api/tunnels', (req, res) => {
    res.json(daemon.tunnelManager.getSaved());
  });

  app.post('/api/tunnels', (req, res) => {
    try {
      const { name, host, user, port, sshKeyPath, autoStart, autoConnect, projectDir } = req.body;
      if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required (string)' });
      if (!host || typeof host !== 'string') return res.status(400).json({ error: 'host is required (string)' });
      const result = daemon.tunnelManager.save({ name, host, user, port, sshKeyPath, autoStart, autoConnect, projectDir });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch('/api/tunnels/:id', (req, res) => {
    try {
      const result = daemon.tunnelManager.update(req.params.id, req.body);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/tunnels/:id', async (req, res) => {
    try {
      await daemon.tunnelManager.delete(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/tunnels/:id/test', async (req, res) => {
    try {
      const result = await daemon.tunnelManager.test(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/tunnels/:id/connect', async (req, res) => {
    try {
      const opts = {};
      if (req.body?.skipTest && req.body?.testResult) {
        opts.skipTest = true;
        opts.testResult = req.body.testResult;
      }
      const result = await daemon.tunnelManager.connect(req.params.id, opts);
      res.json(result);
    } catch (err) {
      const body = { error: err.message };
      if (err.testResult) body.testResult = err.testResult;
      res.status(400).json(body);
    }
  });

  app.post('/api/tunnels/:id/disconnect', async (req, res) => {
    try {
      await daemon.tunnelManager.disconnect(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/tunnels/:id/install', async (req, res) => {
    try {
      const result = await daemon.tunnelManager.remoteInstall(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/tunnels/:id/start', async (req, res) => {
    try {
      await daemon.tunnelManager.autoStart(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/tunnels/:id/upgrade', async (req, res) => {
    try {
      const result = await daemon.tunnelManager.forceUpgrade(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tunnels/:id/status', (req, res) => {
    const s = daemon.tunnelManager.getStatus(req.params.id);
    if (!s) return res.status(404).json({ error: 'Remote not found' });
    res.json(s);
  });

  // --- Groove Network (Beta) ---

  // Offline fallback allowlist — SHA-256 hashes of valid codes so plaintext
  // codes aren't exposed in source. Used only when groovedev.ai is unreachable.
  const BETA_CODES_FALLBACK_HASHES = new Set([
    '2dd41c615fd155f322e8381fed28f346ed6592e2bbab1c068f156fa225c02110',
    '034d771385b608bb85d8f0225c561fe3c084b8ce7851221b01f9c2226dfe3e7b',
    'fad2c7b09f9161db518d8c9a8d338831eb3894ef0f36e2c7cb1884cffbb05768',
    '0ff4c9c1d224e59ac370d6f4bf315ae2ec750af014758c8206f38980cb7603ba',
    '08b2ffe7f40afe2894db335860d67af877fa31201b3e2c25736480eb3f7c58ef',
  ]);

  function hashCode(code) {
    return createHash('sha256').update(code).digest('hex');
  }

  const BETA_VALIDATE_URL = 'https://groovedev.ai/api/beta/validate';

  const betaAttempts = [];
  const BETA_RATE_LIMIT = 5;
  const BETA_RATE_WINDOW_MS = 60_000;

  function getMachineId() {
    const idFile = join(daemon.grooveDir, '.machine-id');
    try {
      const existing = readFileSync(idFile, 'utf8').trim();
      if (existing.length >= 32) return existing;
    } catch {}
    const id = createHash('sha256').update(`${hostname()}|${randomUUID()}`).digest('hex');
    try { writeFileSync(idFile, id, { mode: 0o600 }); } catch {}
    return id;
  }

  async function validateCodeWithServer(code) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(BETA_VALIDATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, machineId: getMachineId() }),
        signal: controller.signal,
      });
      if (!response.ok && response.status !== 200) {
        return { ok: false, reason: 'http', status: response.status };
      }
      const body = await response.json();
      return { ok: true, result: body };
    } catch (err) {
      return { ok: false, reason: 'network', error: err.message };
    } finally {
      clearTimeout(timeout);
    }
  }

  function isNetworkUnlocked() {
    return !!(daemon.config?.networkBeta?.unlocked);
  }

  function networkGate(req, res, next) {
    // Return 404 (not 403) so the feature is invisible until unlocked.
    if (!isNetworkUnlocked()) return res.status(404).json({ error: 'Not found' });
    next();
  }

  async function persistConfig() {
    const { saveConfig } = await import('../firstrun.js');
    saveConfig(daemon.grooveDir, daemon.config);
  }

  app.get('/api/beta/status', (req, res) => {
    res.json({ unlocked: isNetworkUnlocked() });
  });

  app.post('/api/beta/activate', async (req, res) => {
    const now = Date.now();
    while (betaAttempts.length && betaAttempts[0] < now - BETA_RATE_WINDOW_MS) betaAttempts.shift();
    if (betaAttempts.length >= BETA_RATE_LIMIT) {
      return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
    }
    betaAttempts.push(now);

    const { code } = req.body || {};
    if (typeof code !== 'string' || code.length > 64 || !/^[A-Z0-9-]+$/.test(code)) {
      return res.status(400).json({ error: 'Invalid code format' });
    }

    const remote = await validateCodeWithServer(code);

    let valid = false;
    let message = 'Invalid invite code';
    let expiresAt = null;
    let features = [];
    let source = 'server';

    if (remote.ok && remote.result && typeof remote.result === 'object') {
      valid = remote.result.valid === true;
      if (typeof remote.result.message === 'string') message = remote.result.message;
      if (typeof remote.result.expiresAt === 'string' || remote.result.expiresAt === null) {
        expiresAt = remote.result.expiresAt || null;
      }
      if (Array.isArray(remote.result.features)) features = remote.result.features;
    } else {
      // Offline fallback — only trust the hashed list when we can't reach the server
      source = 'fallback';
      if (BETA_CODES_FALLBACK_HASHES.has(hashCode(code))) {
        valid = true;
        message = 'Activated (offline)';
        features = ['network-node', 'network-consumer'];
      } else {
        message = 'Invalid invite code';
      }
    }

    if (!valid) {
      daemon.audit.log('beta.activate.denied', { codePrefix: code.slice(0, 10), source });
      return res.status(200).json({ unlocked: false, message });
    }

    daemon.config.networkBeta = {
      ...(daemon.config.networkBeta || {}),
      unlocked: true,
      code,
      expiresAt,
      features,
    };
    await persistConfig();
    daemon.audit.log('beta.activate', { codePrefix: code.slice(0, 10), source, features });
    daemon.broadcast({ type: 'config:updated' });
    res.json({ unlocked: true, message, expiresAt, features });
  });

  // Re-validate stored code against groovedev.ai. Called at daemon startup
  // so revoked or expired codes lock the feature automatically. Non-blocking.
  daemon.revalidateBetaCode = async function revalidateBetaCode() {
    const cfg = daemon.config?.networkBeta;
    if (!cfg?.unlocked) return;
    if (!cfg?.code) {
      daemon.config.networkBeta = { ...cfg, unlocked: false, expiresAt: null, features: [] };
      await persistConfig();
      daemon.audit.log('beta.revoked', { reason: 'missing code' });
      daemon.broadcast({ type: 'config:updated' });
      return;
    }
    const remote = await validateCodeWithServer(cfg.code);
    // If we couldn't reach the server, keep the current unlocked state —
    // network failures must not lock out beta users.
    if (!remote.ok || !remote.result || typeof remote.result !== 'object') return;
    if (remote.result.valid === true) {
      // Refresh features/expiresAt from server in case they changed
      const next = {
        ...cfg,
        expiresAt: typeof remote.result.expiresAt === 'string' ? remote.result.expiresAt : null,
        features: Array.isArray(remote.result.features) ? remote.result.features : (cfg.features || []),
      };
      if (JSON.stringify(next) !== JSON.stringify(cfg)) {
        daemon.config.networkBeta = next;
        await persistConfig();
        daemon.broadcast({ type: 'config:updated' });
      }
      return;
    }
    // Server says invalid — revoke
    daemon.config.networkBeta = {
      ...cfg,
      unlocked: false,
      code: null,
      expiresAt: null,
      features: [],
    };
    await persistConfig();
    daemon.audit.log('beta.revoked', { reason: remote.result.message || 'server denied' });
    daemon.broadcast({ type: 'config:updated' });
  };

  app.post('/api/beta/deactivate', async (req, res) => {
    // Stop the node if it's running before locking the feature away.
    if (daemon.networkNode?.proc && !daemon.networkNode.proc.killed) {
      safeKill(daemon.networkNode.proc);
    }
    daemon.networkNode = {
      active: false, status: 'stopped', pid: null, proc: null,
      nodeId: null, layers: null, model: null, sessions: 0,
      hardware: null, startedAt: null, events: [],
    };
    daemon.config.networkBeta = {
      ...(daemon.config.networkBeta || {}),
      unlocked: false,
      code: null,
    };
    await persistConfig();
    daemon.audit.log('beta.deactivate', {});
    daemon.broadcast({ type: 'config:updated' });
    res.json({ unlocked: false });
  });

  // Network node lifecycle (gated)

  let _localHwCache = null;
  function getLocalHardware() {
    if (!_localHwCache) {
      const sys = OllamaProvider.getSystemHardware();
      const vramGb = sys.gpu?.vram || 0;
      const ramGb = sys.totalRamGb || 0;
      const vramMb = vramGb * 1024;
      const ramMb = ramGb * 1024;
      const fmtGb = (gb) => gb > 0 ? `${gb} GB` : null;
      _localHwCache = {
        device: sys.gpu?.type === 'nvidia' ? 'cuda' : sys.gpu?.type === 'apple-silicon' ? 'metal' : 'cpu',
        gpu: sys.gpu?.name || null,
        memory: fmtGb(vramGb) || fmtGb(ramGb),
        vram: fmtGb(vramGb),
        ram: fmtGb(ramGb),
        cpuCores: sys.cores || null,
        ram_mb: ramMb,
        vram_mb: vramMb,
        gpu_model: sys.gpu?.name || null,
        cpu_cores: sys.cores || 0,
        bandwidth_mbps: 0,
        max_context_length: 0,
      };
    }
    return _localHwCache;
  }

  function snapshotNode() {
    const n = daemon.networkNode || {};
    const hw = n.hardware || getLocalHardware();
    return {
      active: !!n.active,
      status: n.status || 'stopped',
      nodeId: n.nodeId || null,
      layers: n.layers || null,
      model: n.model || null,
      sessions: n.sessions || 0,
      hardware: hw,
      installed: !!(daemon.config?.networkBeta?.installed),
      ram_mb: Number(hw.ram_mb) || 0,
      vram_mb: Number(hw.vram_mb) || 0,
      gpu_model: hw.gpu_model || hw.gpu || '',
      cpu_cores: Number(hw.cpu_cores) || 0,
      bandwidth_mbps: Number(hw.bandwidth_mbps) || 0.0,
      max_context_length: Number(hw.max_context_length) || 0,
      load: Number(hw.load) || 0.0,
    };
  }

  function eventLevel(event) {
    if (event === 'error' || event === 'crashed') return 'error';
    if (event === 'exit' || event === 'stopping' || event === 'disconnected') return 'warning';
    if (event === 'connected' || event === 'node registered' || event === 'shard loaded') return 'success';
    if (event === 'serving session' || event === 'session complete' || event === 'session ended') return 'session';
    return 'info';
  }

  function pushNodeEvent(event, details) {
    const d = details || {};
    const message = typeof d.msg === 'string' ? d.msg
      : typeof d.message === 'string' ? d.message
      : typeof d.line === 'string' ? d.line
      : event;
    const entry = {
      timestamp: new Date().toISOString(),
      event,
      level: eventLevel(event),
      message,
      details: details || null,
    };
    daemon.networkNode.events = daemon.networkNode.events || [];
    daemon.networkNode.events.push(entry);
    if (daemon.networkNode.events.length > 200) {
      daemon.networkNode.events = daemon.networkNode.events.slice(-200);
    }
    daemon.broadcast({ type: 'network:node:event', data: entry });
  }

  function normalizeHardware(caps) {
    if (!caps || typeof caps !== 'object') return null;
    const formatMb = (mb) => (Number.isFinite(mb) && mb > 0)
      ? (mb >= 1024 ? `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB` : `${mb} MB`)
      : null;
    const vram = formatMb(caps.vram_mb);
    const ram = formatMb(caps.ram_mb);
    return {
      device: caps.device || null,
      gpu: caps.gpu_model || null,
      memory: vram || ram || null,
      vram,
      ram,
      cpuCores: caps.cpu_cores || null,
      bandwidthMbps: caps.bandwidth_mbps || null,
      maxContext: caps.max_context_length || null,
      ram_mb: Number(caps.ram_mb) || 0,
      vram_mb: Number(caps.vram_mb) || 0,
      gpu_model: caps.gpu_model || null,
      cpu_cores: Number(caps.cpu_cores) || 0,
      bandwidth_mbps: Number(caps.bandwidth_mbps) || 0,
      max_context_length: Number(caps.max_context_length) || 0,
    };
  }

  function broadcastNodeStatus() {
    daemon.broadcast({ type: 'network:node:status', data: snapshotNode() });
  }

  app.get('/api/network/node/status', networkGate, (req, res) => {
    res.json(snapshotNode());
  });

  app.post('/api/network/node/start', networkGate, (req, res) => {
    if (daemon.networkNode?.active) {
      return res.status(409).json({ error: 'Node already running' });
    }

    const cfg = daemon.config.networkBeta || {};
    const signal = stripScheme(cfg.signalUrl);
    if (!isAllowedSignalHost(signal)) {
      return res.status(400).json({ error: 'Invalid signal host' });
    }
    const device = cfg.devicePreference || 'auto';
    const maxContext = Number.isFinite(cfg.maxContext) ? cfg.maxContext : 4096;

    // Resolve deploy path (handles ~ and defaults to ~/Desktop/groove-deploy)
    let deployPath = cfg.deployPath || null;
    if (!deployPath) {
      deployPath = resolve(homedir(), 'Desktop', 'groove-deploy');
    } else if (deployPath.startsWith('~/')) {
      deployPath = resolve(homedir(), deployPath.slice(2));
    }

    if (!existsSync(deployPath)) {
      return res.status(400).json({ error: `Deploy path not found: ${deployPath}` });
    }
    if (!isInsideGrooveHome(deployPath) && !deployPath.startsWith(resolve(homedir(), 'Desktop'))) {
      return res.status(400).json({ error: 'Deploy path outside allowed directories' });
    }

    const signalFlag = supportsSignalFlag(cfg.version) ? '--signal' : '--relay';
    const model = cfg.model || 'Qwen/Qwen3-4B';
    const args = [
      '-m', 'src.node.server',
      signalFlag, signal,
      '--tls',
      '--device', device,
      '--model', model,
      '--max-context', String(maxContext),
    ];

    let proc;
    try {
      proc = spawn(venvPython(deployPath), args, {
        cwd: deployPath,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      return res.status(500).json({ error: `Failed to spawn node: ${err.message}` });
    }

    daemon.networkNode = {
      active: true,
      status: 'starting',
      pid: proc.pid,
      proc,
      nodeId: null,
      layers: null,
      model: null,
      sessions: 0,
      hardware: getLocalHardware(),
      startedAt: Date.now(),
      events: [],
      lastTokenTiming: null,
    };
    if (!daemon.networkBenchmarks) daemon.networkBenchmarks = [];

    pushNodeEvent('starting', { pid: proc.pid, signal, device });
    broadcastNodeStatus();

    let stderrBuf = '';
    const stderrDecoder = new StringDecoder('utf8');
    proc.stderr.on('data', (chunk) => {
      stderrBuf += stderrDecoder.write(chunk);
      let idx;
      while ((idx = stderrBuf.indexOf('\n')) !== -1) {
        const line = stderrBuf.slice(0, idx).trim();
        stderrBuf = stderrBuf.slice(idx + 1);
        if (!line) continue;
        if (line[0] !== '{') {
          // Python node emits plain-text logs like "Node identity: abc123",
          // "shard loaded: layers 0-12", "registered with signal". Parse those
          // here so the GUI reflects reality even without structured logging.
          let changed = false;
          const idMatch = line.match(/Node identity:\s*([A-Za-z0-9_\-:.]+)/i);
          if (idMatch && idMatch[1] !== daemon.networkNode.nodeId) {
            daemon.networkNode.nodeId = idMatch[1]; changed = true;
          }
          const layerMatch = line.match(/layers?\s*(\d+)\s*[-–to]+\s*(\d+)/i);
          if (layerMatch) {
            const start = parseInt(layerMatch[1], 10);
            const end = parseInt(layerMatch[2], 10);
            if (Number.isFinite(start) && Number.isFinite(end)) {
              daemon.networkNode.layers = [start, end]; changed = true;
            }
          }
          const modelMatch = line.match(/model[:\s]+([A-Za-z0-9_\-./]+\/[A-Za-z0-9_\-.]+)/i);
          if (modelMatch && modelMatch[1] !== daemon.networkNode.model) {
            daemon.networkNode.model = modelMatch[1]; changed = true;
          }
          if (/\bregistered\b/i.test(line) || /\bconnected\b/i.test(line)) {
            if (daemon.networkNode.status !== 'connected') {
              daemon.networkNode.status = 'connected'; changed = true;
            }
          }
          pushNodeEvent('log', { line });
          if (changed) broadcastNodeStatus();
          continue;
        }
        let entry;
        try { entry = JSON.parse(line); } catch { pushNodeEvent('log', { line }); continue; }
        const msg = entry.msg || entry.event || '';
        let changed = false;
        if (entry.node_id && entry.node_id !== daemon.networkNode.nodeId) {
          daemon.networkNode.nodeId = entry.node_id; changed = true;
        }
        if (msg === 'node registered' || msg === 'connected') {
          daemon.networkNode.status = 'connected'; changed = true;
        }
        if (msg === 'shard loaded' || entry.layer_start !== undefined) {
          if (entry.layer_start !== undefined && entry.layer_end !== undefined) {
            daemon.networkNode.layers = [entry.layer_start, entry.layer_end]; changed = true;
          }
          if (entry.model_name) { daemon.networkNode.model = entry.model_name; changed = true; }
        }
        if (msg === 'serving session') {
          daemon.networkNode.sessions = (daemon.networkNode.sessions || 0) + 1; changed = true;
        }
        if (msg === 'session complete' || msg === 'session ended') {
          daemon.networkNode.sessions = Math.max(0, (daemon.networkNode.sessions || 0) - 1); changed = true;
        }
        if (entry.capabilities || entry.hardware) {
          daemon.networkNode.hardware = normalizeHardware(entry.capabilities || entry.hardware); changed = true;
        }
        if (entry.type === 'token') {
          const timing = {
            token_ms: entry.token_ms, pipeline_ms: entry.pipeline_ms,
            prefill_ms: entry.prefill_ms, logits_deser_ms: entry.logits_deser_ms,
            sample_ms: entry.sample_ms, decode_ms: entry.decode_ms,
            tps: entry.tps, ttft_ms: entry.ttft_ms, is_prefill: entry.is_prefill,
            tokens_generated: entry.tokens_generated,
            stages: Array.isArray(entry.stages) ? entry.stages : [],
          };
          daemon.networkNode.lastTokenTiming = timing;
          daemon.broadcast({ type: 'network:token:timing', data: timing });
        }
        if (entry.type === 'timing') {
          const summary = {
            ttft_ms: entry.ttft_ms, tps: entry.tps,
            tokens_generated: entry.tokens_generated,
            total_network_ms: entry.total_network_ms,
            total_compute_ms: entry.total_compute_ms,
            p2p_sends: entry.p2p_sends, relay_sends: entry.relay_sends,
            stage_0_avg_ms: entry.stage_0_avg_ms, stage_0_count: entry.stage_0_count,
            stage_1_avg_ms: entry.stage_1_avg_ms, stage_1_count: entry.stage_1_count,
            t: Date.now(),
          };
          if (!daemon.networkBenchmarks) daemon.networkBenchmarks = [];
          daemon.networkBenchmarks.push(summary);
          if (daemon.networkBenchmarks.length > 100) daemon.networkBenchmarks.shift();
          daemon.broadcast({ type: 'network:timing:summary', data: summary });
        }
        pushNodeEvent(msg || 'log', entry);
        if (changed) broadcastNodeStatus();
      }
    });

    let stdoutBuf = '';
    const stdoutDecoder = new StringDecoder('utf8');
    proc.stdout.on('data', (chunk) => {
      stdoutBuf += stdoutDecoder.write(chunk);
      let idx;
      while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (line) pushNodeEvent('stdout', { line });
      }
    });

    proc.on('error', (err) => {
      daemon.networkNode.status = 'error';
      pushNodeEvent('error', { message: err.message });
      broadcastNodeStatus();
    });

    proc.on('exit', (code, signal) => {
      const trailing = stdoutDecoder.end();
      if (trailing) stdoutBuf += trailing;
      if (stdoutBuf.trim()) pushNodeEvent('stdout', { line: stdoutBuf.trim() });
      const trailingErr = stderrDecoder.end();
      if (trailingErr) stderrBuf += trailingErr;
      daemon.networkNode.active = false;
      daemon.networkNode.status = 'stopped';
      daemon.networkNode.pid = null;
      daemon.networkNode.proc = null;
      pushNodeEvent('exit', { code, signal });
      broadcastNodeStatus();
    });

    daemon.audit.log('network.node.start', { pid: proc.pid, signal, device });
    res.status(202).json({ started: true, ...snapshotNode() });
  });

  app.post('/api/network/node/stop', networkGate, (req, res) => {
    const node = daemon.networkNode;
    if (!node?.active || !node.proc) {
      return res.status(409).json({ error: 'Node not running' });
    }
    safeKill(node.proc);
    daemon.networkNode.status = 'stopping';
    pushNodeEvent('stopping', { pid: node.pid });
    broadcastNodeStatus();
    daemon.audit.log('network.node.stop', { pid: node.pid });
    res.json({ stopping: true });
  });

  app.get('/api/network/benchmarks', networkGate, (req, res) => {
    res.json(daemon.networkBenchmarks || []);
  });

  app.get('/api/network/timing', networkGate, (req, res) => {
    res.json({
      current: daemon.networkNode?.lastTokenTiming || null,
      benchmarkCount: (daemon.networkBenchmarks || []).length,
    });
  });

  app.get('/api/network/traces', networkGate, (req, res) => {
    const tracesDir = resolve(homedir(), '.groove', 'traces');
    if (!existsSync(tracesDir)) return res.json([]);
    try {
      const files = readdirSync(tracesDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => {
          const st = statSync(resolve(tracesDir, f));
          return { filename: f, size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      res.json(files);
    } catch { res.json([]); }
  });

  app.get('/api/network/traces/live', networkGate, (req, res) => {
    const tracesDir = resolve(homedir(), '.groove', 'traces');
    if (!existsSync(tracesDir)) {
      return res.json({ lines: [], nextOffset: 0, filename: null, active: false });
    }
    try {
      const files = readdirSync(tracesDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => {
          const st = statSync(resolve(tracesDir, f));
          return { filename: f, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      if (files.length === 0) {
        return res.json({ lines: [], nextOffset: 0, filename: null, active: false });
      }
      const newest = files[0];
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const filePath = resolve(tracesDir, newest.filename);
      const raw = readFileSync(filePath, 'utf8');
      const allLines = raw.split('\n').filter(Boolean);
      const sliced = allLines.slice(offset);
      const parsed = [];
      for (const line of sliced) {
        try { parsed.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
      const active = !!(daemon.networkNode?.active && (daemon.networkNode.sessions || 0) > 0);
      res.json({
        lines: parsed,
        nextOffset: offset + sliced.length,
        filename: newest.filename,
        active,
      });
    } catch {
      res.json({ lines: [], nextOffset: 0, filename: null, active: false });
    }
  });

  app.get('/api/network/traces/:filename', networkGate, (req, res) => {
    const { filename } = req.params;
    if (!filename || /[/\\]/.test(filename) || !filename.endsWith('.jsonl')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const tracesDir = resolve(homedir(), '.groove', 'traces');
    const filePath = resolve(tracesDir, filename);
    if (!filePath.startsWith(tracesDir + sep)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'Trace file not found' });
    }
    try {
      const raw = readFileSync(filePath, 'utf8');
      const lines = raw.split('\n').filter(Boolean).slice(0, 5000);
      const entries = [];
      for (const line of lines) {
        try { entries.push(JSON.parse(line)); } catch { /* skip malformed lines */ }
      }
      res.json(entries);
    } catch (err) {
      res.status(500).json({ error: `Failed to read trace: ${err.message}` });
    }
  });

  function isAllowedSignalHost(host) {
    const h = (host || '').replace(/^(wss?|https?):\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    return h === 'signal.groovedev.ai' || h.endsWith('.groovedev.ai');
  }

  // The Python node/client code prepends the scheme itself from `--tls`.
  // Daemon must pass a BARE host to --relay/--signal; otherwise the Python
  // side ends up with a double-scheme URI like wss://wss://host.
  function stripScheme(url) {
    if (!url) return 'signal.groovedev.ai';
    return url.replace(/^wss?:\/\//i, '').replace(/\/.*$/, '');
  }

  app.get('/api/network/status', networkGate, async (req, res) => {
    const cfg = daemon.config.networkBeta || {};
    const signalHost = cfg.signalUrl || 'signal.groovedev.ai';

    if (!isAllowedSignalHost(signalHost)) {
      return res.status(400).json({ error: 'Invalid signal host' });
    }

    const bareHost = signalHost.replace(/^(wss?|https?):\/\//i, '').replace(/\/.*$/, '');
    const statusUrl = `https://${bareHost}/status`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const r = await fetch(statusUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (r.ok) {
        const data = await r.json();
        // Signal service returns snake_case; GUI expects camelCase.
        const models = Array.isArray(data.models) ? data.models.map((m) => {
          if (!m || typeof m !== 'object') return m;
          const { covered_layers, total_layers, ...rest } = m;
          return {
            ...rest,
            ...(covered_layers !== undefined ? { coveredLayers: covered_layers } : {}),
            ...(total_layers !== undefined ? { totalLayers: total_layers } : {}),
          };
        }) : [];
        const primaryModel = Array.isArray(data.models) && data.models[0] ? data.models[0] : {};

        // Enrich local node state from signal's authoritative topology.
        // Signal truncates IDs (e.g. "0xf608fd..."), so match by prefix.
        if (daemon.networkNode?.active && daemon.networkNode.nodeId) {
          const selfId = daemon.networkNode.nodeId;
          const signalNodes = Array.isArray(data.nodes) ? data.nodes : [];
          const self = signalNodes.find((n) => {
            const nid = n.node_id || n.nodeId || '';
            const prefix = nid.replace(/\.{2,}$/, '');
            return selfId === nid || (prefix.length >= 6 && selfId.startsWith(prefix));
          });
          let changed = false;
          if (self) {
            if (Array.isArray(self.layers) && self.layers.length === 2) {
              daemon.networkNode.layers = self.layers;
              changed = true;
            }
            const prev = daemon.networkNode.hardware || getLocalHardware();
            const enriched = { ...prev };
            if (self.device) enriched.device = self.device;
            if (self.gpu_model) { enriched.gpu = self.gpu_model; enriched.gpu_model = self.gpu_model; }
            if (Number(self.ram_mb) > 0) { enriched.ram_mb = Number(self.ram_mb); }
            if (Number(self.vram_mb) > 0) { enriched.vram_mb = Number(self.vram_mb); enriched.memory = enriched.vram_mb >= 1024 ? `${(enriched.vram_mb / 1024).toFixed(1)} GB` : `${enriched.vram_mb} MB`; }
            if (Number(self.cpu_cores) > 0) { enriched.cpu_cores = Number(self.cpu_cores); enriched.cpuCores = Number(self.cpu_cores); }
            daemon.networkNode.hardware = enriched;
            changed = true;
          }
          const availModel = Array.isArray(data.models)
            ? data.models.find((m) => m && m.available !== false)
            : null;
          if (availModel && !daemon.networkNode.model) {
            daemon.networkNode.model = availModel.name || null;
            changed = true;
          }
          if (changed) broadcastNodeStatus();
        }

        const capStr = (s, max = 200) => (typeof s === 'string' ? s.slice(0, max) : s);
        const selfId = daemon.networkNode?.nodeId;
        const localHw = getLocalHardware();
        const safeNodes = (Array.isArray(data.nodes) ? data.nodes : []).map((n) => {
          const nid = n.node_id || n.nodeId || '';
          const isSelf = selfId && nid && (nid === selfId || (nid.length >= 6 && selfId.startsWith(nid.replace(/\.{2,}$/, ''))));
          const base = {
            node_id: capStr(nid),
            device: capStr(n.device),
            layers: Array.isArray(n.layers) ? n.layers.slice(0, 2) : n.layers,
            status: capStr(n.status, 50),
            active_sessions: n.active_sessions ?? 0,
            ram_mb: Number(n.ram_mb) || 0,
            vram_mb: Number(n.vram_mb) || 0,
            gpu_model: capStr(n.gpu_model || '', 200),
            cpu_cores: Number(n.cpu_cores) || 0,
            bandwidth_mbps: Number(n.bandwidth_mbps) || 0.0,
            max_context_length: Number(n.max_context_length) || 0,
            load: Number(n.load) || 0.0,
            gpu_utilization_pct: Number(n.gpu_utilization_pct) || 0,
            vram_used_mb: Number(n.vram_used_mb) || 0,
            ram_used_mb: Number(n.ram_used_mb) || 0,
            ram_pct: Number(n.ram_pct) || 0,
            uptime_seconds: Number(n.uptime_seconds) || 0,
          };
          if (isSelf) {
            if (!base.device) base.device = localHw.device;
            if (!base.gpu_model) base.gpu_model = localHw.gpu_model || '';
            if (!base.ram_mb) base.ram_mb = localHw.ram_mb;
            if (!base.vram_mb) base.vram_mb = localHw.vram_mb;
            if (!base.cpu_cores) base.cpu_cores = localHw.cpu_cores;
          }
          return base;
        });

        return res.json({
          nodes: safeNodes,
          models,
          compute: data.compute || null,
          coverage: data.covered_layers ?? primaryModel.covered_layers ?? data.coverage ?? 0,
          totalLayers: data.total_layers ?? primaryModel.total_layers ?? data.totalLayers ?? 36,
          activeSessions: data.active_sessions ?? data.activeSessions ?? 0,
          totalNodes: data.total_nodes ?? data.totalNodes ?? (Array.isArray(data.nodes) ? data.nodes.length : 0),
        });
      }
    } catch { /* fall through to local snapshot */ }

    // Fallback: local node snapshot when signal is unreachable.
    const node = daemon.networkNode || {};
    const hw = node.hardware || {};
    const sysHw = OllamaProvider.getSystemHardware();
    const localRamMb = (sysHw.totalRamGb || 0) * 1024;
    const localVramMb = (sysHw.gpu?.vram || 0) * 1024;
    const localCpuCores = sysHw.cores || 0;
    const selfNode = node.active && node.nodeId ? [{
      node_id: node.nodeId,
      device: hw.device || (sysHw.gpu?.type === 'nvidia' ? 'cuda' : sysHw.gpu?.type === 'apple-silicon' ? 'metal' : 'cpu'),
      layers: node.layers || [0, 0],
      status: node.status === 'connected' ? 'active' : node.status,
      active_sessions: node.sessions || 0,
      ram_mb: localRamMb,
      vram_mb: localVramMb,
      gpu_model: sysHw.gpu?.name || '',
      cpu_cores: localCpuCores,
      bandwidth_mbps: 0.0,
      max_context_length: 0,
      load: 0.0,
      gpu_utilization_pct: 0,
      vram_used_mb: 0,
      ram_used_mb: 0,
      ram_pct: 0,
      uptime_seconds: 0,
    }] : [];
    const coverage = node.layers ? (node.layers[1] - node.layers[0]) : 0;
    const localCompute = selfNode.length > 0 ? {
      total_ram_mb: localRamMb,
      total_vram_mb: localVramMb,
      total_cpu_cores: localCpuCores,
      total_bandwidth_mbps: 0.0,
      active_nodes: selfNode.length,
      total_nodes: selfNode.length,
      avg_load: 0.0,
    } : null;
    res.json({
      nodes: selfNode,
      models: ['Qwen/Qwen3-4B'],
      compute: localCompute,
      coverage,
      totalLayers: 36,
      activeSessions: node.sessions || 0,
      totalNodes: selfNode.length,
    });
  });

  app.get('/api/network/compute', networkGate, async (req, res) => {
    const cfg = daemon.config.networkBeta || {};
    const signalHost = cfg.signalUrl || 'signal.groovedev.ai';

    if (!isAllowedSignalHost(signalHost)) {
      return res.status(400).json({ error: 'Invalid signal host' });
    }

    const bareHost = signalHost.replace(/^(wss?|https?):\/\//i, '').replace(/\/.*$/, '');
    const statusUrl = `https://${bareHost}/status`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const r = await fetch(statusUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (r.ok) {
        const data = await r.json();
        const nodes = (Array.isArray(data.nodes) ? data.nodes : []).map((n) => ({
          node_id: n.node_id || n.nodeId || '',
          ram_mb: Number(n.ram_mb) || 0,
          vram_mb: Number(n.vram_mb) || 0,
          gpu_model: typeof n.gpu_model === 'string' ? n.gpu_model.slice(0, 200) : '',
          cpu_cores: Number(n.cpu_cores) || 0,
          bandwidth_mbps: Number(n.bandwidth_mbps) || 0.0,
          max_context_length: Number(n.max_context_length) || 0,
          load: Number(n.load) || 0.0,
          gpu_utilization_pct: Number(n.gpu_utilization_pct) || 0,
          vram_used_mb: Number(n.vram_used_mb) || 0,
          ram_used_mb: Number(n.ram_used_mb) || 0,
          ram_pct: Number(n.ram_pct) || 0,
          uptime_seconds: Number(n.uptime_seconds) || 0,
        }));
        return res.json({ compute: data.compute || null, nodes });
      }
    } catch { /* fall through to local snapshot */ }

    const node = daemon.networkNode || {};
    const sysHw = OllamaProvider.getSystemHardware();
    const localRamMb = (sysHw.totalRamGb || 0) * 1024;
    const localVramMb = (sysHw.gpu?.vram || 0) * 1024;
    const localCpuCores = sysHw.cores || 0;
    const isActive = !!(node.active && node.nodeId);
    const nodes = isActive ? [{
      node_id: node.nodeId,
      ram_mb: localRamMb,
      vram_mb: localVramMb,
      gpu_model: sysHw.gpu?.name || '',
      cpu_cores: localCpuCores,
      bandwidth_mbps: 0.0,
      max_context_length: 0,
      load: 0.0,
      gpu_utilization_pct: 0,
      vram_used_mb: 0,
      ram_used_mb: 0,
      ram_pct: 0,
      uptime_seconds: 0,
    }] : [];
    const compute = isActive ? {
      total_ram_mb: localRamMb,
      total_vram_mb: localVramMb,
      total_cpu_cores: localCpuCores,
      total_bandwidth_mbps: 0.0,
      active_nodes: 1,
      total_nodes: 1,
      avg_load: 0.0,
    } : null;
    res.json({ compute, nodes });
  });

  // --- Network package install/uninstall ---

  const IS_WIN = process.platform === 'win32';
  const NETWORK_REPO_URL = 'https://github.com/grooveai-dev/groove-network.git';
  const NETWORK_VERSION = 'v0.2.0';

  function venvPython(base) {
    return IS_WIN
      ? join(base, 'venv', 'Scripts', 'python.exe')
      : join(base, 'venv', 'bin', 'python3');
  }

  let _cachedGitBash = undefined;
  function findGitBash() {
    if (_cachedGitBash !== undefined) return _cachedGitBash;
    try {
      const gitPath = execFileSync('where', ['git'], { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim().split('\n')[0].trim();
      // git.exe is typically at <Git>\cmd\git.exe — navigate up to Git root
      const gitDir = dirname(dirname(gitPath));
      const candidate = join(gitDir, 'bin', 'bash.exe');
      if (existsSync(candidate)) { _cachedGitBash = candidate; return _cachedGitBash; }
    } catch { /* where failed — try common paths */ }
    const fallbacks = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ];
    for (const p of fallbacks) {
      if (existsSync(p)) { _cachedGitBash = p; return _cachedGitBash; }
    }
    _cachedGitBash = null;
    return null;
  }

  function spawnSetupSh(cwd) {
    if (IS_WIN) {
      const bashPath = findGitBash();
      if (!bashPath) {
        const err = new Error('Could not find bash. Ensure Git for Windows is installed from https://git-scm.com');
        err.code = 'BASH_NOT_FOUND';
        throw err;
      }
      return spawn(bashPath, ['setup.sh', '--json'], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });
    }
    return spawn('bash', ['setup.sh', '--json'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
  }

  function safeKill(proc, signal = 'SIGINT') {
    try {
      if (IS_WIN) { proc.kill(); } else { proc.kill(signal); }
    } catch { /* ignore */ }
  }

  function networkRoot() {
    return resolve(homedir(), '.groove', 'network');
  }

  function getInstalledNetworkVersion() {
    const configured = daemon.config?.networkBeta?.version || null;
    if (configured) return configured;
    const installPath = networkRoot();
    if (!existsSync(resolve(installPath, 'setup.sh'))) return null;
    try {
      const { execSync } = require('child_process');
      const v = execSync('git describe --tags --abbrev=0', {
        cwd: installPath, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
      }).toString().trim();
      return parseSemver(v) ? v : null;
    } catch {
      return null;
    }
  }

  // Defensive: only permit fs ops on paths that resolve inside ~/.groove/.
  // Uses realpathSync when the path exists to defeat symlink escapes.
  function isInsideGrooveHome(target) {
    const home = resolve(homedir(), '.groove') + sep;
    const resolved = resolve(target);
    let full;
    try { full = existsSync(resolved) ? realpathSync(resolved) + sep : resolved + sep; }
    catch { full = resolved + sep; }
    const realHome = existsSync(home.slice(0, -1)) ? realpathSync(home.slice(0, -1)) + sep : home;
    return full.startsWith(realHome);
  }

  function broadcastInstallProgress(step, message, percent) {
    daemon.broadcast({
      type: 'network:install:progress',
      data: { step, message, percent },
    });
  }

  app.get('/api/network/install/status', networkGate, (req, res) => {
    const installPath = networkRoot();
    const dirExists = existsSync(installPath);
    const installed = dirExists && existsSync(resolve(installPath, 'setup.sh'));
    const stale = dirExists && !installed;
    res.json({
      installed,
      stale,
      path: dirExists ? installPath : null,
      version: installed ? getInstalledNetworkVersion() : null,
    });
  });

  app.post('/api/network/install', networkGate, async (req, res) => {
    if (daemon.networkInstall?.running) {
      return res.status(409).json({ error: 'Install already in progress' });
    }
    if (daemon.config?.networkBeta?.installed) {
      return res.status(400).json({ error: 'Network package already installed' });
    }

    const installPath = networkRoot();
    if (!isInsideGrooveHome(installPath)) {
      return res.status(500).json({ error: 'Invalid install path' });
    }

    // If directory exists from a previous failed install, clean it up automatically.
    if (existsSync(installPath)) {
      if (daemon.config?.networkBeta?.installed) {
        return res.status(400).json({ error: 'Install path already exists; uninstall first' });
      }
      try {
        rmSync(installPath, { recursive: true, force: true });
        daemon.audit?.log?.('network.install.stale-cleanup', { path: installPath });
      } catch (cleanupErr) {
        return res.status(500).json({ error: `Failed to clean stale install directory: ${cleanupErr.message}` });
      }
    }

    daemon.networkInstall = { running: true, startedAt: Date.now() };
    res.status(200).json({ status: 'installing' });

    // Run the install asynchronously; progress flows over WebSocket.
    (async () => {
      const cleanup = () => {
        try {
          if (existsSync(installPath) && isInsideGrooveHome(installPath)) {
            rmSync(installPath, { recursive: true, force: true });
          }
        } catch { /* ignore */ }
      };

      const fail = (message) => {
        cleanup();
        broadcastInstallProgress('error', message, -1);
        daemon.audit.log('network.install.failed', { message });
        daemon.networkInstall = { running: false };
      };

      try {
        const pat = daemon.credentials?.getKey?.('github') || daemon.credentials?.getKey?.('github-pat') || null;

        let installVersion;
        try {
          installVersion = (await getLatestNetworkTag()) || NETWORK_VERSION;
        } catch {
          installVersion = NETWORK_VERSION;
        }

        broadcastInstallProgress('cloning', `Cloning network package ${installVersion}...`, 0);

        // Pre-flight: verify git is installed before attempting clone.
        const gitInstalled = await new Promise((resolveGit) => {
          execFile('git', ['--version'], { timeout: 5000 }, (err) => resolveGit(!err));
        });
        if (!gitInstalled) {
          return fail('Git is not installed. Install Git from https://git-scm.com and restart Groove.');
        }

        const cloneArgs = ['clone', '--branch', installVersion, '--depth', '1', NETWORK_REPO_URL, installPath];
        const cloneEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
        if (pat) {
          cloneEnv.GIT_CONFIG_COUNT = '1';
          cloneEnv.GIT_CONFIG_KEY_0 = 'http.extraHeader';
          cloneEnv.GIT_CONFIG_VALUE_0 = `Authorization: token ${pat}`;
        }
        const clone = spawn('git', cloneArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: cloneEnv,
        });

        const stripCredentials = (s) => s.replace(/https:\/\/[^@]+@/g, 'https://***@');

        let cloneErr = '';
        clone.stderr.on('data', (chunk) => {
          const s = chunk.toString();
          cloneErr += s;
          // git writes progress to stderr — relay last line as status.
          const line = s.split('\n').map((l) => l.trim()).filter(Boolean).pop();
          if (line) broadcastInstallProgress('cloning', stripCredentials(line), 5);
        });

        const cloneCode = await new Promise((resolveClone) => {
          clone.on('error', (err) => resolveClone({ code: -1, err: err.message }));
          clone.on('close', (code) => resolveClone({ code }));
        });

        if (cloneCode.code !== 0) {
          let hint;
          const errMsg = cloneCode.err || '';
          const lastLine = cloneErr.trim().split('\n').slice(-1)[0] || '';
          if (errMsg.includes('ENOENT')) {
            hint = 'Git is not installed. Install Git from https://git-scm.com and restart Groove.';
          } else if (/Authentication failed|could not read Username/i.test(cloneErr)) {
            hint = 'Authentication failed — run "groove set-key github-pat <token>" to set a GitHub PAT.';
          } else if (/not found/i.test(cloneErr)) {
            hint = `Repository or tag not found (${installVersion}). Check NETWORK_REPO_URL and tag.`;
          } else {
            hint = stripCredentials(lastLine || errMsg || 'git clone failed');
          }
          return fail(`Clone failed: ${hint}`);
        }

        broadcastInstallProgress('cloned', 'Repository cloned', 10);

        // Run setup.sh --json from the install directory
        let setup;
        try {
          setup = spawnSetupSh(installPath);
        } catch (spawnErr) {
          return fail(`Setup failed: ${spawnErr.message}`);
        }

        daemon.networkInstall.proc = setup;

        let stdoutBuf = '';
        setup.stdout.on('data', (chunk) => {
          stdoutBuf += chunk.toString();
          let idx;
          while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
            const line = stdoutBuf.slice(0, idx).trim();
            stdoutBuf = stdoutBuf.slice(idx + 1);
            if (!line) continue;
            if (line[0] !== '{') continue;
            try {
              const event = JSON.parse(line);
              const step = typeof event.step === 'string' ? event.step : 'progress';
              const message = typeof event.message === 'string' ? event.message : '';
              const percent = Number.isFinite(event.percent) ? event.percent : null;
              broadcastInstallProgress(step, message, percent);
            } catch { /* non-JSON line, ignore */ }
          }
        });

        let stderrBuf = '';
        setup.stderr.on('data', (chunk) => {
          stderrBuf += chunk.toString();
        });

        const setupResult = await new Promise((resolveSetup) => {
          setup.on('error', (err) => resolveSetup({ code: -1, err: err.message }));
          setup.on('close', (code) => resolveSetup({ code }));
        });

        if (setupResult.code !== 0) {
          let hint;
          if (setupResult.code === -1 || setupResult.err?.includes('ENOENT')) {
            hint = 'bash not found — ensure Git for Windows is installed from https://git-scm.com';
          } else {
            hint = stderrBuf.trim().split('\n').slice(-1)[0] || `setup.sh exited ${setupResult.code}`;
          }
          return fail(`Setup failed: ${hint}`);
        }

        daemon.config.networkBeta = {
          ...(daemon.config.networkBeta || {}),
          installed: true,
          deployPath: installPath,
          version: installVersion,
        };
        await persistConfig();
        daemon.broadcast({ type: 'config:updated' });
        broadcastInstallProgress('done', `Network package ${installVersion} installed`, 100);
        daemon.audit.log('network.install', { path: installPath, version: installVersion });
        daemon.networkInstall = { running: false };
      } catch (err) {
        fail(err?.message || 'Install failed');
      }
    })();
  });

  app.post('/api/network/uninstall', networkGate, async (req, res) => {
    if (daemon.networkInstall?.running) {
      return res.status(409).json({ error: 'Install in progress; wait for it to finish' });
    }

    // Stop the running node first (reuse existing stop logic).
    try {
      const node = daemon.networkNode;
      if (node?.active && node.proc && !node.proc.killed) {
        safeKill(node.proc);
        daemon.networkNode.status = 'stopping';
        pushNodeEvent('stopping', { pid: node.pid, reason: 'uninstall' });
        broadcastNodeStatus();
      }
    } catch { /* ignore */ }

    const installPath = networkRoot();
    if (!isInsideGrooveHome(installPath)) {
      return res.status(500).json({ error: 'Invalid install path' });
    }

    try {
      if (existsSync(installPath)) {
        rmSync(installPath, { recursive: true, force: true });
      }
    } catch (err) {
      return res.status(500).json({ error: `Failed to remove install: ${err.message}` });
    }

    daemon.config.networkBeta = {
      ...(daemon.config.networkBeta || {}),
      installed: false,
      deployPath: null,
      version: null,
    };
    await persistConfig();
    daemon.broadcast({ type: 'config:updated' });
    daemon.audit.log('network.uninstall', { path: installPath });
    res.json({ status: 'uninstalled' });
  });

  // --- Network package update check / update ---

  // 5-minute cache of the latest-tag lookup so startup + GUI polls don't
  // hammer GitHub. Shape: { latest, fetchedAt }. null until first check.
  let networkUpdateCache = null;
  const NETWORK_UPDATE_CACHE_MS = 5 * 60 * 1000;

  // Run `git ls-remote --tags <repo>` and return the highest semver tag.
  // Resolves to null on git errors / network failure; caller decides how to
  // surface that. Uses spawn with array args — no shell interpolation.
  function fetchLatestNetworkTag() {
    return new Promise((resolvePromise) => {
      const tagEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
      const tagPat = daemon.credentials?.getKey?.('github') || daemon.credentials?.getKey?.('github-pat') || null;
      if (tagPat) {
        tagEnv.GIT_CONFIG_COUNT = '1';
        tagEnv.GIT_CONFIG_KEY_0 = 'http.extraHeader';
        tagEnv.GIT_CONFIG_VALUE_0 = `Authorization: token ${tagPat}`;
      }
      const proc = spawn('git', ['ls-remote', '--tags', NETWORK_REPO_URL], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: tagEnv,
      });
      daemon._networkCheckProc = proc;
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (c) => { stdout += c.toString(); });
      proc.stderr.on('data', (c) => { stderr += c.toString(); });
      const timeout = setTimeout(() => { safeKill(proc, 'SIGTERM'); }, 10_000);
      proc.on('error', () => { clearTimeout(timeout); daemon._networkCheckProc = null; resolvePromise(null); });
      proc.on('close', (code) => {
        daemon._networkCheckProc = null;
        clearTimeout(timeout);
        if (code !== 0) return resolvePromise(null);
        const tags = [];
        for (const line of stdout.split('\n')) {
          // Format: <sha>\trefs/tags/v0.1.0 (or .../v0.1.0^{} for annotated)
          const m = line.match(/refs\/tags\/(v?\d+\.\d+\.\d+[^\s^]*)(?:\^\{\})?$/);
          if (m && parseSemver(m[1])) tags.push(m[1]);
        }
        if (tags.length === 0) return resolvePromise(null);
        tags.sort(compareSemver);
        resolvePromise(tags[tags.length - 1]);
      });
    });
  }

  async function getLatestNetworkTag(force = false) {
    if (!force && networkUpdateCache && (Date.now() - networkUpdateCache.fetchedAt) < NETWORK_UPDATE_CACHE_MS) {
      return networkUpdateCache.latest;
    }
    const latest = await fetchLatestNetworkTag();
    if (latest) networkUpdateCache = { latest, fetchedAt: Date.now() };
    return latest;
  }

  app.get('/api/network/update/check', networkGate, async (req, res) => {
    const installed = getInstalledNetworkVersion();
    const force = req.query.force === '1' || req.query.force === 'true';
    const latest = await getLatestNetworkTag(force);
    if (!latest) {
      return res.status(502).json({
        installed,
        latest: null,
        updateAvailable: false,
        error: 'Could not reach github.com to check for updates',
      });
    }
    const updateAvailable = !!installed && compareSemver(latest, installed) > 0;
    res.json({ installed, latest, updateAvailable });
  });

  function broadcastUpdateProgress(step, message, percent) {
    daemon.broadcast({
      type: 'network:update:progress',
      data: { step, message, percent },
    });
  }

  app.post('/api/network/update', networkGate, async (req, res) => {
    if (daemon.networkInstall?.running) {
      return res.status(409).json({ error: 'Install/update already in progress' });
    }
    const installPath = networkRoot();
    const hasInstall = daemon.config?.networkBeta?.installed || existsSync(resolve(installPath, 'setup.sh'));
    if (!hasInstall) {
      return res.status(400).json({ error: 'Network package not installed' });
    }
    if (!existsSync(installPath) || !isInsideGrooveHome(installPath)) {
      return res.status(400).json({ error: 'Install path missing or invalid' });
    }

    const latest = await getLatestNetworkTag(true);
    if (!latest) {
      return res.status(502).json({ error: 'Could not reach github.com to check for updates' });
    }
    const current = getInstalledNetworkVersion();
    if (current && compareSemver(latest, current) <= 0) {
      return res.status(400).json({ error: 'Already at latest version', installed: current, latest });
    }

    daemon.networkInstall = { running: true, startedAt: Date.now(), kind: 'update' };
    res.status(200).json({ status: 'updating', from: current, to: latest });

    (async () => {
      const fail = (message) => {
        broadcastUpdateProgress('error', message, -1);
        daemon.audit.log('network.update.failed', { message, from: current, to: latest });
        daemon.networkInstall = { running: false };
      };

      try {
        // Stop the running node first so we don't update files under its feet.
        try {
          const node = daemon.networkNode;
          if (node?.active && node.proc && !node.proc.killed) {
            safeKill(node.proc);
            daemon.networkNode.status = 'stopping';
            pushNodeEvent('stopping', { pid: node.pid, reason: 'update' });
            broadcastNodeStatus();
            // Small grace window for the process to exit cleanly.
            await new Promise((r) => setTimeout(r, 500));
          }
        } catch { /* ignore */ }

        broadcastUpdateProgress('fetching', `Fetching ${latest}...`, 5);

        const fetchProc = spawn('git', ['-C', installPath, 'fetch', '--tags', '--force'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        let fetchErr = '';
        fetchProc.stderr.on('data', (c) => { fetchErr += c.toString(); });
        const fetchCode = await new Promise((r) => {
          fetchProc.on('error', (e) => r({ code: -1, err: e.message }));
          fetchProc.on('close', (code) => r({ code }));
        });
        if (fetchCode.code !== 0) {
          const hint = fetchErr.trim().split('\n').slice(-1)[0] || 'git fetch failed';
          return fail(`Fetch failed: ${hint}`);
        }

        broadcastUpdateProgress('checkout', `Checking out ${latest}...`, 20);

        const checkoutProc = spawn('git', ['-C', installPath, 'checkout', latest], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        let checkoutErr = '';
        checkoutProc.stderr.on('data', (c) => { checkoutErr += c.toString(); });
        const checkoutCode = await new Promise((r) => {
          checkoutProc.on('error', (e) => r({ code: -1, err: e.message }));
          checkoutProc.on('close', (code) => r({ code }));
        });
        if (checkoutCode.code !== 0) {
          const hint = checkoutErr.trim().split('\n').slice(-1)[0] || 'git checkout failed';
          return fail(`Checkout failed: ${hint}`);
        }

        broadcastUpdateProgress('deps', 'Updating dependencies...', 30);

        let setup;
        try {
          setup = spawnSetupSh(installPath);
        } catch (spawnErr) {
          return fail(`Setup failed: ${spawnErr.message}`);
        }

        daemon.networkInstall.proc = setup;

        let stdoutBuf = '';
        setup.stdout.on('data', (chunk) => {
          stdoutBuf += chunk.toString();
          let idx;
          while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
            const line = stdoutBuf.slice(0, idx).trim();
            stdoutBuf = stdoutBuf.slice(idx + 1);
            if (!line || line[0] !== '{') continue;
            try {
              const event = JSON.parse(line);
              const step = typeof event.step === 'string' ? event.step : 'progress';
              const message = typeof event.message === 'string' ? event.message : '';
              const percent = Number.isFinite(event.percent) ? event.percent : null;
              broadcastUpdateProgress(step, message, percent);
            } catch { /* non-JSON line, ignore */ }
          }
        });

        let stderrBuf = '';
        setup.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });

        const setupResult = await new Promise((r) => {
          setup.on('error', (e) => r({ code: -1, err: e.message }));
          setup.on('close', (code) => r({ code }));
        });

        if (setupResult.code !== 0) {
          let hint;
          if (setupResult.code === -1 || setupResult.err?.includes('ENOENT')) {
            hint = 'bash not found — ensure Git for Windows is installed from https://git-scm.com';
          } else {
            hint = stderrBuf.trim().split('\n').slice(-1)[0] || `setup.sh exited ${setupResult.code}`;
          }
          return fail(`Setup failed: ${hint}`);
        }

        daemon.config.networkBeta = {
          ...(daemon.config.networkBeta || {}),
          version: latest,
        };
        await persistConfig();
        // Invalidate the update cache now that we've moved forward.
        networkUpdateCache = { latest, fetchedAt: Date.now() };
        daemon.networkUpdateAvailable = { latest, updateAvailable: false, installed: latest };
        daemon.broadcast({ type: 'config:updated' });
        daemon.broadcast({ type: 'network:update:available', data: daemon.networkUpdateAvailable });
        broadcastUpdateProgress('done', `Updated to ${latest}`, 100);
        daemon.audit.log('network.update', { from: current, to: latest, path: installPath });
        daemon.networkInstall = { running: false };
      } catch (err) {
        fail(err?.message || 'Update failed');
      }
    })();
  });

  // --- Wallet & earnings stubs (Base L2 — wired to real data post-mainnet) ---

  app.get('/api/network/wallet', networkGate, (req, res) => {
    res.json({ connected: false, address: null, balance: '0.00', token: 'GROOVE', chain: 'base-l2' });
  });

  app.get('/api/network/earnings', networkGate, (req, res) => {
    res.json({ today: 0, thisWeek: 0, allTime: 0, history: [], currency: 'GROOVE' });
  });

  app.post('/api/network/wallet/connect', networkGate, (req, res) => {
    res.status(501).json({ error: 'Wallet connection not yet available. Coming with mainnet launch.' });
  });

  app.get('/api/network/node/identity', networkGate, (req, res) => {
    const node = daemon.networkNode;
    res.json({
      nodeId: node?.nodeId || null,
      address: node?.nodeId || null,
      startedAt: node?.startedAt || null,
      uptime: node?.startedAt ? Math.floor((Date.now() - node.startedAt) / 1000) : 0,
    });
  });

  // Startup hook — called from index.js once the server is up. Non-blocking;
  // updates daemon.networkUpdateAvailable and broadcasts so the GUI can badge.
  daemon.checkNetworkUpdate = async function checkNetworkUpdate() {
    const hasInstall = daemon.config?.networkBeta?.installed || existsSync(resolve(networkRoot(), 'setup.sh'));
    if (!hasInstall) return;
    try {
      const latest = await getLatestNetworkTag(true);
      if (!latest) return;
      const installed = getInstalledNetworkVersion();
      const updateAvailable = !!installed && compareSemver(latest, installed) > 0;
      daemon.networkUpdateAvailable = { installed, latest, updateAvailable };
      daemon.broadcast({ type: 'network:update:available', data: daemon.networkUpdateAvailable });
    } catch { /* non-fatal */ }
  };

}
