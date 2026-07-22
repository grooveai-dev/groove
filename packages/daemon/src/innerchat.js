// FSL-1.1-Apache-2.0 — see LICENSE

import { randomUUID } from 'crypto';
import { deliverInstruction } from './deliver.js';

// How much prior conversation to replay into each relay turn. Enough for the
// recipient to pick up the thread without re-reading the whole exchange.
const CONTEXT_TURNS = 4;
const MAX_TURN_CHARS = 1200;

/**
 * Agent-to-agent relay, user-initiated.
 *
 * The A→B hop is always driven by a human clicking Relay. The B→A hop is
 * automatic: B's answer is fed straight back into A so A can process it and
 * report to the user, who then decides whether to run another turn.
 *
 * Delivery goes through deliverInstruction — the same pipe as user chat — so
 * a relay reaches its target whether it's mid-task, idle, or stopped.
 */
export class InnerChat {
  constructor(daemon) {
    this.daemon = daemon;
    this.threads = new Map();
    // agentId -> { threadId, sentAt } — which agent we're awaiting a reply from.
    this.awaiting = new Map();
  }

  /**
   * Relay a message from one agent to another, opening a thread or continuing
   * an existing one.
   */
  async send(fromAgentId, toAgentId, message, threadId = null) {
    const fromAgent = this.daemon.registry.get(fromAgentId);
    const toAgent = this.daemon.registry.get(toAgentId);
    if (!fromAgent) throw new Error(`Sender agent ${fromAgentId} not found`);
    if (!toAgent) throw new Error(`Target agent ${toAgentId} not found`);
    if (fromAgentId === toAgentId) throw new Error('Cannot relay an agent to itself');
    if (!message || !message.trim()) throw new Error('message is required');

    const thread = threadId ? this.threads.get(threadId) : null;
    if (threadId && !thread) throw new Error(`Thread ${threadId} not found`);

    const t = thread || this._createThread(fromAgent, toAgent);
    const turn = {
      id: randomUUID().slice(0, 12),
      from: peer(fromAgent),
      to: peer(toAgent),
      text: message.trim(),
      kind: 'relay',
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
      this.daemon.broadcast({ type: 'innerchat:turn', data: { thread: t, turn } });
      throw err;
    }

    // A stopped target gets resumed or rotated, which mints a new agent id.
    // Re-key everything onto it or the reply will never be captured.
    if (result.agentId !== toAgentId) {
      this._remapParticipant(t, toAgentId, result.agentId);
      turn.to.id = result.agentId;
    }

    turn.status = result.status;
    t.status = 'awaiting_reply';
    t.updatedAt = Date.now();

    // A queued relay sits behind whatever the agent is already doing, so the
    // next result belongs to that prior task, not to us — skip it.
    const skipResults = result.status === 'message_queued' ? 1 : 0;
    this.awaiting.set(turn.to.id, { threadId: t.id, sentAt: Date.now(), skipResults });

    this.daemon.broadcast({ type: 'innerchat:turn', data: { thread: t, turn } });
    this.daemon.audit.log('innerchat.send', { thread: t.id, from: fromAgentId, to: turn.to.id });

    return { thread: t, turn };
  }

  /**
   * Watch agent output for the reply to an outstanding relay, then forward it
   * back to the agent that asked.
   */
  onAgentOutput(agentId, output) {
    const pending = this.awaiting.get(agentId);
    if (!pending) return;
    if (output.type !== 'result') return;

    const thread = this.threads.get(pending.threadId);
    if (!thread) { this.awaiting.delete(agentId); return; }

    const responseText = extractText(output.data);
    if (!responseText) return;

    // Burn off results belonging to work that was already underway when the
    // relay was queued behind it.
    if (pending.skipResults > 0) {
      pending.skipResults -= 1;
      return;
    }

    // Claim the reply before the async forward so a second result arriving
    // mid-flight can't be captured as a duplicate.
    this.awaiting.delete(agentId);

    const responder = this.daemon.registry.get(agentId);
    const asker = this._otherParticipant(thread, agentId);

    const turn = {
      id: randomUUID().slice(0, 12),
      from: responder ? peer(responder) : { id: agentId, name: agentId, role: 'agent' },
      to: asker,
      text: responseText,
      kind: 'reply',
      status: 'forwarding',
      timestamp: Date.now(),
    };
    thread.turns.push(turn);
    thread.status = 'forwarding';
    thread.updatedAt = Date.now();

    this._forwardReply(thread, turn, asker.id, responseText);
  }

  async _forwardReply(thread, turn, askerId, responseText) {
    const from = turn.from;
    const relay = [
      `[InnerChat reply from ${from.name} (${from.role})]`,
      '',
      responseText,
      '',
      `This is the answer to what you relayed to ${from.name}. Process it and report back — `
        + 'the user will decide whether to send another turn.',
    ].join('\n');

    try {
      const result = await deliverInstruction(this.daemon, askerId, relay, { recordFeedback: false });
      if (result.agentId !== askerId) {
        this._remapParticipant(thread, askerId, result.agentId);
        turn.to.id = result.agentId;
      }
      turn.status = result.status;
      thread.status = 'idle';
    } catch (err) {
      turn.status = 'failed';
      turn.error = err.message;
      thread.status = 'failed';
    }

    thread.updatedAt = Date.now();
    this.daemon.broadcast({ type: 'innerchat:turn', data: { thread, turn } });
    this.daemon.audit.log('innerchat.reply', { thread: thread.id, from: turn.from.id, to: turn.to.id });
  }

  // ── Thread helpers ──────────────────────────────────────────

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

  // Rebuild the message the target sees. It reads as a direct message from the
  // other agent, with enough prior turns that a continuing thread makes sense.
  _wrap(thread, fromAgent, toAgent, message) {
    const prior = thread.turns.slice(0, -1).slice(-CONTEXT_TURNS);
    const lines = [`[InnerChat from ${fromAgent.name} (${fromAgent.role})]`, ''];

    if (prior.length) {
      lines.push('Earlier in this conversation:');
      for (const t of prior) {
        lines.push(`  ${t.from.name}: ${truncate(t.text, MAX_TURN_CHARS)}`);
      }
      lines.push('');
    }

    lines.push(message, '');
    lines.push(
      `Reply normally — your response is relayed straight back to ${fromAgent.name}. `
      + 'Answer them directly; do not address the user.',
    );
    return lines.join('\n');
  }

  _otherParticipant(thread, agentId) {
    return thread.participants.find((p) => p.id !== agentId) || thread.participants[0];
  }

  _remapParticipant(thread, oldId, newId) {
    for (const p of thread.participants) {
      if (p.id === oldId) p.id = newId;
    }
    // Any relay still awaiting a reply from the old id must follow it forward.
    const pending = this.awaiting.get(oldId);
    if (pending) {
      this.awaiting.delete(oldId);
      this.awaiting.set(newId, pending);
    }
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
