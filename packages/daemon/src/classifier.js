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
    this.windowSize = 50; // Look at last N events — needs to be large enough
    this.agentWindows = {}; // for degradation detection and adaptive scoring
  }

  // Add an event to the classification window
  addEvent(agentId, event) {
    if (!this.agentWindows[agentId]) this.agentWindows[agentId] = [];
    this.agentWindows[agentId].push(event);
    if (this.agentWindows[agentId].length > this.windowSize) {
      this.agentWindows[agentId].shift();
    }
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

  clearAgent(agentId) {
    delete this.agentWindows[agentId];
  }
}
