// GROOVE — Codex Provider (OpenAI)
// FSL-1.1-Apache-2.0 — see LICENSE

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { Provider } from './base.js';

export class CodexProvider extends Provider {
  static name = 'codex';
  static displayName = 'Codex';
  static command = 'codex';
  static authType = 'api-key';
  static envKey = 'OPENAI_API_KEY';
  // Auth hint — Codex uses its own auth system, not just env vars
  static authHint = 'Codex requires `codex login` — run: echo "YOUR_KEY" | codex login --with-api-key';
  static models = [
    { id: 'gpt-5.4-pro', name: 'GPT-5.4 Pro', tier: 'heavy', pricing: { input: 0.015, output: 0.06 } },
    { id: 'gpt-5.4', name: 'GPT-5.4', tier: 'heavy', pricing: { input: 0.005, output: 0.02 } },
    { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', tier: 'medium', pricing: { input: 0.001, output: 0.004 } },
    { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano', tier: 'light', pricing: { input: 0.0004, output: 0.0016 } },
    { id: 'gpt-5-mini', name: 'GPT-5 Mini', tier: 'medium', pricing: { input: 0.0005, output: 0.002 } },
    { id: 'gpt-5-nano', name: 'GPT-5 Nano', tier: 'light', pricing: { input: 0.0001, output: 0.0004 } },
  ];

  static isInstalled() {
    try {
      execSync('which codex', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  static installCommand() {
    return 'npm i -g @openai/codex';
  }

  /**
   * Check if Codex has valid authentication.
   * Codex uses its own auth at ~/.codex/auth.json (NOT just OPENAI_API_KEY env var).
   * Users must run: codex login (ChatGPT) or: echo "key" | codex login --with-api-key
   */
  /**
   * Auto-login to Codex CLI when user saves an API key in GROOVE.
   * Pipes the key to `codex login --with-api-key` so users don't need
   * to know about Codex's separate auth system.
   */
  static async onKeySet(key) {
    if (!CodexProvider.isInstalled()) return { ok: false, error: 'Codex not installed' };
    return new Promise((res) => {
      const proc = spawn('codex', ['login', '--with-api-key'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15000,
      });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.stdin.write(key);
      proc.stdin.end();
      proc.on('exit', (code) => {
        res(code === 0
          ? { ok: true, message: 'Codex authenticated via API key' }
          : { ok: false, error: stderr.slice(-200) || `codex login failed (exit ${code})` });
      });
      proc.on('error', (err) => res({ ok: false, error: err.message }));
      setTimeout(() => { try { proc.kill(); } catch {} res({ ok: false, error: 'Timeout' }); }, 15000);
    });
  }

  static isAuthenticated() {
    const authPath = resolve(homedir(), '.codex', 'auth.json');
    if (!existsSync(authPath)) return { authenticated: false, reason: 'No auth found. Run: codex login' };
    try {
      const auth = JSON.parse(readFileSync(authPath, 'utf8'));
      if (auth.auth_mode === 'chatgpt' && auth.tokens?.id_token) return { authenticated: true, method: 'chatgpt' };
      if (auth.auth_mode === 'api-key' && auth.OPENAI_API_KEY) return { authenticated: true, method: 'api-key' };
      if (auth.OPENAI_API_KEY) return { authenticated: true, method: 'api-key' };
      return { authenticated: false, reason: 'Auth expired or missing. Run: codex login' };
    } catch {
      return { authenticated: false, reason: 'Auth file corrupted. Run: codex login' };
    }
  }

  buildSpawnCommand(agent) {
    // Use 'codex exec' for non-interactive (headless) operation
    const args = ['exec'];

    if (agent.model) args.push('--model', agent.model);

    // Full autonomous operation — no approval prompts, no sandbox
    args.push('--dangerously-bypass-approvals-and-sandbox');

    if (agent.prompt) args.push(agent.prompt);

    return {
      command: 'codex',
      args,
      env: agent.apiKey ? { OPENAI_API_KEY: agent.apiKey } : {},
    };
  }

  buildHeadlessCommand(prompt, model) {
    const args = ['exec', prompt];
    if (model) args.push('--model', model);
    return { command: 'codex', args, env: {} };
  }

  switchModel(agent, newModel) {
    return false; // Codex doesn't support mid-session model switch
  }

  static estimateCost(tokens, modelId) {
    const model = CodexProvider.models.find((m) => m.id === modelId);
    if (!model?.pricing) return 0;
    // Rough 3:1 input:output ratio estimate
    const inputTokens = Math.round(tokens * 0.75);
    const outputTokens = tokens - inputTokens;
    return (inputTokens / 1000) * model.pricing.input + (outputTokens / 1000) * model.pricing.output;
  }

  parseOutput(line) {
    // Codex outputs plain text and stderr logging
    const trimmed = line.trim();
    if (!trimmed) return null;

    // Try to parse JSON (codex may output structured data in some modes)
    try {
      const data = JSON.parse(trimmed);
      if (data.usage?.total_tokens) {
        const tokens = data.usage.total_tokens;
        return {
          type: 'activity', data: trimmed, tokensUsed: tokens,
          estimatedCostUsd: CodexProvider.estimateCost(tokens, data.model),
          costSource: 'estimated',
        };
      }
    } catch { /* plain text */ }

    // Estimate tokens from text length (~4 chars per token)
    // Not perfect but gives visibility into activity and burn rate
    const estimatedTokens = Math.ceil(trimmed.length / 4);

    return {
      type: 'activity',
      data: trimmed,
      tokensUsed: estimatedTokens,
      estimatedCostUsd: 0, // Can't estimate without knowing the model here
      costSource: 'estimated',
    };
  }
}
