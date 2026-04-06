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

        if (data.type === 'assistant') {
          events.push({
            type: 'activity',
            subtype: 'assistant',
            data: data.message?.content || '',
            tokensUsed: data.message?.usage?.output_tokens || 0,
            model: data.message?.model,
          });
        } else if (data.type === 'result') {
          events.push({
            type: 'result',
            data: data.result,
            tokensUsed: data.total_cost_usd ? undefined : 0,
            cost: data.total_cost_usd,
            duration: data.duration_ms,
            turns: data.num_turns,
          });
        } else if (data.type === 'system' && data.subtype === 'usage') {
          // Use actual context window size from model metadata, not hardcoded 200K
          // Opus has 1M, Sonnet/Haiku have 200K — rotation must account for this
          const totalTokens = (data.usage?.cache_read_input_tokens || 0) + (data.usage?.input_tokens || 0);
          const modelId = data.model || events.find((e) => e.model)?.model;
          const modelMeta = ClaudeCodeProvider.models.find((m) => m.id === modelId);
          const contextWindow = modelMeta?.contextWindow || 200_000;
          events.push({
            type: 'usage',
            contextUsage: totalTokens > 0 ? totalTokens / contextWindow : undefined,
          });
        }
      } catch {
        // Not JSON — ignore raw text lines in stream-json mode
      }
    }

    if (events.length === 0) return null;

    // Merge events: accumulate tokens across all events in this chunk,
    // but return the most significant event type (usage > result > activity)
    const merged = events[events.length - 1];
    let totalTokens = 0;
    for (const e of events) {
      if (e.tokensUsed > 0) totalTokens += e.tokensUsed;
    }
    if (totalTokens > 0) merged.tokensUsed = totalTokens;

    return merged;
  }

  injectContext(agent, contextMarkdown) {
    // For Claude Code, inject context by writing to a .groove/context/<agent>.md file
    // and referencing it. Claude Code auto-reads CLAUDE.md, so we append there.
    // But we don't want to pollute the user's CLAUDE.md permanently — we use
    // the append-only GROOVE section approach.
    return contextMarkdown;
  }
}
