// GROOVE — Claude Code Provider
// FSL-1.1-Apache-2.0 — see LICENSE

import { execSync, spawn as cpSpawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { Provider } from './base.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function parseSSEStream(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let gotDone = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') { onEvent({ done: true }); gotDone = true; return; }
        try { onEvent(JSON.parse(data)); } catch { /* skip malformed */ }
      }
    }
  }
  if (!gotDone) onEvent({ done: true });
}

export class ClaudeCodeProvider extends Provider {
  static name = 'claude-code';
  static displayName = 'Claude Code';
  static command = 'claude';
  static authType = 'subscription';
  static managesOwnContext = true; // Claude Code compacts context internally (~25-37% → 2-8%)
  static models = [
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', tier: 'heavy', contextWindow: 1_000_000 },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', tier: 'medium', contextWindow: 200_000 },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', tier: 'light', contextWindow: 200_000 },
  ];

  static isInstalled() {
    try {
      execSync('which claude', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  static isAuthenticated() {
    const home = homedir();
    const settingsPath = resolve(home, '.claude', 'settings.json');
    if (!existsSync(settingsPath)) return { authenticated: false, reason: 'Claude Code not configured' };
    try {
      execSync('claude --version', { stdio: 'ignore', timeout: 5000 });
      return { authenticated: true, method: 'subscription' };
    } catch {
      return { authenticated: false, reason: 'Claude CLI not responding' };
    }
  }

  static installCommand() {
    return 'npm i -g @anthropic-ai/claude-code';
  }

  buildSpawnCommand(agent) {
    // Claude Code interactive mode:
    //   claude [options] [prompt]
    //
    // GROOVE spawns claude with:
    //   --dangerously-skip-permissions  (autonomous operation)
    //   --output-format stream-json     (structured stdout for parsing)
    //   --verbose                       (richer output for journalist)
    //   --settings {hooks:{PreToolUse:...}}  (knock protocol enforcement)
    //
    // The initial prompt is passed as a positional argument.
    // GROOVE context is injected via an append-only section in CLAUDE.md.

    const args = ['--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];

    const knockSettings = ClaudeCodeProvider._buildKnockSettings();
    if (knockSettings) args.push('--settings', knockSettings);

    if (agent.model) {
      args.push('--model', agent.model);
    }

    if (agent.effort) {
      args.push('--effort', agent.effort);
    }

    // Pass the initial prompt as positional arg (includes GROOVE context)
    const fullPrompt = this.buildFullPrompt(agent);
    if (fullPrompt) {
      args.push(fullPrompt);
    }

    return {
      command: 'claude',
      args,
      env: {},
    };
  }

  buildResumeCommand(sessionId, prompt, model) {
    // Resume a previous session — preserves full conversation history
    // No cold start, no handoff brief needed
    const args = ['--resume', sessionId, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];
    const knockSettings = ClaudeCodeProvider._buildKnockSettings();
    if (knockSettings) args.push('--settings', knockSettings);
    if (model) args.push('--model', model);
    if (prompt) args.push(prompt);
    return { command: 'claude', args, env: {} };
  }

  /**
   * Build the --settings JSON that registers the GROOVE knock hook as a
   * PreToolUse handler. The hook script forwards each Bash/Write/Edit tool
   * call to the daemon, which decides allow/deny based on scope + active
   * locks. Fails open if the daemon is unreachable.
   */
  static _buildKnockSettings() {
    try {
      const hookPath = resolve(__dirname, '..', '..', 'templates', 'knock-hook.cjs');
      if (!existsSync(hookPath)) return null;
      const settings = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash|Write|Edit|NotebookEdit|MultiEdit',
              hooks: [{ type: 'command', command: `node ${hookPath}`, timeout: 5 }],
            },
          ],
        },
      };
      return JSON.stringify(settings);
    } catch {
      return null;
    }
  }

  buildHeadlessCommand(prompt, model) {
    // Pass prompt via stdin to avoid OS argument length limits.
    // Long prompts (journalist synthesis with agent logs) can exceed ARG_MAX.
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (model) args.push('--model', model);
    return { command: 'claude', args, env: {}, stdin: prompt };
  }

  buildFullPrompt(agent) {
    const parts = [];

    // Inject GROOVE context so the agent knows its role and team
    if (agent.introContext) {
      parts.push(agent.introContext);
    }

    // User's actual task prompt
    if (agent.prompt) {
      parts.push(`## Your Task\n\n${agent.prompt}`);
    }

    // Scope awareness
    if (agent.scope && agent.scope.length > 0) {
      parts.push(
        `## Scope Rules\n\nYou MUST only modify files matching these patterns: ${agent.scope.join(', ')}. ` +
        `Do not touch files outside your scope — other agents own them.`
      );
    }

    return parts.join('\n\n');
  }

  switchModel(agent, newModel) {
    // Claude Code supports mid-session model switching
    return true;
  }

  parseOutput(line) {
    // Claude Code stream-json outputs one JSON object per line.
    // Relevant message types:
    //   { type: "assistant", message: {...}, session_id: "..." }
    //   { type: "result", result: "...", session_id: "..." }
    //   { type: "system", message: "..." }
    const lines = line.split('\n').filter(Boolean);
    const events = [];

    for (const l of lines) {
      try {
        const data = JSON.parse(l);

        // Capture session_id for --resume support
        if (data.session_id) {
          events.push({ type: 'session', sessionId: data.session_id });
        }

        if (data.type === 'assistant') {
          const usage = data.message?.usage;
          const inputTokens = usage?.input_tokens || 0;
          const cacheReadTokens = usage?.cache_read_input_tokens || 0;
          const cacheCreationTokens = usage?.cache_creation_input_tokens || 0;
          const outputTokens = usage?.output_tokens || 0;
          // tokensUsed = new processing tokens only (input + output). Cache reads are
          // the same bytes re-read every turn and must NOT be accumulated — doing so
          // inflated agent.tokensUsed ~50× and created the phantom "freeze at 1M".
          // totalIn still drives contextUsage because cached bytes DO occupy context.
          const totalIn = inputTokens + cacheReadTokens + cacheCreationTokens;
          events.push({
            type: 'activity',
            subtype: 'assistant',
            data: data.message?.content || '',
            tokensUsed: inputTokens + outputTokens,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens,
            model: data.message?.model,
          });
          if (totalIn > 0) {
            const modelId = data.message?.model || '';
            const modelMeta = ClaudeCodeProvider.models.find((m) => modelId.includes(m.id));
            const contextWindow = modelMeta?.contextWindow || 200_000;
            events.push({
              type: 'usage',
              contextUsage: totalIn / contextWindow,
            });
          }
        } else if (data.type === 'result') {
          // Result carries cumulative session usage — per-turn counts were already
          // accumulated from assistant events, so we do NOT emit tokensUsed here
          // (that was the double-count). Only emit session-level metadata.
          events.push({
            type: 'result',
            data: data.result,
            cost: data.total_cost_usd,
            duration: data.duration_ms,
            turns: data.num_turns,
          });
        }
      } catch {
        // Not JSON — ignore raw text lines in stream-json mode
      }
    }

    if (events.length === 0) return null;

    // Merge events: prefer content-bearing events (activity/result) over usage/session.
    // Accumulate token counts across all events in this chunk.
    let content = events.find((e) => e.type === 'result') || events.find((e) => e.type === 'activity') || events[events.length - 1];
    const merged = { ...content };

    let totalTokens = 0;
    let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheCreation = 0;
    for (const e of events) {
      if (e.tokensUsed > 0) totalTokens += e.tokensUsed;
      if (e.inputTokens > 0) totalInput += e.inputTokens;
      if (e.outputTokens > 0) totalOutput += e.outputTokens;
      if (e.cacheReadTokens > 0) totalCacheRead += e.cacheReadTokens;
      if (e.cacheCreationTokens > 0) totalCacheCreation += e.cacheCreationTokens;
      if (e.sessionId) merged.sessionId = e.sessionId;
      if (e.contextUsage !== undefined) merged.contextUsage = e.contextUsage;
    }
    if (totalTokens > 0) merged.tokensUsed = totalTokens;
    if (totalInput > 0) merged.inputTokens = totalInput;
    if (totalOutput > 0) merged.outputTokens = totalOutput;
    if (totalCacheRead > 0) merged.cacheReadTokens = totalCacheRead;
    if (totalCacheCreation > 0) merged.cacheCreationTokens = totalCacheCreation;

    return merged;
  }

  streamChat(messages, model, apiKey, onChunk, onDone, onError) {
    if (!apiKey) return null;
    const controller = new AbortController();
    let finished = false;
    const finish = () => { if (!finished) { finished = true; onDone(); } };
    const body = JSON.stringify({
      model: model || 'claude-sonnet-4-6',
      messages,
      max_tokens: 8192,
      stream: true,
    });
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body,
      signal: controller.signal,
    }).then((res) => {
      if (!res.ok) {
        return res.text().then((t) => { throw new Error(`Anthropic API ${res.status}: ${t.slice(0, 200)}`); });
      }
      return parseSSEStream(res, (event) => {
        if (event.done) { finish(); return; }
        if (event.type === 'content_block_delta' && event.delta?.text) {
          onChunk(event.delta.text);
        } else if (event.type === 'message_stop') {
          finish();
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

  static getAuthStatus() {
    try {
      const out = execSync('claude auth status --json', { encoding: 'utf8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'] });
      const data = JSON.parse(out);
      return {
        authenticated: true,
        authMethod: data.authMethod || data.auth_method || 'unknown',
        email: data.email || null,
        subscriptionType: data.subscriptionType || data.subscription_type || null,
        orgName: data.orgName || data.org_name || null,
      };
    } catch (err) {
      return { authenticated: false, error: err.message };
    }
  }

  static triggerLogin() {
    const child = cpSpawn('claude', ['auth', 'login', '--claudeai'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return { pid: child.pid };
  }

  static setupGuide() {
    return {
      installSteps: ['Installing Claude Code...', 'This may take a minute'],
      authMethods: ['subscription', 'api-key'],
      authInstructions: {
        subscriptionLoginHelp: 'Sign in with your Anthropic account',
      },
    };
  }

  static authMethods() {
    return ['subscription', 'api-key'];
  }

  static async startLogin() {
    return new Promise((resolve) => {
      const child = cpSpawn('claude', ['auth', 'login', '--claudeai'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      const timeout = setTimeout(() => {
        const urlMatch = (stdout + stderr).match(/https:\/\/\S+/);
        if (urlMatch) {
          resolve({ status: 'pending', url: urlMatch[0], pid: child.pid });
        } else {
          resolve({ status: 'pending', message: 'Login started — check your browser', pid: child.pid });
        }
      }, 3000);

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({ status: 'authenticated' });
        } else {
          const urlMatch = (stdout + stderr).match(/https:\/\/\S+/);
          resolve(urlMatch
            ? { status: 'pending', url: urlMatch[0], pid: child.pid }
            : { status: 'error', error: stderr.slice(-200) || `Login failed (exit ${code})` });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ status: 'error', error: err.message });
      });
    });
  }
}
