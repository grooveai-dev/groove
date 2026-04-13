// GROOVE — Task Complexity Classifier
// FSL-1.1-Apache-2.0 — see LICENSE

// Classifies agent activity into light/medium/heavy tiers
// to inform adaptive model routing decisions.

const TIERS = {
  LIGHT: 'light',     // Read-only exploration, search, simple questions
  MEDIUM: 'medium',   // Single file edits, focused tasks
  HEAVY: 'heavy',     // Multi-file refactors, architecture, complex debugging
};

// Patterns that indicate complexity level
const HEAVY_SIGNALS = [
  /refactor/i,
  /architect/i,
  /redesign/i,
  /migrate/i,
  /rewrite/i,
  /complex/i,
  /multiple files/i,
  /breaking change/i,
  /database schema/i,
  /auth(entication|orization)/i,
];

const LIGHT_SIGNALS = [
  /^(Read|Glob|Grep|ls|cat|find)/,
  /search/i,
  /list/i,
  /show/i,
  /what is/i,
  /explain/i,
  /look at/i,
];

export class TaskClassifier {
  constructor() {
    this.windowSize = 200; // Large enough for quality signal extraction across tool calls
    this.agentWindows = {}; // for degradation detection and adaptive scoring
    this._lastBroadcast = {};
  }

  addEvent(agentId, event) {
    if (!this.agentWindows[agentId]) this.agentWindows[agentId] = [];
    const window = this.agentWindows[agentId];

    // Extract structured tool/error events from Claude Code content blocks.
    // Claude's stream-json emits assistant messages with content arrays containing
    // tool_use and tool_result blocks that drive quality signal extraction.
    let extracted = false;
    if (event.type === 'activity' && Array.isArray(event.data)) {
      for (const block of event.data) {
        if (block.type === 'tool_use') {
          window.push({
            type: 'tool',
            tool: block.name,
            input: block.input?.file_path || block.input?.path || block.input?.command || '',
            isError: false,
            timestamp: Date.now(),
          });
          extracted = true;
        }
        if (block.type === 'tool_result') {
          if (block.is_error) {
            window.push({ type: 'error', timestamp: Date.now() });
            extracted = true;
          }
        }
      }
    }

    // Only push the raw event if we didn't extract structured events from it —
    // avoids double-counting and window bloat from activity wrappers.
    if (!extracted) {
      window.push({ ...event, timestamp: event.timestamp || Date.now() });
    }
    while (window.length > this.windowSize) window.shift();
  }

  // Classify current activity for an agent
  classify(agentId) {
    const events = this.agentWindows[agentId] || [];
    if (events.length === 0) return TIERS.MEDIUM; // Default

    let heavyScore = 0;
    let lightScore = 0;

    const uniqueFiles = new Set();
    let writeCount = 0;
    let readCount = 0;

    for (const event of events) {
      const text = event.data || event.text || '';

      // Check heavy signals
      for (const pattern of HEAVY_SIGNALS) {
        if (pattern.test(text)) heavyScore += 2;
      }

      // Check light signals
      for (const pattern of LIGHT_SIGNALS) {
        if (pattern.test(text)) lightScore += 2;
      }

      // Count file operations
      if (event.type === 'tool') {
        if (event.tool === 'Write' || event.tool === 'Edit') {
          writeCount++;
          if (event.input) uniqueFiles.add(event.input);
        }
        if (event.tool === 'Read' || event.tool === 'Glob' || event.tool === 'Grep') {
          readCount++;
        }
      }

      // Errors indicate complexity
      if (event.type === 'error') heavyScore += 3;
    }

    // Multi-file edits are heavy
    if (uniqueFiles.size >= 3) heavyScore += 5;
    if (uniqueFiles.size >= 5) heavyScore += 5;

    // Read-only sessions are light
    if (writeCount === 0 && readCount > 0) lightScore += 5;

    // Write-heavy but single file is medium
    if (writeCount > 0 && uniqueFiles.size <= 1) {
      // Stays medium (default)
    }

    if (heavyScore > lightScore && heavyScore >= 5) return TIERS.HEAVY;
    if (lightScore > heavyScore && lightScore >= 5) return TIERS.LIGHT;
    return TIERS.MEDIUM;
  }

  // Get the recommended model tier for an agent
  getRecommendation(agentId, availableModels) {
    const tier = this.classify(agentId);

    // Find the cheapest model that matches the tier
    const match = availableModels.find((m) => m.tier === tier);
    if (match) return { model: match, tier, reason: `Task classified as ${tier}` };

    // Fallback: use medium tier
    const fallback = availableModels.find((m) => m.tier === 'medium')
      || availableModels[0];
    return { model: fallback, tier, reason: `No ${tier} model available, using ${fallback?.tier || 'default'}` };
  }

  // Returns agents with significant classification changes since last poll.
  // Called by the daemon's 30s broadcast timer — keeps classification
  // completely decoupled from the stdout hot path.
  getUpdates() {
    const updates = [];
    for (const [agentId, events] of Object.entries(this.agentWindows)) {
      if (events.length < 40) continue; // Not enough data

      const tier = this.classify(agentId);
      const eventCount = events.length;
      const lastBroadcast = this._lastBroadcast[agentId];

      // Only report if classification changed or this is the first report
      if (!lastBroadcast || lastBroadcast.tier !== tier ||
          Math.abs(lastBroadcast.eventCount - eventCount) >= 20) {
        updates.push({ agentId, tier, eventCount });
        this._lastBroadcast[agentId] = { tier, eventCount };
      }
    }
    return updates;
  }

  clearAgent(agentId) {
    delete this.agentWindows[agentId];
    delete this._lastBroadcast[agentId];
  }
}
