// GROOVE — Codex Provider (OpenAI)
// FSL-1.1-Apache-2.0 — see LICENSE

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { Provider } from './base.js';

async function parseSSEStream(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') { onEvent({ done: true }); return; }
        try { onEvent(JSON.parse(data)); } catch { /* skip malformed */ }
      }
    }
  }
}

export class CodexProvider extends Provider {
  static name = 'codex';
  static displayName = 'Codex';
  static command = 'codex';
  static authType = 'api-key';
  static envKey = 'OPENAI_API_KEY';
  // Auth hint — Codex uses its own auth system, not just env vars
  static authHint = 'Codex requires `codex login` — run: echo "YOUR_KEY" | codex login --with-api-key';
  static models = [
    { id: 'gpt-5.5', name: 'GPT-5.5', tier: 'heavy', maxContext: 1000000, pricing: { input: 0.03, output: 0.12 } },
    { id: 'gpt-5.4-pro', name: 'GPT-5.4 Pro', tier: 'heavy', maxContext: 1000000, pricing: { input: 0.015, output: 0.06 } },
    { id: 'gpt-5.4', name: 'GPT-5.4', tier: 'heavy', maxContext: 1000000, pricing: { input: 0.005, output: 0.02 } },
    { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', tier: 'medium', maxContext: 1000000, pricing: { input: 0.001, output: 0.004 } },
    { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano', tier: 'light', maxContext: 1000000, pricing: { input: 0.0004, output: 0.0016 } },
    { id: 'gpt-5-mini', name: 'GPT-5 Mini', tier: 'medium', maxContext: 1000000, pricing: { input: 0.0005, output: 0.002 } },
    { id: 'gpt-5-nano', name: 'GPT-5 Nano', tier: 'light', maxContext: 1000000, pricing: { input: 0.0001, output: 0.0004 } },
    { id: 'gpt-image-2', name: 'GPT Image 2', tier: 'medium', type: 'image', pricing: { perImage: 0.07 } },
    { id: 'gpt-image-1', name: 'GPT Image 1', tier: 'medium', type: 'image', pricing: { perImage: 0.02 } },
  ];

  static isInstalled() {
    try {
      const cmd = process.platform === 'win32' ? 'where codex' : 'bash -lc "which codex"';
      execSync(cmd, { stdio: 'ignore' });
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
        shell: true,
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

  normalizeConfig(config) {
    if (typeof config.reasoningEffort === 'number') {
      config.reasoningEffort = config.reasoningEffort <= 33 ? 'low' : config.reasoningEffort <= 66 ? 'medium' : 'high';
    }
    if (typeof config.verbosity === 'number') {
      config.verbosity = config.verbosity <= 33 ? 'low' : config.verbosity <= 66 ? 'medium' : 'high';
    }
    return config;
  }

  buildSpawnCommand(agent) {
    const args = ['exec'];

    if (agent.model) args.push('--model', agent.model);
    if (agent.reasoningEffort) args.push('--reasoning-effort', agent.reasoningEffort);

    args.push('--json');
    args.push('--dangerously-bypass-approvals-and-sandbox');

    if (agent.workingDir) args.push('-C', agent.workingDir);

    const fullPrompt = this.buildFullPrompt(agent);

    this._currentModel = agent.model;
    this._sessionInputTokens = 0;
    this._initialPromptTokens = Math.ceil((fullPrompt || '').length / 4);
    this._accumulatedOutputTokens = 0;

    // Pipe prompt via stdin to avoid ARG_MAX with large introContext
    return {
      command: 'codex',
      args,
      env: agent.apiKey ? { OPENAI_API_KEY: agent.apiKey } : {},
      stdin: fullPrompt || undefined,
    };
  }

  buildFullPrompt(agent) {
    const parts = [];
    if (agent.introContext) parts.push(agent.introContext);
    if (agent.prompt) parts.push(`## Your Task\n\n${agent.prompt}`);
    if (agent.scope && agent.scope.length > 0) {
      parts.push(
        `## Scope Rules\n\nYou MUST only modify files matching these patterns: ${agent.scope.join(', ')}. ` +
        `Do not touch files outside your scope — other agents own them.`
      );
    }
    return parts.join('\n\n');
  }

  buildHeadlessCommand(prompt, model) {
    const args = ['exec', '--json', prompt];
    if (model) args.push('--model', model);
    return { command: 'codex', args, env: {} };
  }

  _getMaxContext() {
    const model = CodexProvider.models.find((m) => m.id === this._currentModel);
    return model?.maxContext || 200000;
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

  streamChat(messages, model, apiKey, onChunk, onDone, onError, { reasoningEffort, verbosity, previousResponseId } = {}) {
    if (!apiKey) return null;
    const controller = new AbortController();
    let finished = false;
    let responseId = null;
    const finish = () => { if (!finished) { finished = true; onDone({ responseId }); } };

    const effort = reasoningEffort || 'medium';
    const verb = verbosity || 'medium';
    const body = {
      model,
      input: previousResponseId ? [messages[messages.length - 1]] : messages,
      stream: true,
      reasoning: { effort },
      text: { format: { type: 'text' }, verbosity: verb },
    };
    if (previousResponseId) body.previous_response_id = previousResponseId;

    fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).then((res) => {
      if (!res.ok) {
        return res.text().then((t) => { throw new Error(`OpenAI API ${res.status}: ${t.slice(0, 200)}`); });
      }
      return parseSSEStream(res, (event) => {
        if (event.done) { finish(); return; }
        if (event.type === 'response.output_text.delta') {
          if (event.delta) onChunk(event.delta);
        } else if (event.type === 'response.completed') {
          responseId = event.response?.id || null;
        }
      });
    }).then(() => {
      finish();
    }).catch((err) => {
      if (err.name === 'AbortError') return;
      onError(err);
    });
    return controller;
  }

  async generateImage(prompt, options = {}) {
    const apiKey = options.apiKey;
    if (!apiKey) throw new Error('OPENAI_API_KEY required for image generation');

    const body = {
      model: options.model || 'gpt-image-1',
      prompt,
      n: 1,
    };
    if (options.size) body.size = options.size;
    if (options.quality) body.quality = options.quality;

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI Image API ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const image = data.data?.[0];
    return {
      url: image?.url || null,
      b64_json: image?.b64_json || null,
      model: body.model,
      provider: 'codex',
    };
  }

  parseOutput(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return null;
    }

    switch (event.type) {
      case 'thread.started':
        return { type: 'activity', subtype: 'assistant', sessionId: event.thread_id, data: [{ type: 'text', text: '' }] };

      case 'turn.started':
        return null;

      case 'item.started': {
        const item = event.item || {};
        if (item.type === 'command_execution') {
          return {
            type: 'activity', subtype: 'assistant',
            data: [{ type: 'tool_use', id: item.id || 'exec', name: 'Bash', input: { command: item.command } }],
          };
        }
        if (item.type === 'todo_list') {
          const steps = (item.items || []).map((s) => s.text).join(', ');
          return {
            type: 'activity', subtype: 'assistant',
            data: [{ type: 'tool_use', id: item.id || 'plan', name: 'Plan', input: { steps } }],
          };
        }
        if (item.type === 'file_edit' || item.type === 'file_write') {
          return {
            type: 'activity', subtype: 'assistant',
            data: [{ type: 'tool_use', id: item.id || 'edit', name: item.type === 'file_write' ? 'Write' : 'Edit', input: { path: item.path || item.file || '' } }],
          };
        }
        if (item.type === 'file_read') {
          return {
            type: 'activity', subtype: 'assistant',
            data: [{ type: 'tool_use', id: item.id || 'read', name: 'Read', input: { path: item.path || item.file || '' } }],
          };
        }
        return {
          type: 'activity', subtype: 'assistant',
          data: [{ type: 'tool_use', id: item.id || 'tool', name: item.type || 'Tool', input: {} }],
        };
      }

      case 'item.completed': {
        const item = event.item || {};

        // Accumulate usage for intermediate context estimation.
        // Codex only reports full contextUsage at turn.completed — without this,
        // the rotator sees stale contextUsage between turns and never triggers.
        if (event.usage) {
          this._sessionInputTokens += event.usage.input_tokens || 0;
        }

        if (item.type === 'command_execution') {
          this._accumulatedOutputTokens += Math.ceil((item.aggregated_output || '').length / 4);
        } else if (item.type === 'agent_message') {
          this._accumulatedOutputTokens += Math.ceil((item.text || '').length / 4);
        } else if (item.type === 'file_read') {
          this._accumulatedOutputTokens += Math.ceil((item.content || item.text || item.aggregated_output || '').length / 4);
        } else if (item.type === 'file_write' || item.type === 'file_edit') {
          this._accumulatedOutputTokens += Math.ceil((item.content || '').length / 4);
        } else if (item.type === 'reasoning') {
          this._accumulatedOutputTokens += Math.ceil((item.text || '').length / 4);
        }

        let result = null;
        if (item.type === 'agent_message') {
          result = {
            type: 'activity', subtype: 'assistant',
            data: [{ type: 'text', text: item.text || '' }],
          };
        } else if (item.type === 'command_execution') {
          const output = (item.aggregated_output || '').slice(0, 2000);
          result = {
            type: 'activity', subtype: 'assistant',
            data: [
              { type: 'tool_use', id: item.id || 'exec', name: 'Bash', input: { command: item.command }, ...(output && { result: output }) },
            ],
          };
        } else if (item.type === 'todo_list') {
          const steps = (item.items || []).map((s) => `${s.completed ? '✓' : '○'} ${s.text}`).join('\n');
          result = {
            type: 'activity', subtype: 'assistant',
            data: [{ type: 'tool_use', id: item.id || 'plan', name: 'Plan', input: { steps }, result: steps }],
          };
        } else if (item.type === 'file_edit' || item.type === 'file_write' || item.type === 'file_read') {
          const fileContent = item.type === 'file_read' ? (item.content || item.text || item.aggregated_output || '').slice(0, 2000) : undefined;
          result = {
            type: 'activity', subtype: 'assistant',
            data: [{ type: 'tool_use', id: item.id || 'file', name: item.type === 'file_read' ? 'Read' : item.type === 'file_write' ? 'Write' : 'Edit', input: { path: item.path || item.file || '' }, ...(fileContent && { result: fileContent }) }],
          };
        }

        if (result && item.phase !== undefined) {
          result.phase = item.phase;
        }

        // Attach intermediate context estimate so all 7 layers see Codex progress
        if (result) {
          const estimatedContext = this._sessionInputTokens > 0
            ? this._sessionInputTokens
            : this._initialPromptTokens + this._accumulatedOutputTokens * 2;
          if (estimatedContext > 0) {
            result.contextUsage = estimatedContext / this._getMaxContext();
          }
        }

        return result;
      }

      case 'turn.completed': {
        const usage = event.usage;
        if (!usage) return null;

        const inputTokens = usage.input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;
        const cachedTokens = usage.cached_input_tokens || 0;
        const reasoningTokens = usage.output_tokens_details?.reasoning_tokens || 0;
        // OpenAI includes cached tokens IN input_tokens; Anthropic does not.
        // Subtract cached to get new-processing-only count, matching Claude's convention.
        const newInputTokens = Math.max(0, inputTokens - cachedTokens);
        const totalTokens = newInputTokens + outputTokens;
        const cacheCreationTokens = cachedTokens > 0 ? newInputTokens : 0;

        const model = CodexProvider.models.find((m) => m.id === this._currentModel);
        const pricing = model?.pricing;
        const maxContext = model?.maxContext || 200000;

        // Sync accumulator to actual cumulative value from turn completion
        this._sessionInputTokens = inputTokens;

        let estimatedCostUsd = 0;
        if (pricing) {
          const newInput = inputTokens - cachedTokens;
          estimatedCostUsd = (newInput / 1000) * pricing.input
            + (cachedTokens / 1000) * pricing.input * 0.5
            + (outputTokens / 1000) * pricing.output;
        }

        return {
          type: 'activity', subtype: 'assistant',
          data: [{ type: 'text', text: '' }],
          tokensUsed: totalTokens,
          inputTokens,
          outputTokens,
          reasoningTokens,
          cacheReadTokens: cachedTokens,
          cacheCreationTokens,
          contextUsage: inputTokens / maxContext,
          estimatedCostUsd,
          costSource: pricing ? 'calculated' : 'estimated',
        };
      }

      default:
        return null;
    }
  }

  static setupGuide() {
    return {
      installSteps: ['Installing Codex CLI...', 'This may take a minute'],
      authMethods: ['api-key', 'chatgpt-plus'],
      authInstructions: {
        apiKeyHelp: 'Get your API key from platform.openai.com/api-keys',
        chatgptPlusHelp: 'Sign in with your ChatGPT Plus account',
      },
    };
  }

  static authMethods() {
    return ['api-key', 'chatgpt-plus'];
  }
}
