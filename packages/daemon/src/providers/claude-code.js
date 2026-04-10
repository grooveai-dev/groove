// GROOVE — Claude Code Provider
// FSL-1.1-Apache-2.0 — see LICENSE

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { Provider } from './base.js';

export class ClaudeCodeProvider extends Provider {
  static name = 'claude-code';
  static displayName = 'Claude Code';
  static command = 'claude';
  static authType = 'subscription';
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
    //
    // The initial prompt is passed as a positional argument.
    // GROOVE context is injected via an append-only section in CLAUDE.md.

    const args = ['--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];

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
    if (model) args.push('--model', model);
    if (prompt) args.push(prompt);
    return { command: 'claude', args, env: {} };
  }

  buildHeadlessCommand(prompt, model) {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
    if (model) args.push('--model', model);
    return { command: 'claude', args, env: {} };
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
          const totalIn = inputTokens + cacheReadTokens + cacheCreationTokens;
          events.push({
            type: 'activity',
            subtype: 'assistant',
            data: data.message?.content || '',
            tokensUsed: totalIn + outputTokens,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens,
            model: data.message?.model,
          });
          // Compute context usage from assistant message usage
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
          // Result has cumulative usage for the full session
          const usage = data.usage;
          const inputTokens = usage?.input_tokens || 0;
          const cacheReadTokens = usage?.cache_read_input_tokens || 0;
          const cacheCreationTokens = usage?.cache_creation_input_tokens || 0;
          const outputTokens = usage?.output_tokens || 0;
          const totalIn = inputTokens + cacheReadTokens + cacheCreationTokens;
          events.push({
            type: 'result',
            data: data.result,
            tokensUsed: totalIn + outputTokens,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens,
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
}
