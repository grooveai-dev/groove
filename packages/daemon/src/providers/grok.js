// GROOVE — xAI Grok Provider
// FSL-1.1-Apache-2.0 — see LICENSE

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

export class GrokProvider extends Provider {
  static name = 'grok';
  static displayName = 'xAI Grok';
  static command = '';
  static authType = 'api-key';
  static envKey = 'XAI_API_KEY';
  static models = [
    { id: 'grok-4', name: 'Grok 4', tier: 'heavy', maxContext: 131072, pricing: { input: 0.003, output: 0.015 } },
    { id: 'grok-4-1-fast', name: 'Grok 4.1 Fast', tier: 'medium', maxContext: 131072, pricing: { input: 0.0002, output: 0.0005 } },
    { id: 'grok-code-fast-1', name: 'Grok Code Fast', tier: 'medium', maxContext: 131072, pricing: { input: 0.0002, output: 0.0015 } },
    { id: 'grok-3', name: 'Grok 3', tier: 'heavy', maxContext: 131072, pricing: { input: 0.003, output: 0.015 } },
    { id: 'grok-3-mini', name: 'Grok 3 Mini', tier: 'light', maxContext: 131072, pricing: { input: 0.0003, output: 0.0005 } },
    { id: 'grok-imagine-image', name: 'Grok Imagine', tier: 'medium', type: 'image', pricing: { perImage: 0.07 } },
  ];
  static useAgentLoop = true;

  static isInstalled() {
    return true; // API-only, no CLI needed
  }

  static installCommand() {
    return '';
  }

  buildSpawnCommand() {
    return null; // No agent harness
  }

  buildHeadlessCommand() {
    return null; // No CLI
  }

  normalizeConfig(config) {
    if (typeof config.temperature !== 'number' && typeof config.reasoningEffort === 'number') {
      config.temperature = 0.1 + (100 - config.reasoningEffort) * 0.008;
    }
    return config;
  }

  getLoopConfig(agent) {
    return {
      apiBase: 'https://api.x.ai/v1',
      model: agent.model,
      contextWindow: 131072,
      temperature: typeof agent.temperature === 'number' ? agent.temperature : 0.1,
      maxResponseTokens: 16384,
      stream: true,
      apiKey: agent.apiKey,
      headers: {},
      introContext: agent.introContext || '',
    };
  }

  switchModel() {
    return false;
  }

  parseOutput() {
    return null;
  }

  static estimateCost(tokens, modelId) {
    const model = GrokProvider.models.find((m) => m.id === modelId);
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
    fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
      signal: controller.signal,
    }).then((res) => {
      if (!res.ok) {
        return res.text().then((t) => { throw new Error(`xAI API ${res.status}: ${t.slice(0, 200)}`); });
      }
      return parseSSEStream(res, (event) => {
        if (event.done) { finish(); return; }
        const content = event.choices?.[0]?.delta?.content;
        if (content) onChunk(content);
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
    if (!apiKey) throw new Error('XAI_API_KEY required for image generation');

    const body = {
      model: options.model || 'grok-imagine-image',
      prompt,
      n: 1,
    };
    if (options.size) body.size = options.size;

    const res = await fetch('https://api.x.ai/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`xAI Image API ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const image = data.data?.[0];
    return {
      url: image?.url || null,
      b64_json: image?.b64_json || null,
      model: body.model,
      provider: 'grok',
    };
  }

  static setupGuide() {
    return {
      installSteps: [],
      authMethods: ['api-key'],
      authInstructions: {
        apiKeyHelp: 'Get your API key from console.x.ai',
      },
    };
  }

  static authMethods() {
    return ['api-key'];
  }
}
