// FSL-1.1-Apache-2.0 — see LICENSE

export class GeminiParser {
  constructor() {
    this._sessionId = null;
  }

  parseEvent(jsonEvent) {
    if (!jsonEvent || !jsonEvent.type) return null;

    switch (jsonEvent.type) {
      case 'agent_start': {
        this._sessionId = jsonEvent.streamId || null;
        return null;
      }

      case 'message': {
        if (jsonEvent.role === 'user') return null;
        const raw = jsonEvent.content;
        const parts = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [{ text: raw }] : raw ? [raw] : []);

        for (const part of parts) {
          if (part.type === 'thought') {
            return { type: 'thought', content: part.thought || part.text || '' };
          }
        }

        const text = parts.map((p) => p.text || '').filter(Boolean).join('\n');
        if (text) {
          return { type: 'thought', content: text };
        }
        return null;
      }

      case 'tool_request': {
        return {
          type: 'action',
          tool: jsonEvent.name || 'Tool',
          arguments: jsonEvent.args || {},
          content: `Using ${jsonEvent.name || 'Tool'}`,
        };
      }

      case 'tool_response': {
        const rawContent = jsonEvent.content;
        const contentParts = Array.isArray(rawContent) ? rawContent : (typeof rawContent === 'string' ? [{ text: rawContent }] : rawContent ? [rawContent] : []);
        const content = contentParts.map((p) => p.text || '').join('').slice(0, 2000);
        return { type: 'observation', content };
      }

      case 'error': {
        return { type: 'error', content: jsonEvent.message || 'Unknown error' };
      }

      case 'agent_end': {
        return { type: 'resolution', content: '' };
      }

      default:
        return null;
    }
  }

  extractTokens(jsonEvent) {
    if (!jsonEvent || jsonEvent.type !== 'usage') return null;
    return {
      input: jsonEvent.inputTokens || 0,
      output: jsonEvent.outputTokens || 0,
      cacheRead: jsonEvent.cachedTokens || 0,
      cacheCreation: 0,
    };
  }

  extractSessionId(jsonEvent) {
    if (jsonEvent?.type === 'agent_start') {
      return jsonEvent.streamId || null;
    }
    return null;
  }
}
