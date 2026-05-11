// FSL-1.1-Apache-2.0 — see LICENSE
import { resolve } from 'path';
import { existsSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'fs';
import { spawn, execFileSync } from 'child_process';
import { homedir } from 'os';
import { isAbsolute } from 'path';
import { listProviders, getProvider, clearInstallCache, getProviderMetadata, getProviderPath, setProviderPaths } from '../providers/index.js';
import { OllamaProvider } from '../providers/ollama.js';
import { ClaudeCodeProvider } from '../providers/claude-code.js';

export function registerProviderRoutes(app, daemon) {

  // List available providers
  app.get('/api/providers', (req, res) => {
    const providers = listProviders();
    for (const p of providers) {
      p.hasKey = daemon.credentials.hasKey(p.id);
      if (p.id === 'claude-code') {
        p.authStatus = ClaudeCodeProvider.getAuthStatus();
      }
      const meta = getProviderMetadata(p.id);
      if (meta) {
        p.setupGuide = meta.setupGuide;
        p.authMethods = meta.authMethods;
      }
      const customPath = getProviderPath(p.id);
      if (customPath) p.providerPath = customPath;

      // Enrich local provider with GGUF models + lab runtime status
      if (p.id === 'local' && daemon.modelManager && daemon.modelLab) {
        const ollamaModels = p.models || [];
        const ollamaIds = new Set(ollamaModels.map(m => m.id));
        const runtimes = daemon.modelLab.listRuntimes();
        const ggufModels = daemon.modelManager.getInstalled()
          .filter(m => m.exists)
          .map(m => {
            const rt = runtimes.find(r =>
              r._localModelId === m.id ||
              r.models?.some(rm => rm.id === m.filename || rm.name === m.filename)
            );
            return {
              id: `gguf:${m.id}`,
              name: m.filename.replace(/\.gguf$/i, ''),
              tier: m.tier || 'medium',
              category: m.category || 'general',
              source: 'gguf',
              sizeBytes: m.sizeBytes || null,
              quantization: m.quantization || null,
              parameters: m.parameters || null,
              runtimeId: rt?.id || null,
              runtimeEndpoint: rt?.endpoint || null,
              runtimeType: rt?.type || null,
              hasRuntime: !!rt,
            };
          });
        // Also surface models from lab runtimes not backed by a local GGUF
        const runtimeModels = [];
        for (const rt of runtimes) {
          if (rt.type === 'ollama') continue;
          for (const rm of (rt.models || [])) {
            const alreadyGguf = ggufModels.some(g => g.runtimeId === rt.id);
            const alreadyOllama = ollamaIds.has(rm.id) || ollamaIds.has(rm.name);
            if (!alreadyGguf && !alreadyOllama) {
              runtimeModels.push({
                id: `runtime:${rt.id}:${rm.id}`,
                name: rm.name || rm.id,
                tier: 'medium',
                category: 'general',
                source: 'runtime',
                runtimeId: rt.id,
                runtimeEndpoint: rt.endpoint,
                runtimeType: rt.type,
                hasRuntime: true,
              });
            }
          }
        }
        p.models = [...ollamaModels.map(m => ({ ...m, source: 'ollama', hasRuntime: true })), ...ggufModels, ...runtimeModels];
        p.installed = p.installed || ggufModels.length > 0 || runtimeModels.length > 0;
      }
    }
    res.json(providers);
  });

  // --- Claude Code Auth ---

  app.get('/api/providers/claude-code/auth', (req, res) => {
    res.json(ClaudeCodeProvider.getAuthStatus());
  });

  app.post('/api/providers/claude-code/login', (req, res) => {
    ClaudeCodeProvider.triggerLogin();
    daemon.audit.log('claude-code.login.started', {});
    res.json({ ok: true });
  });

  // --- Ollama ---

  const isValidModelId = (id) => typeof id === 'string' && id.length > 0 && id.length < 200 && /^[a-zA-Z0-9._:/-]+$/.test(id);

  app.get('/api/providers/ollama/hardware', (req, res) => {
    res.json(OllamaProvider.getSystemHardware());
  });

  app.get('/api/providers/ollama/models', (req, res) => {
    const installed = OllamaProvider.isInstalled() ? OllamaProvider.getInstalledModels() : [];
    const catalog = OllamaProvider.catalog;
    const hardware = OllamaProvider.getSystemHardware();
    res.json({ installed, catalog, hardware });
  });

  app.post('/api/providers/ollama/pull', async (req, res) => {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'model is required' });
    if (!isValidModelId(model)) return res.status(400).json({ error: 'Invalid model ID' });
    if (!OllamaProvider.isInstalled()) {
      const install = OllamaProvider.installCommand();
      return res.status(400).json({ error: `Ollama is not installed. Install with: ${install.command}` });
    }
    const broadcast = daemon.broadcast.bind(daemon);
    try {
      // Auto-start Ollama server if not running
      const running = await OllamaProvider.isServerRunning();
      if (!running) {
        broadcast({ type: 'ollama:serve:starting' });
        OllamaProvider.startServer();
        // Wait for server to be ready (up to 10s)
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 500));
          if (await OllamaProvider.isServerRunning()) break;
        }
        if (!(await OllamaProvider.isServerRunning())) {
          return res.status(500).json({ error: 'Could not start Ollama server. Run `ollama serve` manually.' });
        }
      }
      broadcast({ type: 'ollama:pull:start', model });
      await OllamaProvider.pullModel(model, (progress) => {
        broadcast({ type: 'ollama:pull:progress', model, progress: progress.trim() });
      });
      broadcast({ type: 'ollama:pull:complete', model });
      daemon.audit.log('ollama.pull', { model });
      res.json({ ok: true, model });
    } catch (err) {
      broadcast({ type: 'ollama:pull:error', model, error: err.message });
      res.status(500).json({ error: `Pull failed: ${err.message}` });
    }
  });

  app.delete('/api/providers/ollama/models/:model', (req, res) => {
    if (!isValidModelId(req.params.model)) return res.status(400).json({ error: 'Invalid model ID' });
    if (!OllamaProvider.isInstalled()) return res.status(400).json({ error: 'Ollama is not installed' });
    const success = OllamaProvider.deleteModel(req.params.model);
    if (success) {
      daemon.audit.log('ollama.delete', { model: req.params.model });
      res.json({ ok: true });
    } else {
      res.status(500).json({ error: 'Failed to delete model' });
    }
  });

  app.post('/api/providers/ollama/check', async (req, res) => {
    const installed = OllamaProvider.isInstalled();
    const serverRunning = installed ? await OllamaProvider.isServerRunning() : false;
    const install = OllamaProvider.installCommand();
    const hardware = OllamaProvider.getSystemHardware();
    const requirements = OllamaProvider.hardwareRequirements();
    res.json({ installed, serverRunning, install, hardware, requirements });
  });

  app.post('/api/providers/ollama/serve', async (req, res) => {
    if (!OllamaProvider.isInstalled()) return res.status(400).json({ error: 'Ollama is not installed' });
    const already = await OllamaProvider.isServerRunning();
    if (already) return res.json({ ok: true, alreadyRunning: true });
    const result = OllamaProvider.startServer();
    if (result.started) {
      // Wait a moment for server to come up
      await new Promise((r) => setTimeout(r, 2000));
      const running = await OllamaProvider.isServerRunning();
      res.json({ ok: running, method: result.method });
    } else {
      res.status(500).json({ error: 'Could not start server', command: result.command });
    }
  });

  app.post('/api/providers/ollama/stop', async (req, res) => {
    if (!OllamaProvider.isInstalled()) return res.status(400).json({ error: 'Ollama is not installed' });
    const running = await OllamaProvider.isServerRunning();
    if (!running) return res.json({ ok: true, alreadyStopped: true });
    const result = OllamaProvider.stopServer();
    await new Promise((r) => setTimeout(r, 1000));
    const stillRunning = await OllamaProvider.isServerRunning();
    res.json({ ok: !stillRunning, method: result.method });
  });

  app.post('/api/providers/ollama/restart', async (req, res) => {
    if (!OllamaProvider.isInstalled()) return res.status(400).json({ error: 'Ollama is not installed' });
    // Stop
    const running = await OllamaProvider.isServerRunning();
    if (running) {
      OllamaProvider.stopServer();
      await new Promise((r) => setTimeout(r, 1500));
    }
    // Start
    const result = OllamaProvider.startServer();
    if (result.started) {
      await new Promise((r) => setTimeout(r, 2000));
      const nowRunning = await OllamaProvider.isServerRunning();
      res.json({ ok: nowRunning, method: result.method });
    } else {
      res.status(500).json({ error: 'Could not restart server' });
    }
  });

  app.get('/api/providers/ollama/running', async (req, res) => {
    if (!OllamaProvider.isInstalled()) return res.json({ models: [] });
    const serverRunning = await OllamaProvider.isServerRunning();
    if (!serverRunning) return res.json({ models: [] });
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const apiRes = await fetch('http://localhost:11434/api/ps', { signal: controller.signal });
      clearTimeout(timeout);
      if (!apiRes.ok) return res.json({ models: [] });
      const data = await apiRes.json();
      const models = (data.models || []).map((m) => ({
        name: m.name || m.model || '',
        size: m.size || 0,
        vram: m.size_vram ?? m.size ?? 0,
        expires: m.expires_at || null,
      }));
      res.json({ models });
    } catch {
      res.json({ models: OllamaProvider.getRunningModels() });
    }
  });

  app.post('/api/providers/ollama/load', async (req, res) => {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'model is required' });
    if (!isValidModelId(model)) return res.status(400).json({ error: 'Invalid model ID' });
    if (!OllamaProvider.isInstalled()) return res.status(400).json({ error: 'Ollama is not installed' });
    const serverRunning = await OllamaProvider.isServerRunning();
    if (!serverRunning) return res.status(400).json({ error: 'Ollama server is not running' });
    try {
      await OllamaProvider.loadModel(model);
      daemon.broadcast({ type: 'ollama:model:loaded', model });
      daemon.audit.log('ollama.model.load', { model });
      res.json({ ok: true, model });
    } catch (err) {
      daemon.broadcast({ type: 'model:error', model, error: err.message });
      res.status(500).json({ error: `Failed to load model: ${err.message}` });
    }
  });

  app.post('/api/providers/ollama/unload', async (req, res) => {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'model is required' });
    if (!isValidModelId(model)) return res.status(400).json({ error: 'Invalid model ID' });
    if (!OllamaProvider.isInstalled()) return res.status(400).json({ error: 'Ollama is not installed' });
    const serverRunning = await OllamaProvider.isServerRunning();
    if (!serverRunning) return res.status(400).json({ error: 'Ollama server is not running' });
    try {
      await OllamaProvider.unloadModel(model);
      daemon.broadcast({ type: 'ollama:model:unloaded', model });
      daemon.audit.log('ollama.model.unload', { model });
      res.json({ ok: true });
    } catch (err) {
      daemon.broadcast({ type: 'model:error', model, error: err.message });
      res.status(500).json({ error: `Failed to unload model: ${err.message}` });
    }
  });

  // --- Provider Management (install, login, set-path, verify) ---

  const MANAGEABLE_PROVIDERS = new Set(['claude-code', 'codex', 'gemini']);

  app.post('/api/providers/:id/install', (req, res) => {
    const { id } = req.params;
    if (!MANAGEABLE_PROVIDERS.has(id)) {
      return res.status(400).json({ error: `Invalid provider. Valid: ${[...MANAGEABLE_PROVIDERS].join(', ')}` });
    }

    const INSTALL_PACKAGES = {
      'claude-code': '@anthropic-ai/claude-code',
      'codex': '@openai/codex',
      'gemini': '@google/gemini-cli',
    };
    const pkg = INSTALL_PACKAGES[id];

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
      clearInstallCache();
      const providerObj = getProvider(id);
      const installed = providerObj ? providerObj.constructor.isInstalled() : false;

      if (code === 0 && installed) {
        write({ status: 'complete', output: `${pkg} installed successfully`, progress: 100, installed: true });
        daemon.audit.log('provider.install', { provider: id, pkg, success: true });
        daemon.broadcast({ type: 'provider:status-changed', provider: id });
      } else {
        const reason = code !== 0
          ? (errOutput || output).slice(-500)
          : 'Install succeeded but provider binary not found in PATH';
        write({ status: 'error', output: reason, progress: 100, installed: false });
        daemon.audit.log('provider.install', { provider: id, pkg, success: false, code });
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

  app.post('/api/providers/:id/login', async (req, res) => {
    const { id } = req.params;
    if (!MANAGEABLE_PROVIDERS.has(id)) {
      return res.status(400).json({ error: `Invalid provider. Valid: ${[...MANAGEABLE_PROVIDERS].join(', ')}` });
    }

    if (id === 'gemini') {
      return res.json({ status: 'not-supported', message: 'Gemini uses API key authentication. Set your key in Settings.' });
    }

    if (id === 'claude-code') {
      const providerObj = getProvider(id);
      if (!providerObj || !providerObj.constructor.isInstalled()) {
        return res.status(400).json({ error: 'Claude Code is not installed. Install it first.' });
      }
      daemon.audit.log('provider.login.started', { provider: id });
      try {
        const result = await ClaudeCodeProvider.startLogin();
        clearInstallCache();
        daemon.broadcast({ type: 'provider:status-changed', provider: id });
        return res.json(result);
      } catch (err) {
        return res.status(500).json({ status: 'error', error: err.message });
      }
    }

    if (id === 'codex') {
      const providerObj = getProvider(id);
      if (!providerObj || !providerObj.constructor.isInstalled()) {
        return res.status(400).json({ error: 'Codex is not installed. Install it first.' });
      }

      const { method, key } = req.body || {};

      if (key) {
        daemon.audit.log('provider.login.started', { provider: id, method: 'api-key' });
        try {
          const result = await providerObj.constructor.onKeySet(key);
          clearInstallCache();
          daemon.broadcast({ type: 'provider:status-changed', provider: id });
          return res.json({ status: result.ok ? 'authenticated' : 'error', ...result });
        } catch (err) {
          return res.status(500).json({ status: 'error', error: err.message });
        }
      }

      if (method === 'chatgpt-plus') {
        daemon.audit.log('provider.login.started', { provider: id, method: 'chatgpt-plus' });
        return new Promise((resolve) => {
          let responded = false;
          const respond = (data, status) => {
            if (responded) return;
            responded = true;
            clearInstallCache();
            daemon.broadcast({ type: 'provider:status-changed', provider: id });
            if (status) res.status(status).json(data);
            else res.json(data);
            resolve();
          };

          const proc = spawn('codex', ['login'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true,
          });
          proc.stdin.on('error', () => {});
          let stdout = '';
          let stderr = '';
          proc.stdout.on('data', (d) => { stdout += d.toString(); });
          proc.stderr.on('data', (d) => { stderr += d.toString(); });

          const timeout = setTimeout(() => {
            const urlMatch = (stdout + stderr).match(/https:\/\/\S+/);
            respond(urlMatch
              ? { status: 'pending', url: urlMatch[0], browserOpened: true }
              : { status: 'pending', message: 'Login started — check your browser', browserOpened: true });
          }, 5000);

          proc.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) {
              let hasKey = false;
              try {
                const authPath = resolve(homedir(), '.codex', 'auth.json');
                if (existsSync(authPath)) {
                  const auth = JSON.parse(readFileSync(authPath, 'utf8'));
                  const token = auth.OPENAI_API_KEY
                    || (auth.auth_mode === 'chatgpt' && auth.tokens?.id_token)
                    || null;
                  if (token) {
                    daemon.credentials.setKey('codex', token);
                    hasKey = true;
                  }
                }
              } catch { /* auth.json missing or malformed — login still succeeded */ }
              respond({ status: 'authenticated', hasKey });
            } else {
              respond({ status: 'error', error: stderr.slice(-200) || `Login failed (exit ${code})` });
            }
          });

          proc.on('error', (err) => {
            clearTimeout(timeout);
            respond({ status: 'error', error: err.message }, 500);
          });
        });
      }

      return res.status(400).json({ error: 'Provide either { key: "..." } or { method: "chatgpt-plus" }' });
    }
  });

  app.post('/api/providers/:id/set-path', async (req, res) => {
    const { id } = req.params;
    if (!MANAGEABLE_PROVIDERS.has(id)) {
      return res.status(400).json({ error: `Invalid provider. Valid: ${[...MANAGEABLE_PROVIDERS].join(', ')}` });
    }

    const { path: customPath } = req.body || {};
    if (!customPath || typeof customPath !== 'string') {
      return res.status(400).json({ error: 'path is required' });
    }
    if (customPath.length > 500) {
      return res.status(400).json({ error: 'Path too long' });
    }
    if (!isAbsolute(customPath)) {
      return res.status(400).json({ error: 'Path must be absolute' });
    }

    if (!existsSync(customPath)) {
      return res.status(400).json({ error: `Path does not exist: ${customPath}` });
    }

    try {
      const stat = statSync(customPath);
      if (!stat.isFile()) {
        return res.status(400).json({ error: 'Path must point to a file, not a directory' });
      }
      const mode = stat.mode;
      const isExecutable = !!(mode & 0o111);
      if (!isExecutable) {
        return res.status(400).json({ error: 'File is not executable' });
      }
    } catch (err) {
      return res.status(400).json({ error: `Cannot stat path: ${err.message}` });
    }

    if (!daemon.config.providerPaths) daemon.config.providerPaths = {};
    daemon.config.providerPaths[id] = customPath;

    const { saveConfig } = await import('../firstrun.js');
    saveConfig(daemon.grooveDir, daemon.config);

    setProviderPaths(daemon.config.providerPaths);
    clearInstallCache();

    daemon.audit.log('provider.setPath', { provider: id, path: customPath });
    daemon.broadcast({ type: 'provider:status-changed', provider: id });

    res.json({ ok: true, path: customPath });
  });

  app.post('/api/providers/:id/verify', async (req, res) => {
    const { id } = req.params;
    if (!MANAGEABLE_PROVIDERS.has(id)) {
      return res.status(400).json({ error: `Invalid provider. Valid: ${[...MANAGEABLE_PROVIDERS].join(', ')}` });
    }

    clearInstallCache();
    const providerObj = getProvider(id);
    if (!providerObj) {
      return res.json({ installed: false, authenticated: false, version: null, error: 'Unknown provider' });
    }

    const installed = providerObj.constructor.isInstalled();
    let authenticated = false;
    let version = null;
    let error = null;

    if (installed) {
      const authStatus = providerObj.constructor.isAuthenticated?.();
      authenticated = !!(authStatus?.authenticated);

      const command = providerObj.constructor.command;
      const customPath = getProviderPath(id);
      const bin = customPath || command;

      try {
        version = execFileSync(bin, ['--version'], {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
        }).trim();
      } catch (err) {
        version = null;
        error = `Version check failed: ${err.message?.slice(0, 200) || 'unknown error'}`;
      }
    } else {
      error = 'Provider not installed';
    }

    daemon.broadcast({ type: 'provider:status-changed', provider: id });

    res.json({ installed, authenticated, version, error });
  });

  // --- Local Models (GGUF via HuggingFace) ---

  app.get('/api/models/installed', (req, res) => {
    const installed = daemon.modelManager.getInstalled();
    const llamaStatus = daemon.llamaServer.getStatus();
    res.json({ models: installed, llamaServer: llamaStatus });
  });

  app.get('/api/models/search', async (req, res) => {
    try {
      const query = req.query.q || req.query.query || '';
      if (!query) return res.status(400).json({ error: 'query parameter (q) is required' });
      const results = await daemon.modelManager.search(query, {
        limit: parseInt(req.query.limit) || 20,
      });
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/models/:repoId(*)/files', async (req, res) => {
    try {
      const files = await daemon.modelManager.getModelFiles(req.params.repoId);
      res.json(files);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/models/download', async (req, res) => {
    try {
      const { repoId, filename } = req.body;
      if (!repoId || !filename) return res.status(400).json({ error: 'repoId and filename are required' });
      // Start download in background — progress via WebSocket
      daemon.modelManager.download(repoId, filename).catch(() => {});
      daemon.audit.log('model.download', { repoId, filename });
      res.json({ started: true, filename, repoId });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/models/download/cancel', (req, res) => {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'filename is required' });
    const cancelled = daemon.modelManager.cancelDownload(filename);
    res.json({ cancelled });
  });

  app.get('/api/models/downloads', (req, res) => {
    res.json(daemon.modelManager.getActiveDownloads());
  });

  app.delete('/api/models/:id', (req, res) => {
    const deleted = daemon.modelManager.deleteModel(req.params.id);
    if (deleted) {
      daemon.audit.log('model.delete', { id: req.params.id });
      res.json({ ok: true });
    } else {
      res.status(404).json({ error: 'Model not found' });
    }
  });

  app.post('/api/models/:id/import-to-ollama', async (req, res) => {
    const model = daemon.modelManager.getModel(req.params.id);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    const ggufPath = daemon.modelManager.getModelPath(req.params.id);
    if (!ggufPath) return res.status(404).json({ error: 'Model file not found on disk' });
    if (!OllamaProvider.isInstalled()) return res.status(400).json({ error: 'Ollama is not installed' });

    const ollamaName = (model.id || model.filename.replace('.gguf', '')).toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    const modelfilePath = resolve(ggufPath + '.Modelfile');
    try {
      writeFileSync(modelfilePath, `FROM ${ggufPath}\n`);
      const { execFileSync } = await import('child_process');
      execFileSync('ollama', ['create', ollamaName, '-f', modelfilePath], { timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] });
      try { unlinkSync(modelfilePath); } catch {}
      daemon.audit.log('model.import-ollama', { id: model.id, ollamaName });
      daemon.broadcast({ type: 'ollama:model:imported', model: ollamaName });
      res.json({ ok: true, ollamaName });
    } catch (err) {
      try { unlinkSync(modelfilePath); } catch {}
      res.status(500).json({ error: `Import failed: ${err.message}` });
    }
  });

  app.get('/api/models/recommend', (req, res) => {
    const ramGb = parseInt(req.query.ram) || 16;
    const quant = daemon.modelManager.recommendQuantization('7B', ramGb);
    res.json({ recommendedQuantization: quant, ramGb });
  });

  app.get('/api/models/recommended', (req, res) => {
    const hardware = OllamaProvider.getSystemHardware();
    const catalog = OllamaProvider.catalog;
    // Filter to models that fit in RAM — same threshold as hardware recommendation
    // Apple Silicon unified memory handles these well, no aggressive headroom needed
    const recommended = catalog
      .filter((m) => m.ramGb <= hardware.totalRamGb)
      .sort((a, b) => b.ramGb - a.ramGb) // Biggest that fits = best quality
      .slice(0, 12);
    res.json({ models: recommended, hardware });
  });

  // --- Ollama Running Models ---

  app.get('/api/models/status', async (req, res) => {
    const installed = OllamaProvider.isInstalled();
    if (!installed) return res.json({ serverRunning: false, runningModels: [], installedModels: [], hardware: OllamaProvider.getSystemHardware() });
    const serverRunning = await OllamaProvider.isServerRunning();
    const runningModels = serverRunning ? OllamaProvider.getRunningModels() : [];
    const installedModels = OllamaProvider.getInstalledModels();
    const hardware = OllamaProvider.getSystemHardware();
    res.json({ serverRunning, runningModels, installedModels, hardware });
  });

  app.get('/api/models/running', async (req, res) => {
    if (!OllamaProvider.isInstalled()) return res.json([]);
    const serverRunning = await OllamaProvider.isServerRunning();
    if (!serverRunning) return res.json([]);
    res.json(OllamaProvider.getRunningModels());
  });

  app.post('/api/models/:id/load', async (req, res) => {
    const modelId = req.params.id;
    if (!modelId) return res.status(400).json({ error: 'model id is required' });
    if (!OllamaProvider.isInstalled()) return res.status(400).json({ error: 'Ollama is not installed' });
    const serverRunning = await OllamaProvider.isServerRunning();
    if (!serverRunning) return res.status(400).json({ error: 'Ollama server is not running' });
    try {
      const result = await OllamaProvider.loadModel(modelId);
      daemon.broadcast({ type: 'model:loaded', model: modelId });
      daemon.audit.log('model.load', { model: modelId });
      res.json(result);
    } catch (err) {
      daemon.broadcast({ type: 'model:error', model: modelId, error: err.message });
      res.status(500).json({ error: `Failed to load model: ${err.message}` });
    }
  });

  app.post('/api/models/:id/unload', async (req, res) => {
    const modelId = req.params.id;
    if (!modelId) return res.status(400).json({ error: 'model id is required' });
    if (!OllamaProvider.isInstalled()) return res.status(400).json({ error: 'Ollama is not installed' });
    const serverRunning = await OllamaProvider.isServerRunning();
    if (!serverRunning) return res.status(400).json({ error: 'Ollama server is not running' });
    try {
      const result = await OllamaProvider.unloadModel(modelId);
      daemon.broadcast({ type: 'model:unloaded', model: modelId });
      daemon.audit.log('model.unload', { model: modelId });
      res.json(result);
    } catch (err) {
      daemon.broadcast({ type: 'model:error', model: modelId, error: err.message });
      res.status(500).json({ error: `Failed to unload model: ${err.message}` });
    }
  });

  app.get('/api/llama/status', (req, res) => {
    res.json(daemon.llamaServer.getStatus());
  });

  // --- Credentials ---

  app.get('/api/credentials', (req, res) => {
    res.json(daemon.credentials.listProviders());
  });

  app.post('/api/credentials/:provider', async (req, res) => {
    if (!req.body.key) return res.status(400).json({ error: 'key is required' });
    daemon.credentials.setKey(req.params.provider, req.body.key);
    daemon.audit.log('credential.set', { provider: req.params.provider });

    // Provider-specific auth setup (e.g., Codex auto-login)
    const provider = getProvider(req.params.provider);
    let authResult = null;
    if (provider?.constructor?.onKeySet) {
      try { authResult = await provider.constructor.onKeySet(req.body.key); } catch { /* best effort */ }
    }

    res.json({ ok: true, masked: daemon.credentials.mask(req.body.key), auth: authResult });
  });

  app.delete('/api/credentials/:provider', (req, res) => {
    daemon.credentials.deleteKey(req.params.provider);
    daemon.audit.log('credential.delete', { provider: req.params.provider });
    res.json({ ok: true });
  });

}
