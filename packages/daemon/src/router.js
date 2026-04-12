// GROOVE — Adaptive Model Router
// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { getProvider } from './providers/index.js';

// Routing modes per agent
const MODES = {
  FIXED: 'fixed',     // User-selected model, no changes
  AUTO: 'auto',       // GROOVE picks the model based on task tier
  AUTO_FLOOR: 'auto-floor', // Auto, but never below a floor model
};

// Role-based tier hints for new agents with no classifier data yet.
// Default everything to heavy — intelligence out of the box. Users can
// downgrade to auto/medium if they want to optimize cost. A failed task
// at a cheaper model costs more than a successful one at the best model.
const ROLE_HINTS = {
  planner:   'heavy',
  fullstack: 'heavy',
  frontend:  'heavy',
  backend:   'heavy',
  slides:    'heavy',
  creative:  'heavy',
  security:  'heavy',
  testing:   'heavy',
  devops:    'heavy',
  database:  'heavy',
  analyst:   'heavy',
  docs:      'heavy',
  support:   'heavy',
  ea:        'heavy',
  cmo:       'heavy',
  cfo:       'heavy',
  home:      'heavy',
};

export class ModelRouter {
  constructor(daemon) {
    this.daemon = daemon;
    this.profilesPath = resolve(daemon.grooveDir, 'routing-profiles.json');
    this.agentModes = {}; // agentId -> { mode, fixedModel, floorModel }
    this.costLog = []; // [{ agentId, model, tokens, tier, timestamp }]
    this.profiles = {};
    this.loadProfiles();
  }

  loadProfiles() {
    if (existsSync(this.profilesPath)) {
      try {
        this.profiles = JSON.parse(readFileSync(this.profilesPath, 'utf8'));
      } catch {
        this.profiles = {};
      }
    }
  }

  saveProfiles() {
    writeFileSync(this.profilesPath, JSON.stringify(this.profiles, null, 2));
  }

  // Set routing mode for an agent
  setMode(agentId, mode, options = {}) {
    this.agentModes[agentId] = {
      mode: mode || MODES.FIXED,
      fixedModel: options.fixedModel || null,
      floorModel: options.floorModel || null,
    };
  }

  getMode(agentId) {
    return this.agentModes[agentId] || { mode: MODES.FIXED, fixedModel: null, floorModel: null };
  }

  // Get the recommended model for an agent based on current task
  recommend(agentId) {
    const config = this.getMode(agentId);
    const agent = this.daemon.registry.get(agentId);
    if (!agent) return null;

    const provider = getProvider(agent.provider);
    if (!provider) return null;
    const models = provider.constructor.models;

    // Fixed mode — just return the locked model
    if (config.mode === MODES.FIXED) {
      const model = config.fixedModel
        ? models.find((m) => m.id === config.fixedModel) || models[0]
        : models[0];
      return { model, mode: MODES.FIXED, reason: 'Fixed model' };
    }

    // Auto mode — use classifier
    const classifier = this.daemon.classifier;
    if (!classifier) {
      return { model: models[0], mode: config.mode, reason: 'No classifier available' };
    }

    // Use role-based hint when classifier has no activity data yet
    const hasData = classifier.agentWindows[agentId]?.length > 0;
    if (!hasData && agent.role && ROLE_HINTS[agent.role]) {
      const hintTier = ROLE_HINTS[agent.role];
      const match = models.find((m) => m.tier === hintTier) || models[0];
      return { model: match, mode: config.mode, reason: `Role hint: ${agent.role} → ${hintTier}` };
    }

    const rec = classifier.getRecommendation(agentId, models);

    // Auto-with-floor — ensure we don't go below floor
    if (config.mode === MODES.AUTO_FLOOR && config.floorModel) {
      const floorIdx = models.findIndex((m) => m.id === config.floorModel);
      const recIdx = models.findIndex((m) => m.id === rec.model.id);

      // Higher index = cheaper model. If rec is cheaper than floor, use floor.
      if (floorIdx >= 0 && recIdx > floorIdx) {
        const floor = models[floorIdx];
        return { model: floor, mode: MODES.AUTO_FLOOR, reason: `Floor: ${floor.name}` };
      }
    }

    return { model: rec.model, mode: config.mode, reason: rec.reason };
  }

  // Record a routing decision for cost tracking
  recordUsage(agentId, modelId, tokens, tier) {
    this.costLog.push({
      agentId,
      model: modelId,
      tokens,
      tier,
      timestamp: new Date().toISOString(),
    });
    // Keep last 1000 entries
    if (this.costLog.length > 1000) this.costLog = this.costLog.slice(-1000);
  }

  getStatus() {
    return {
      agentModes: this.agentModes,
      costLogSize: this.costLog.length,
      modes: MODES,
    };
  }
}
