// GROOVE — Codex Provider (OpenAI)
// FSL-1.1-Apache-2.0 — see LICENSE

import { execSync } from 'child_process';
import { Provider } from './base.js';

export class CodexProvider extends Provider {
  static name = 'codex';
  static displayName = 'Codex';
  static command = 'codex';
  static authType = 'api-key';
  static envKey = 'OPENAI_API_KEY';
  static models = [
    { id: 'o3', name: 'o3', tier: 'heavy', pricing: { input: 0.01, output: 0.04 } },
    { id: 'o4-mini', name: 'o4-mini', tier: 'medium', pricing: { input: 0.001, output: 0.004 } },
    { id: 'gpt-4.1', name: 'GPT-4.1', tier: 'heavy', pricing: { input: 0.002, output: 0.008 } },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', tier: 'medium', pricing: { input: 0.0004, output: 0.0016 } },
    { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', tier: 'light', pricing: { input: 0.0001, output: 0.0004 } },
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
