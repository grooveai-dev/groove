// GROOVE — Gemini CLI Provider (Google)
// FSL-1.1-Apache-2.0 — see LICENSE

import { execSync } from 'child_process';
import { Provider } from './base.js';

export class GeminiProvider extends Provider {
  static name = 'gemini';
  static displayName = 'Gemini CLI';
  static command = 'gemini';
  static authType = 'api-key';
  static envKey = 'GEMINI_API_KEY';
  static models = [
    { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', tier: 'heavy', pricing: { input: 0.00125, output: 0.01 } },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', tier: 'medium', pricing: { input: 0.00015, output: 0.0006 } },
    { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite', tier: 'light', pricing: { input: 0.000075, output: 0.0003 } },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', tier: 'heavy', pricing: { input: 0.00125, output: 0.01 } },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', tier: 'medium', pricing: { input: 0.00015, output: 0.0006 } },
  ];

  static isInstalled() {
    try {
      execSync('which gemini', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  static installCommand() {
    return 'npm i -g @google/gemini-cli';
  }

  buildSpawnCommand(agent) {
    const args = [];

    if (agent.model) args.push('--model', agent.model);

    // YOLO mode — auto-approve all tool calls (file writes, shell commands)
    // Without this, Gemini in headless mode can only output text
    args.push('--yolo');

    // Pass prompt via stdin to avoid OS arg length limits
    // (intro context + role prompt + skill content can be very long)
    return {
      command: 'gemini',
      args,
      env: agent.apiKey ? { GEMINI_API_KEY: agent.apiKey } : {},
      stdin: agent.prompt || undefined,
    };
  }

  buildHeadlessCommand(prompt, model) {
    const args = ['-p', prompt];
    if (model) args.push('--model', model);
    return { command: 'gemini', args, env: {} };
  }

  switchModel(agent, newModel) {
    return false; // Gemini CLI doesn't support mid-session switch
  }

  static estimateCost(tokens, modelId) {
    const model = GeminiProvider.models.find((m) => m.id === modelId);
    if (!model?.pricing) return 0;
    const inputTokens = Math.round(tokens * 0.75);
    const outputTokens = tokens - inputTokens;
    return (inputTokens / 1000) * model.pricing.input + (outputTokens / 1000) * model.pricing.output;
  }

  parseOutput(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;
    // Estimate tokens from output length (~4 chars per token)
    const estimatedTokens = Math.ceil(trimmed.length / 4);
    return {
      type: 'activity', data: trimmed, tokensUsed: estimatedTokens,
      estimatedCostUsd: 0,
      costSource: 'estimated',
    };
  }
}
