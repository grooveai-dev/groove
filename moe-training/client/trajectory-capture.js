// FSL-1.1-Apache-2.0 — see LICENSE

import { randomUUID } from 'node:crypto';
import { ConsentManager } from './consent.js';
import { PIIScrubber } from './scrubber.js';
import { getParser } from './parsers/index.js';
import { StepClassifier } from './step-classifier.js';
import { EnvelopeBuilder } from './envelope-builder.js';
import { SessionAttestation } from './session-attestation.js';
import { TransmissionQueue } from './transmission-queue.js';
import { CHUNK_TIMEOUT_MS, CENTRAL_COMMAND_URL } from '../shared/constants.js';

const OFFLINE_RETRY_INTERVAL_MS = 60_000;

export class TrajectoryCapture {
  constructor(options = {}) {
    this._centralCommandUrl = options.centralCommandUrl || CENTRAL_COMMAND_URL;
    this._grooveVersion = options.grooveVersion || '0.0.0';
    this._enabled = false;
    this._scrubber = null;
    this._attestation = null;
    this._transmissionQueue = null;
    this._offlineRetryTimer = null;
    this._contexts = new Map();
  }

  init() {
    if (!ConsentManager.isCaptureEnabled()) {
      this._enabled = false;
      return;
    }
    this._enabled = true;
    this._scrubber = new PIIScrubber();
    this._attestation = new SessionAttestation(this._centralCommandUrl);
    this._transmissionQueue = new TransmissionQueue(this._centralCommandUrl);
    this._transmissionQueue.start();
    this._offlineRetryTimer = setInterval(() => {
      this._retryOfflineQueue();
    }, OFFLINE_RETRY_INTERVAL_MS);
  }

  async onAgentSpawn(agentId, provider, model, role, teamSize) {
    if (!this._enabled) return;

    const parser = getParser(provider);
    if (!parser) return;

    const sessionId = `sess_${randomUUID()}`;
    const contributorId = ConsentManager.getOrCreateUserId();
    const metadata = {
      model_engine: model,
      provider,
      agent_role: role,
      agent_id: agentId,
      task_complexity: 'medium',
      team_size: teamSize || 1,
      session_quality: 0,
      groove_version: this._grooveVersion,
    };

    const builder = new EnvelopeBuilder(sessionId, contributorId, metadata);
    const classifier = new StepClassifier();
    const startTime = Date.now();

    const ctx = {
      sessionId,
      parser,
      builder,
      classifier,
      metadata,
      stepCount: 0,
      chunkCount: 0,
      totalTokens: 0,
      errorsEncountered: 0,
      errorsRecovered: 0,
      filesModified: 0,
      coordinationEvents: 0,
      startTime,
      chunkTimer: null,
      allSteps: [],
    };

    ctx.chunkTimer = setInterval(() => {
      this._flushContext(agentId);
    }, CHUNK_TIMEOUT_MS);

    this._contexts.set(agentId, ctx);

    await this._attestation.openSession(sessionId, metadata);
  }

  onStdoutLine(agentId, jsonLine) {
    if (!this._enabled) return;
    const ctx = this._contexts.get(agentId);
    if (!ctx) return;

    let jsonEvent;
    try {
      jsonEvent = typeof jsonLine === 'string' ? JSON.parse(jsonLine) : jsonLine;
    } catch {
      return;
    }

    const parsed = ctx.parser.parseEvent(jsonEvent);
    if (!parsed) return;

    const events = Array.isArray(parsed) ? parsed : [parsed];
    for (const event of events) {
      this._processStep(agentId, ctx, event);
    }

    if ((!ctx.metadata.model_engine || ctx.metadata.model_engine === 'auto') &&
        typeof ctx.parser.extractModel === 'function') {
      const resolved = ctx.parser.extractModel(jsonEvent);
      if (resolved) ctx.metadata.model_engine = resolved;
    }

    const tokens = ctx.parser.extractTokens(jsonEvent);
    if (tokens) {
      ctx.totalTokens += (tokens.input || 0) + (tokens.output || 0);
    }
  }

  onUserMessage(agentId, text) {
    if (!this._enabled) return;
    const ctx = this._contexts.get(agentId);
    if (!ctx) return;

    const classified = ctx.classifier.classifyUserMessage(text);
    if (!classified) return;

    this._processStep(agentId, ctx, classified);
  }

  onCoordinationEvent(agentId, event) {
    if (!this._enabled) return;
    const ctx = this._contexts.get(agentId);
    if (!ctx) return;

    const classified = ctx.classifier.classifyCoordinationEvent(event);
    ctx.coordinationEvents++;
    this._processStep(agentId, ctx, classified);
  }

  async onAgentComplete(agentId, outcome) {
    await this._closeAgent(agentId, outcome?.status || 'SUCCESS', outcome);
  }

  async onAgentCrash(agentId, error) {
    await this._closeAgent(agentId, 'CRASH', { error: error?.message || String(error) });
  }

  async shutdown() {
    if (this._offlineRetryTimer) clearInterval(this._offlineRetryTimer);
    for (const agentId of this._contexts.keys()) {
      await this._closeAgent(agentId, 'SHUTDOWN');
    }
    if (this._transmissionQueue) {
      await this._transmissionQueue.stop();
    }
  }

  _processStep(agentId, ctx, event) {
    const classified = ctx.classifier.onStep(event);
    const ev = classified || event;

    if (ev.content && typeof ev.content === 'string') {
      ev.content = this._scrubber.scrub(ev.content);
    }

    if (ev.arguments && typeof ev.arguments === 'object') {
      ev.arguments = this._scrubObject(ev.arguments);
    }

    if (!ev.token_count || ev.token_count < 2) {
      const text = ev.content || '';
      const argsLen = ev.arguments ? JSON.stringify(ev.arguments).length : 0;
      ev.token_count = Math.max(1, Math.ceil((text.length + argsLen) / 4));
    }

    const step = {
      step: ++ctx.stepCount,
      type: ev.type,
      timestamp: Date.now() / 1000,
      ...ev,
    };

    if (ev.type === 'error') ctx.errorsEncountered++;
    ctx.allSteps.push(step);

    const envelope = ctx.builder.addStep(step);
    if (envelope) {
      this._signAndTransmit(ctx.sessionId, envelope);
      ctx.chunkCount++;
    }
  }

  _computeQuality(ctx) {
    let score = 50;
    const types = new Set();
    let hasCorrection = false;

    for (const step of ctx.allSteps) {
      if (step.type) types.add(step.type);
      if (step.type === 'correction') hasCorrection = true;
    }

    if (hasCorrection) score += 10;
    if (ctx.coordinationEvents > 0) score += 10;
    if (ctx.errorsRecovered > 0) score += 10;
    if (ctx.stepCount >= 20) score += 10;
    if (types.size >= 3) score += 10;

    return Math.min(score, 100);
  }

  _flushContext(agentId) {
    const ctx = this._contexts.get(agentId);
    if (!ctx) return;
    ctx.metadata.session_quality = this._computeQuality(ctx);
    const envelope = ctx.builder.flush();
    if (envelope) {
      this._signAndTransmit(ctx.sessionId, envelope);
      ctx.chunkCount++;
    }
  }

  async _closeAgent(agentId, status, extra) {
    const ctx = this._contexts.get(agentId);
    if (!ctx) return;

    if (ctx.chunkTimer) clearInterval(ctx.chunkTimer);

    this._flushContext(agentId);

    const hasRecovery = StepClassifier.detectErrorRecovery(ctx.allSteps);
    if (hasRecovery) ctx.errorsRecovered++;

    ctx.metadata.session_quality = this._computeQuality(ctx);

    const closeEnvelope = ctx.builder.buildSessionClose({
      status,
      session_quality: ctx.metadata.session_quality,
      user_interventions: StepClassifier.countUserInterventions(ctx.allSteps),
      total_steps: ctx.stepCount,
      total_chunks: ctx.chunkCount,
      total_tokens: ctx.totalTokens,
      duration_seconds: Math.round((Date.now() - ctx.startTime) / 1000),
      files_modified: extra?.files_modified || ctx.filesModified,
      errors_encountered: ctx.errorsEncountered,
      errors_recovered: ctx.errorsRecovered,
      coordination_events: ctx.coordinationEvents,
    });

    this._signAndTransmit(ctx.sessionId, closeEnvelope);

    try {
      await this._transmissionQueue.waitForDrain();
    } catch {
      // drain timeout
    }

    try {
      await this._attestation.closeSession(ctx.sessionId);
    } catch {
      // fail silent
    }

    this._contexts.delete(agentId);
  }

  async _retryOfflineQueue() {
    if (!this._enabled || !this._transmissionQueue || this._transmissionQueue.offlineQueueSize === 0) return;
    try {
      const res = await fetch(`${this._centralCommandUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        this._transmissionQueue.replayOfflineQueue(this._attestation);
      }
    } catch {
      // still unreachable
    }
  }

  _scrubObject(obj) {
    if (typeof obj === 'string') return this._scrubber.scrub(obj);
    if (Array.isArray(obj)) return obj.map((v) => this._scrubObject(v));
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = this._scrubObject(v);
      }
      return out;
    }
    return obj;
  }

  _signAndTransmit(sessionId, envelope) {
    try {
      const signed = this._attestation.signEnvelope(sessionId, envelope);
      this._transmissionQueue.enqueue(signed);
    } catch {
      // fail silent
    }
  }
}
