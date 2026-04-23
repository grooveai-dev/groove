// GROOVE — Gemini CLI Provider (Google)
// FSL-1.1-Apache-2.0 — see LICENSE

import { execSync } from 'child_process';
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

export class GeminiProvider extends Provider {
  static name = 'gemini';
  static displayName = 'Gemini CLI';
  static command = 'gemini';
  static authType = 'api-key';
  static envKey = 'GEMINI_API_KEY';
  static models = [
    { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', tier: 'heavy', maxContext: 1000000, pricing: { input: 0.00125, output: 0.01 } },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', tier: 'medium', maxContext: 1000000, pricing: { input: 0.00015, output: 0.0006 } },
    { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite', tier: 'light', maxContext: 1000000, pricing: { input: 0.000075, output: 0.0003 } },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', tier: 'heavy', maxContext: 1000000, pricing: { input: 0.00125, output: 0.01 } },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', tier: 'medium', maxContext: 1000000, pricing: { input: 0.00015, output: 0.0006 } },
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

    args.push('--yolo');
    args.push('--output-format', 'stream-json');
    args.push('-p', '');

    this._currentModel = agent.model;

    return {
      command: 'gemini',
      args,
      env: agent.apiKey ? { GEMINI_API_KEY: agent.apiKey } : {},
      stdin: agent.prompt || undefined,
    };
  }

  buildHeadlessCommand(prompt, model) {
    const args = ['--output-format', 'stream-json', '-p', prompt];
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

  streamChat(messages, model, apiKey, onChunk, onDone, onError) {
    if (!apiKey) return null;
    const controller = new AbortController();
    let finished = false;
    const finish = () => { if (!finished) { finished = true; onDone(); } };
    const m = model || 'gemini-2.5-flash';
    const contents = messages.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse&key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents }),
      signal: controller.signal,
    }).then((res) => {
      if (!res.ok) {
        return res.text().then((t) => { throw new Error(`Gemini API ${res.status}: ${t.slice(0, 200)}`); });
      }
      return parseSSEStream(res, (event) => {
        if (event.done) { finish(); return; }
        const text = event.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) onChunk(text);
      });
    }).then(() => {
      finish();
    }).catch((err) => {
      if (err.name === 'AbortError') return;
      onError(err);
    });
    return controller;
  }

  parseOutput(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return { type: 'activity', data: trimmed };
    }

    switch (event.type) {
      case 'agent_start':
        return { type: 'activity', subtype: 'assistant', sessionId: event.streamId, data: [{ type: 'text', text: '' }] };

      case 'session_update':
        return null;

      case 'message': {
        if (event.role === 'user') return null;
        const raw = event.content;
        const parts = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [{ text: raw }] : raw ? [raw] : []);
        const blocks = parts.map((p) => {
          if (p.type === 'thought') return { type: 'text', text: p.thought || '' };
          return { type: 'text', text: p.text || '' };
        }).filter((b) => b.text);
        if (!blocks.length) return null;
        return { type: 'activity', subtype: 'assistant', data: blocks };
      }

      case 'tool_request': {
        const toolName = (event.name || '').includes('shell') || (event.name || '').includes('exec')
          ? 'Bash' : event.name || 'Tool';
        const input = event.name === 'Bash' || (event.name || '').includes('shell')
          ? { command: typeof event.args === 'string' ? event.args : JSON.stringify(event.args || {}) }
          : (event.args || {});
        return {
          type: 'activity', subtype: 'assistant',
          data: [{ type: 'tool_use', id: event.requestId || 'tool', name: toolName, input }],
        };
      }

      case 'tool_response': {
        const rawContent = event.content;
        const contentParts = Array.isArray(rawContent) ? rawContent : (typeof rawContent === 'string' ? [{ text: rawContent }] : rawContent ? [rawContent] : []);
        const content = contentParts.map((p) => p.text || '').join('').slice(0, 2000);
        const toolName = (event.name || '').includes('shell') || (event.name || '').includes('exec')
          ? 'Bash' : event.name || 'Tool';
        return {
          type: 'activity', subtype: 'assistant',
          data: [
            { type: 'tool_use', id: event.requestId || 'tool', name: toolName, input: {} },
            ...(content ? [{ type: 'text', text: content }] : []),
          ],
        };
      }

      case 'usage': {
        const inputTokens = event.inputTokens || 0;
        const outputTokens = event.outputTokens || 0;
        const cachedTokens = event.cachedTokens || 0;
        const totalTokens = inputTokens + outputTokens;

        const model = GeminiProvider.models.find((m) => m.id === this._currentModel);
        const pricing = model?.pricing;
        const maxContext = model?.maxContext || 1000000;

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
          cacheReadTokens: cachedTokens,
          contextUsage: inputTokens / maxContext,
          estimatedCostUsd,
          costSource: pricing ? 'calculated' : 'estimated',
        };
      }

      case 'agent_end':
        return { type: 'activity', subtype: 'assistant', data: [{ type: 'text', text: '' }] };

      case 'error':
        return { type: 'activity', subtype: 'assistant', data: [{ type: 'text', text: `Error: ${event.message || 'unknown'}` }] };

      default:
        return null;
    }
  }

  static setupGuide() {
    return {
      installSteps: ['Installing Gemini CLI...', 'This may take a minute'],
      authMethods: ['api-key'],
      authInstructions: {
        keyInstructions: 'Get your API key from aistudio.google.com',
      },
    };
  }

  static authMethods() {
    return ['api-key'];
  }
}
