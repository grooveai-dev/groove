// FSL-1.1-Apache-2.0 — see LICENSE

import { randomUUID } from 'crypto';
import { deliverInstruction } from './deliver.js';

// An unanswered ask holds an HTTP request open and blocks the calling agent,
// so it has to be bounded.
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TIMEOUT_MS = 15 * 60 * 1000;

// Ceiling on autonomous back-and-forth. Two agents that can call each other
// freely will happily talk until the budget is gone; past this they're told to
// wrap up and report to the user.
const MAX_EXCHANGES = 12;

const CONTEXT_TURNS = 4;
const MAX_TURN_CHARS = 1200;

/**
 * Agent-to-agent consultation.
 *
 * An agent asks another agent a question and BLOCKS until it answers — the
 * daemon holds the caller's HTTP request open, delivers the question, waits
 * for the target's next result, and returns it as the response body. That
 * makes a normal request/response loop available to the calling agent, so two
 * agents can iterate to consensus without a human relaying between them.
 *
 * Delivery goes through deliverInstruction — the same pipe as user chat — so
 * a question reaches its target whether it's mid-task, idle, or stopped.
 */
export class InnerChat {
  constructor(daemon) {
    this.daemon = daemon;
    this.threads = new Map();
    // agentId being asked -> pending record (resolve/reject/timer/threadId)
    this.awaiting = new Map();
    // asker id -> id of the agent it is currently blocked on
    this.blockedOn = new Map();
  }

  /**
   * Ask another agent a question and wait for its answer.
   *
   * Resolves with { reply, threadId, exchanges, remaining }. Rejects when the
   * target can't be reached, the exchange cap is hit, the call would deadlock,
   * or the target doesn't answer inside the timeout.
   */
  async ask(fromAgentId, toAgentId, message, opts = {}) {
    const fromAgent = this.daemon.registry.get(fromAgentId);
    const toAgent = this.daemon.registry.get(toAgentId);
    if (!fromAgent) throw new Error(`Calling agent ${fromAgentId} not found`);
    if (!toAgent) throw new Error(`Target agent ${toAgentId} not found`);
    if (fromAgentId === toAgentId) throw new Error('An agent cannot ask itself');
    if (!message || !message.trim()) throw new Error('message is required');

    // Deadlock guard: the target is already blocked waiting on us, so it can
    // never get far enough to read this. Tell the caller to just answer.
    if (this.blockedOn.get(toAgentId) === fromAgentId) {
      throw new Error(
        `${toAgent.name} is currently waiting for YOUR answer — it cannot reply to a new `
        + 'question until you respond. Answer its question first; your reply is what unblocks it.',
      );
    }
    if (this.awaiting.has(toAgentId)) {
      throw new Error(`${toAgent.name} is already answering another agent — try again shortly`);
    }

    const thread = opts.threadId ? this.threads.get(opts.threadId) : this._findThread(fromAgentId, toAgentId);
    const t = thread || this._createThread(fromAgent, toAgent);

    const exchanges = t.turns.filter((x) => x.kind === 'ask').length;
    if (exchanges >= MAX_EXCHANGES) {
      throw new Error(
        `This conversation has reached its ${MAX_EXCHANGES}-exchange limit. Stop consulting `
        + `${toAgent.name} and report your conclusion to the user.`,
      );
    }

    const timeoutMs = Math.min(Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

    const turn = {
      id: randomUUID().slice(0, 12),
      from: peer(fromAgent),
      to: peer(toAgent),
      text: message.trim(),
      kind: 'ask',
      status: 'sending',
      timestamp: Date.now(),
    };
    t.turns.push(turn);

    const wrapped = this._wrap(t, fromAgent, toAgent, message.trim());

    let result;
    try {
      result = await deliverInstruction(this.daemon, toAgentId, wrapped, { recordFeedback: false });
    } catch (err) {
      turn.status = 'failed';
      turn.error = err.message;
      t.status = 'failed';
      this._broadcast(t, turn);
      throw new Error(`Could not reach ${toAgent.name}: ${err.message}`);
    }

    // A stopped target gets resumed or rotated, which mints a new agent id.
    // Re-key onto it or the answer will never be matched.
    const targetId = result.agentId;
    if (targetId !== toAgentId) {
      this._remapParticipant(t, toAgentId, targetId);
      turn.to.id = targetId;
    }

    turn.status = result.status;
    t.status = 'awaiting_reply';
    t.updatedAt = Date.now();
    this._broadcast(t, turn);
    this.daemon.audit.log('innerchat.ask', { thread: t.id, from: fromAgentId, to: targetId });

    // A queued question sits behind whatever the target is already doing, so
    // the next result belongs to that prior task, not to us — skip it.
    const skipResults = result.status === 'message_queued' ? 1 : 0;

    const reply = await this._awaitReply(t, fromAgentId, targetId, { skipResults, timeoutMs });

    return {
      reply,
      threadId: t.id,
      exchanges: exchanges + 1,
      remaining: MAX_EXCHANGES - (exchanges + 1),
    };
  }

  _awaitReply(thread, askerId, targetId, { skipResults, timeoutMs }) {
    return new Promise((resolve, reject) => {
      const settle = (fn, value) => {
        clearTimeout(record.timer);
        this.awaiting.delete(targetId);
        this.blockedOn.delete(askerId);
        fn(value);
      };

      const record = {
        threadId: thread.id,
        askerId,
        skipResults,
        resolve: (text) => settle(resolve, text),
        reject: (err) => settle(reject, err),
        timer: setTimeout(() => {
          thread.status = 'timeout';
          thread.updatedAt = Date.now();
          record.reject(new Error(
            `No answer within ${Math.round(timeoutMs / 1000)}s. The agent may still be working — `
            + 'proceed on your own judgement or try again.',
          ));
        }, timeoutMs),
      };

      this.awaiting.set(targetId, record);
      this.blockedOn.set(askerId, targetId);
    });
  }

  /**
   * Watch agent output for the answer to an outstanding question.
   * Called from the process manager's output handler.
   */
  onAgentOutput(agentId, output) {
    const pending = this.awaiting.get(agentId);
    if (!pending) return;
    if (output.type !== 'result') return;

    const thread = this.threads.get(pending.threadId);
    if (!thread) { pending.reject(new Error('Conversation was lost')); return; }

    const text = extractText(output.data);
    if (!text) return;

    // Burn off results belonging to work already underway when we queued.
    if (pending.skipResults > 0) {
      pending.skipResults -= 1;
      return;
    }

    const responder = this.daemon.registry.get(agentId);
    thread.turns.push({
      id: randomUUID().slice(0, 12),
      from: responder ? peer(responder) : { id: agentId, name: agentId, role: 'agent' },
      to: this._otherParticipant(thread, agentId),
      text,
      kind: 'answer',
      status: 'delivered',
      timestamp: Date.now(),
    });
    thread.status = 'idle';
    thread.updatedAt = Date.now();

    this._broadcast(thread, thread.turns.at(-1));
    this.daemon.audit.log('innerchat.answer', { thread: thread.id, from: agentId });

    pending.resolve(text);
  }

  /**
   * An agent that dies mid-question would otherwise leave its asker blocked
   * until the timeout. Called when an agent crashes or is killed.
   */
  onAgentGone(agentId, reason = 'stopped') {
    const pending = this.awaiting.get(agentId);
    if (!pending) return;
    const agent = this.daemon.registry.get(agentId);
    pending.reject(new Error(`${agent?.name || agentId} ${reason} before answering`));
  }

  // ── Threads ─────────────────────────────────────────────────

  _createThread(fromAgent, toAgent) {
    const thread = {
      id: randomUUID().slice(0, 12),
      participants: [peer(fromAgent), peer(toAgent)],
      turns: [],
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.threads.set(thread.id, thread);
    return thread;
  }

  // Consecutive asks between the same pair continue one conversation, so the
  // exchange cap actually bounds a back-and-forth rather than resetting.
  _findThread(a, b) {
    return this.getThreads(a).find((t) => t.participants.some((p) => p.id === b)) || null;
  }

  // The target sees a direct message from the other agent, with enough prior
  // turns to follow a continuing conversation.
  _wrap(thread, fromAgent, toAgent, message) {
    const prior = thread.turns.slice(0, -1).slice(-CONTEXT_TURNS);
    const lines = [`[InnerChat — ${fromAgent.name} (${fromAgent.role}) is asking you a question]`, ''];

    if (prior.length) {
      lines.push('Earlier in this conversation:');
      for (const t of prior) lines.push(`  ${t.from.name}: ${truncate(t.text, MAX_TURN_CHARS)}`);
      lines.push('');
    }

    lines.push(message, '');
    lines.push(
      `${fromAgent.name} is BLOCKED waiting on your answer — it cannot continue until you `
      + 'respond. Answer directly and concisely in your next message; that message is sent '
      + 'back to it verbatim. Do not address the user, and do not start unrelated work first.',
    );
    return lines.join('\n');
  }

  _otherParticipant(thread, agentId) {
    return thread.participants.find((p) => p.id !== agentId) || thread.participants[0];
  }

  _remapParticipant(thread, oldId, newId) {
    for (const p of thread.participants) if (p.id === oldId) p.id = newId;
    const pending = this.awaiting.get(oldId);
    if (pending) {
      this.awaiting.delete(oldId);
      this.awaiting.set(newId, pending);
    }
  }

  _broadcast(thread, turn) {
    this.daemon.broadcast({ type: 'innerchat:turn', data: { thread, turn } });
  }

  // ── Queries ─────────────────────────────────────────────────

  getThreads(agentId = null) {
    const all = Array.from(this.threads.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!agentId) return all;
    return all.filter((t) => t.participants.some((p) => p.id === agentId));
  }

  getThread(id) {
    return this.threads.get(id) || null;
  }

  getPending(agentId) {
    const pending = this.awaiting.get(agentId);
    return pending ? this.threads.get(pending.threadId) : null;
  }
}

function peer(agent) {
  return { id: agent.id, name: agent.name, role: agent.role };
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max)}… [truncated]`;
}

function extractText(data) {
  if (typeof data === 'string') return data.trim();
  if (Array.isArray(data)) {
    return data.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  }
  return '';
}

export { MAX_EXCHANGES, DEFAULT_TIMEOUT_MS };
