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
    ctx.classifier.onStep(event);

    if (event.content && typeof event.content === 'string') {
      event.content = this._scrubber.scrub(event.content);
    }

    const step = {
      step: ++ctx.stepCount,
      type: event.type,
      timestamp: Date.now() / 1000,
      ...event,
    };

    if (event.type === 'error') ctx.errorsEncountered++;
    ctx.allSteps.push(step);

    const envelope = ctx.builder.addStep(step);
    if (envelope) {
      this._signAndTransmit(ctx.sessionId, envelope);
      ctx.chunkCount++;
    }
  }

  _flushContext(agentId) {
    const ctx = this._contexts.get(agentId);
    if (!ctx) return;
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

    const closeEnvelope = ctx.builder.buildSessionClose({
      status,
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

  _signAndTransmit(sessionId, envelope) {
    try {
      const signed = this._attestation.signEnvelope(sessionId, envelope);
      this._transmissionQueue.enqueue(signed);
    } catch {
      // fail silent
    }
  }
}
