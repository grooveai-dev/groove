// GROOVE — Nano Banana Provider (Google Image Generation)
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Nano Banana is Google's image generation family built on Gemini models:
//   - Nano Banana 2 (Gemini 3.1 Flash Image) — fast generation
//   - Nano Banana Pro (Gemini 3 Pro Image) — professional quality, up to 4K
// Uses the Gemini API with responseModalities: ["IMAGE"].

import { Provider } from './base.js';

export class NanaBananaProvider extends Provider {
  static name = 'nano-banana';
  static displayName = 'Nano Banana';
  static command = '';
  static authType = 'api-key';
  static envKey = 'GEMINI_API_KEY';
  static models = [
    { id: 'nano-banana-2', name: 'Nano Banana 2', tier: 'medium', type: 'image', geminiModel: 'gemini-2.0-flash-preview-image-generation', pricing: { perImage: 0.02 } },
    { id: 'nano-banana-pro', name: 'Nano Banana Pro', tier: 'heavy', type: 'image', geminiModel: 'gemini-2.0-flash-preview-image-generation', pricing: { perImage: 0.05 } },
  ];

  static isInstalled() {
    return true; // API-only, shares GEMINI_API_KEY
  }

  static installCommand() {
    return '';
  }

  buildSpawnCommand() {
    return null;
  }

  buildHeadlessCommand() {
    return null;
  }

  switchModel() {
    return false;
  }

  parseOutput() {
    return null;
  }

  async generateImage(prompt, options = {}) {
    const apiKey = options.apiKey;
    if (!apiKey) throw new Error('GEMINI_API_KEY required for Nano Banana image generation');

    const modelEntry = NanaBananaProvider.models.find((m) => m.id === (options.model || 'nano-banana-2'));
    const geminiModel = modelEntry?.geminiModel || 'gemini-2.0-flash-preview-image-generation';

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
          },
        }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Nano Banana API ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData);

    if (!imagePart) {
      const textPart = parts.find((p) => p.text);
      throw new Error(textPart?.text || 'No image generated');
    }

    return {
      url: null,
      b64_json: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType || 'image/png',
      model: options.model || 'nano-banana-2',
      provider: 'nano-banana',
    };
  }

  static setupGuide() {
    return {
      installSteps: [],
      authMethods: ['api-key'],
      authInstructions: {
        apiKeyHelp: 'Uses your Gemini API key — get one at aistudio.google.com',
      },
    };
  }

  static authMethods() {
    return ['api-key'];
  }
}
