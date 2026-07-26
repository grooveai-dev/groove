// FSL-1.1-Apache-2.0 — see LICENSE

import { randomUUID } from 'crypto';
import { deliverInstruction } from './deliver.js';
import { RelayClient, parsePeerRef } from './innerchat-relay.js';

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

// Sender-side outbox polling for async (tell) replies from a peer. Bounded: we
// poll a peer only after we've sent it a tell, and stop after a run of empty
// polls — a heads-down agent gets a generous window to finish, then we let go.
const OUTBOX_POLL_MS = 3000;
const OUTBOX_IDLE_STOP = 10; // ~30s of silence ends the poll

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
  constructor(daemon, opts = {}) {
    this.daemon = daemon;
    this.threads = new Map();
    // agentId being asked -> pending record (resolve/reject/timer/threadId)
    this.awaiting = new Map();
    // asker id -> id of the agent it is currently blocked on
    this.blockedOn = new Map();

    // Cross-daemon relay (spec: plans/cross-daemon-innerchat-spec.md).
    this.relay = opts.relay || new RelayClient();
    // Replies to async (tell) relays, queued here on the answering daemon until
    // the sending daemon polls its outbox. Entry: { id, forDaemonId, toName,
    // fromName, fromDaemonId, text, threadId, ts }.
    this.relayOutbox = [];
    // alias -> { timer, idle, busy } for active sender-side outbox pollers.
    this._outboxPollers = new Map();
  }

  // Configured peers: [{ alias, url, daemonId }]. Empty by default — cross-daemon
  // routing is off until the user adds a peer on both machines.
  _peers() {
    return Array.isArray(this.daemon.config?.innerchatPeers) ? this.daemon.config.innerchatPeers : [];
  }

  _peerByAlias(alias) {
    return this._peers().find((p) => p.alias === alias) || null;
  }

  _peerByDaemonId(daemonId) {
    return this._peers().find((p) => p.daemonId === daemonId) || null;
  }

  _daemonId() {
    return this.daemon.federation.getDaemonId();
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

    const t = this._openThread(fromAgent, toAgent, opts.threadId);
    this._checkExchangeCap(t, toAgent);

    const timeoutMs = Math.min(Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

    const { turn, targetId, skipResults } = await this._deliver(t, fromAgent, toAgent, message.trim(), 'ask');
    this.daemon.audit.log('innerchat.ask', { thread: t.id, from: fromAgentId, to: targetId });

    const reply = await this._awaitReply(t, fromAgentId, targetId, { skipResults, timeoutMs });
    const exchanges = t.turns.filter((x) => x.kind === 'ask' || x.kind === 'tell').length;

    return { reply, threadId: t.id, exchanges, remaining: MAX_EXCHANGES - exchanges };
  }

  /**
   * Send a message to another agent WITHOUT blocking. Returns as soon as it's
   * delivered. If the target later replies, the reply is routed back to the
   * sender asynchronously — resuming the sender if its turn has ended.
   *
   * This is the fire-and-forget counterpart to ask(): use it to hand off to an
   * agent that's heads-down, where waiting out a timeout would waste the turn.
   */
  async tell(fromAgentId, toAgentId, message, opts = {}) {
    const fromAgent = this.daemon.registry.get(fromAgentId);
    const toAgent = this.daemon.registry.get(toAgentId);
    if (!fromAgent) throw new Error(`Calling agent ${fromAgentId} not found`);
    if (!toAgent) throw new Error(`Target agent ${toAgentId} not found`);
    if (fromAgentId === toAgentId) throw new Error('An agent cannot message itself');
    if (!message || !message.trim()) throw new Error('message is required');
    if (this.awaiting.has(toAgentId)) {
      throw new Error(`${toAgent.name} already has an unanswered message — wait for its reply before sending another`);
    }

    const t = this._openThread(fromAgent, toAgent, opts.threadId);
    this._checkExchangeCap(t, toAgent);

    const { turn, targetId, skipResults } = await this._deliver(t, fromAgent, toAgent, message.trim(), 'tell');
    this.daemon.audit.log('innerchat.tell', { thread: t.id, from: fromAgentId, to: targetId });

    // Register async capture: the reply (if any) is forwarded, not awaited.
    this.awaiting.set(targetId, {
      mode: 'async',
      threadId: t.id,
      senderId: fromAgentId,
      skipResults,
      timer: setTimeout(() => this._clearAwait(targetId), MAX_TIMEOUT_MS),
    });

    const exchanges = t.turns.filter((x) => x.kind === 'ask' || x.kind === 'tell').length;
    return { delivered: true, threadId: t.id, exchanges, remaining: MAX_EXCHANGES - exchanges };
  }

  // Shared send: push a turn, deliver it, and remap the target id if delivery
  // resumed/rotated the agent. Returns the queued-skip count for reply capture.
  async _deliver(thread, fromAgent, toAgent, message, kind) {
    const turn = {
      id: randomUUID().slice(0, 12),
      from: peer(fromAgent),
      to: peer(toAgent),
      text: message,
      kind,
      status: 'sending',
      timestamp: Date.now(),
    };
    thread.turns.push(turn);

    // Only replay earlier turns when the recipient has LOST them. A running
    // agent already has this thread's history in its live session — re-injecting
    // it every exchange duplicates content and balloons context. A stopped agent
    // will be resumed/rotated (fresh context), so it needs the recap.
    const recipientHasContext =
      this.daemon.processes.isRunning(toAgent.id) || this.daemon.processes.hasAgentLoop(toAgent.id);
    const wrapped = this._wrap(thread, fromAgent, toAgent, message, kind, !recipientHasContext);

    let result;
    try {
      result = await deliverInstruction(this.daemon, toAgent.id, wrapped, { recordFeedback: false });
    } catch (err) {
      turn.status = 'failed';
      turn.error = err.message;
      thread.status = 'failed';
      this._broadcast(thread, turn);
      throw new Error(`Could not reach ${toAgent.name}: ${err.message}`);
    }

    // A stopped target gets resumed or rotated, minting a new agent id.
    const targetId = result.agentId;
    if (targetId !== toAgent.id) {
      this._remapParticipant(thread, toAgent.id, targetId);
      turn.to.id = targetId;
    }

    turn.status = result.status;
    thread.status = 'awaiting_reply';
    thread.updatedAt = Date.now();
    this._broadcast(thread, turn);

    // A queued message sits behind the target's current work, so the next
    // result belongs to that prior task, not to us — skip it.
    return { turn, targetId, skipResults: result.status === 'message_queued' ? 1 : 0 };
  }

  _openThread(fromAgent, toAgent, threadId) {
    const thread = threadId ? this.threads.get(threadId) : this._findThread(fromAgent.id, toAgent.id);
    return thread || this._createThread(fromAgent, toAgent);
  }

  _checkExchangeCap(thread, toAgent) {
    const used = thread.turns.filter((x) => x.kind === 'ask' || x.kind === 'tell').length;
    if (used >= MAX_EXCHANGES) {
      throw new Error(
        `This conversation has reached its ${MAX_EXCHANGES}-exchange limit. Stop consulting `
        + `${toAgent.name} and report your conclusion to the user.`,
      );
    }
  }

  _awaitReply(thread, askerId, targetId, { skipResults, timeoutMs }) {
    return new Promise((resolve, reject) => {
      const settle = (fn, value) => {
        this._clearAwait(targetId);
        this.blockedOn.delete(askerId);
        fn(value);
      };

      const record = {
        mode: 'block',
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
            + 'proceed on your own judgement, or use a non-blocking send (tell) next time.',
          ));
        }, timeoutMs),
      };

      this.awaiting.set(targetId, record);
      this.blockedOn.set(askerId, targetId);
    });
  }

  /**
   * Watch agent output for the reply to an outstanding message.
   * Called from the process manager's output handler.
   */
  onAgentOutput(agentId, output) {
    const pending = this.awaiting.get(agentId);
    if (!pending) return;
    if (output.type !== 'result') return;

    const thread = this.threads.get(pending.threadId);
    if (!thread) { this._settlePending(agentId, pending, null, new Error('Conversation was lost')); return; }

    const text = extractText(output.data);
    if (!text) return;

    // Burn off results belonging to work already underway when we queued.
    if (pending.skipResults > 0) {
      pending.skipResults -= 1;
      return;
    }

    const responder = this.daemon.registry.get(agentId);
    const answerTurn = {
      id: randomUUID().slice(0, 12),
      from: responder ? peer(responder) : { id: agentId, name: agentId, role: 'agent' },
      to: this._otherParticipant(thread, agentId),
      text,
      kind: 'answer',
      status: 'delivered',
      timestamp: Date.now(),
    };
    thread.turns.push(answerTurn);
    thread.status = 'idle';
    thread.updatedAt = Date.now();
    this._broadcast(thread, answerTurn);
    this.daemon.audit.log('innerchat.answer', { thread: thread.id, from: agentId });

    if (pending.mode === 'async') {
      this._clearAwait(agentId);
      this._forwardAsyncReply(pending, answerTurn, text);
    } else if (pending.mode === 'relay-async') {
      this._clearAwait(agentId);
      this._enqueueOutbox(pending, answerTurn, text);
    } else {
      pending.resolve(text);
    }
  }

  // Deliver an async (tell) reply back to the original sender, resuming it if
  // its turn has ended. The sender is not blocked, so this just wakes them.
  async _forwardAsyncReply(pending, answerTurn, text) {
    const sender = this.daemon.registry.get(pending.senderId)
      || this.daemon.registry.getAll().find((a) => a.name === answerTurn.to.name);
    if (!sender) return; // sender is gone — nothing to route back to

    const msg = [
      `[InnerChat reply from ${answerTurn.from.name} (${answerTurn.from.role})]`,
      '',
      text,
      '',
      'This is a reply to a message you sent earlier (you were not blocking on it). '
      + 'Fold it into your work, or reply again to continue.',
    ].join('\n');

    try {
      await deliverInstruction(this.daemon, sender.id, msg, { recordFeedback: false });
    } catch (err) {
      this.daemon.audit.log('innerchat.forward_failed', { to: sender.id, error: err.message });
    }
  }

  /**
   * An agent that dies mid-question would otherwise leave a blocking asker
   * stuck until timeout. Async senders aren't waiting, so just clear those.
   */
  onAgentGone(agentId, reason = 'stopped') {
    const pending = this.awaiting.get(agentId);
    if (!pending) return;
    if (pending.mode === 'async') { this._clearAwait(agentId); return; }
    const agent = this.daemon.registry.get(agentId);
    pending.reject(new Error(`${agent?.name || agentId} ${reason} before answering`));
  }

  _clearAwait(targetId) {
    const pending = this.awaiting.get(targetId);
    if (pending?.timer) clearTimeout(pending.timer);
    this.awaiting.delete(targetId);
  }

  _settlePending(agentId, pending, value, err) {
    if (pending.mode === 'async') { this._clearAwait(agentId); return; }
    if (err) pending.reject(err); else pending.resolve(value);
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
  // turns to follow a continuing conversation. The closing instruction differs
  // by kind: an ask blocks the sender (answer now), a tell does not (answer
  // when you reach a good stopping point).
  _wrap(thread, fromAgent, toAgent, message, kind = 'ask', includePrior = true) {
    const header = kind === 'tell'
      ? `[InnerChat — ${fromAgent.name} (${fromAgent.role}) sent you a message]`
      : `[InnerChat — ${fromAgent.name} (${fromAgent.role}) is asking you a question]`;
    const prior = includePrior ? thread.turns.slice(0, -1).slice(-CONTEXT_TURNS) : [];
    const lines = [header, ''];

    if (prior.length) {
      lines.push('Earlier in this conversation:');
      for (const t of prior) lines.push(`  ${t.from.name}: ${truncate(t.text, MAX_TURN_CHARS)}`);
      lines.push('');
    }

    lines.push(message, '');
    if (kind === 'tell') {
      lines.push(
        `${fromAgent.name} is NOT blocked on this — finish what you're doing first if you're `
        + 'mid-task. When you reach a good stopping point, answer directly in a message; your '
        + `reply is relayed back to ${fromAgent.name}. If no reply is needed, just carry on.`,
      );
    } else {
      lines.push(
        `${fromAgent.name} is BLOCKED waiting on your answer — it cannot continue until you `
        + 'respond. Answer directly and concisely in your next message; that message is sent '
        + 'back to it verbatim. Do not address the user, and do not start unrelated work first.',
      );
    }
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

  // ── Cross-daemon relay ──────────────────────────────────────
  //
  // A `name@alias` target routes here. The sending side (askRemote/tellRemote)
  // signs the request with this daemon's federation key and POSTs it to the
  // peer; the answering side (receiveRelay) verifies the signer, resolves the
  // name in its OWN registry, and delivers through the normal InnerChat pipe
  // with a guest identity so caps, threads, and audit all work unchanged.

  // True when `to` names a peer. Lets the route layer branch cheaply.
  isRemoteRef(to) {
    const parsed = parsePeerRef(to);
    return !!(parsed && parsed.alias);
  }

  // Ask an agent on a peer daemon and BLOCK for its reply (relayed over the
  // still-open HTTP response — one-way transport suffices for ask/reply).
  async askRemote(fromAgent, toName, alias, message, opts = {}) {
    const peer = this._requirePeer(alias);
    const envelope = this._signRelay('ask', fromAgent, toName, message);
    const { ok, status, json } = await this._sendRelay(peer, envelope, opts.timeoutMs);
    if (!ok) throw new Error(json?.error || `Peer "${alias}" refused the relay (HTTP ${status})`);
    this.daemon.audit.log('innerchat.relay.ask', { peer: alias, from: fromAgent.name, to: toName });
    return { reply: json.reply, remote: true, peer: alias, threadId: json.threadId };
  }

  // Send to an agent on a peer daemon WITHOUT blocking. The reply, if any, is
  // queued in the peer's outbox and picked up by our poller, then delivered
  // back to the local sender — keeping the one-way topology sufficient.
  async tellRemote(fromAgent, toName, alias, message) {
    const peer = this._requirePeer(alias);
    const envelope = this._signRelay('tell', fromAgent, toName, message);
    const { ok, status, json } = await this._sendRelay(peer, envelope);
    if (!ok) throw new Error(json?.error || `Peer "${alias}" refused the relay (HTTP ${status})`);
    this.daemon.audit.log('innerchat.relay.tell', { peer: alias, from: fromAgent.name, to: toName });
    this._ensureOutboxPoll(peer);
    return { delivered: true, remote: true, peer: alias, threadId: json.threadId };
  }

  _requirePeer(alias) {
    const peer = this._peerByAlias(alias);
    if (!peer) {
      const aliases = this._peers().map((p) => p.alias);
      throw new Error(
        `No configured InnerChat peer "${alias}".`
        + (aliases.length ? ` Known peers: ${aliases.join(', ')}.` : ' No peers are configured.'),
      );
    }
    return peer;
  }

  _signRelay(kind, fromAgent, toName, message) {
    const signed = this.daemon.federation.sign({
      v: 1,
      type: 'innerchat.relay',
      kind,
      fromName: fromAgent.name,
      fromRole: fromAgent.role,
      fromDaemonId: this._daemonId(),
      toName,
      message,
    });
    return { payload: signed.payload, signature: signed.signature };
  }

  _sendRelay(peer, envelope, timeoutMs) {
    return this.relay.sendRelay(peer.url, envelope, timeoutMs);
  }

  /**
   * Receive a relayed ask/tell from a peer daemon. The route layer has already
   * verified the signature and confirmed the sender is a configured peer, and
   * passes the peer's alias for display. Resolves the target in the LOCAL
   * registry and delivers with a guest sender identity.
   *
   * For 'ask' this resolves with the local agent's reply text (relayed back on
   * the open response). For 'tell' it resolves once delivered; the reply is
   * later queued to the outbox for the sending daemon.
   */
  async receiveRelay({ fromName, fromRole, fromDaemonId, peerAlias, toName, message, kind, threadId, timeoutMs }) {
    // One hop only: a `name@peer` target here would be a second relay. Refuse
    // before resolving, so it reads as "transitive" not "no such agent".
    if (String(toName).includes('@')) throw new Error('Transitive relay refused — InnerChat is one hop only.');
    const toAgent = this._resolveLocal(toName);
    if (!toAgent) {
      const names = this.daemon.registry.getAll().map((a) => a.name);
      const err = new Error(`No agent named "${toName}" on this daemon.`);
      err.availableAgents = names;
      throw err;
    }
    if (this.awaiting.has(toAgent.id)) {
      throw new Error(`${toAgent.name} is already answering another message — try again shortly.`);
    }
    if (!message || !message.trim()) throw new Error('message is required');

    const guest = {
      id: `guest:${fromDaemonId}:${fromName}`,
      name: peerAlias ? `${fromName}@${peerAlias}` : fromName,
      role: fromRole || 'remote-agent',
      remote: { daemonId: fromDaemonId, fromName },
    };

    const t = this._openThread(guest, toAgent, threadId);
    this._checkExchangeCap(t, toAgent);

    const { targetId, skipResults } = await this._deliver(t, guest, toAgent, message.trim(), kind);

    if (kind === 'tell') {
      this.awaiting.set(targetId, {
        mode: 'relay-async',
        threadId: t.id,
        remote: { forDaemonId: fromDaemonId, fromName },
        skipResults,
        timer: setTimeout(() => this._clearAwait(targetId), MAX_TIMEOUT_MS),
      });
      return { delivered: true, threadId: t.id };
    }

    const reply = await this._awaitReply(t, guest.id, targetId, {
      skipResults,
      timeoutMs: Math.min(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
    });
    return { reply, threadId: t.id };
  }

  // Local-only resolution mirroring the route resolver: exact id/name first,
  // then a single unambiguous partial. Never reaches across daemons (one hop).
  _resolveLocal(ref) {
    const all = this.daemon.registry.getAll();
    const needle = String(ref || '').trim().toLowerCase();
    const exact = all.find((a) => a.id === ref)
      || all.find((a) => a.name === ref)
      || all.find((a) => a.name.toLowerCase() === needle);
    if (exact) return exact;
    const partial = all.filter((a) => a.name.toLowerCase() === needle
      || a.name.toLowerCase().includes(needle));
    return partial.length === 1 ? partial[0] : null;
  }

  // ── Outbox (async relay replies) ────────────────────────────

  _enqueueOutbox(pending, answerTurn, text) {
    this.relayOutbox.push({
      id: randomUUID().slice(0, 12),
      forDaemonId: pending.remote.forDaemonId,
      toName: pending.remote.fromName,          // the remote agent that asked
      fromName: answerTurn.from.name,            // the local agent that answered
      fromDaemonId: this._daemonId(),
      text,
      threadId: pending.threadId,
      ts: Date.now(),
    });
    this.daemon.audit.log('innerchat.relay.queued', { for: pending.remote.forDaemonId, from: answerTurn.from.name });
  }

  // Drain and remove outbox entries destined for a given daemon (at-least-once:
  // removed on read). Called by the relay/outbox route after verifying the caller.
  drainOutbox(forDaemonId) {
    const mine = this.relayOutbox.filter((e) => e.forDaemonId === forDaemonId);
    if (mine.length) this.relayOutbox = this.relayOutbox.filter((e) => e.forDaemonId !== forDaemonId);
    return mine;
  }

  // Sender-side: poll a peer for queued replies until they stop arriving.
  _ensureOutboxPoll(peer) {
    const existing = this._outboxPollers.get(peer.alias);
    if (existing) { existing.idle = 0; return; }

    const state = { idle: 0, busy: false, timer: null };
    const tick = async () => {
      if (state.busy) return;
      state.busy = true;
      try {
        const entries = await this._pollOutbox(peer);
        if (entries.length) {
          state.idle = 0;
          for (const e of entries) await this._deliverRemoteReply(peer, e);
        } else {
          state.idle += 1;
        }
      } catch { state.idle += 1; }
      finally { state.busy = false; }
      if (state.idle >= OUTBOX_IDLE_STOP) this._stopOutboxPoll(peer.alias);
    };
    state.timer = setInterval(tick, OUTBOX_POLL_MS);
    if (state.timer.unref) state.timer.unref();
    this._outboxPollers.set(peer.alias, state);
  }

  async _pollOutbox(peer) {
    const signed = this.daemon.federation.sign({ v: 1, type: 'innerchat.outbox', fromDaemonId: this._daemonId() });
    const { json } = await this.relay.fetchOutbox(peer.url, { payload: signed.payload, signature: signed.signature }, 5000);
    return Array.isArray(json?.entries) ? json.entries : [];
  }

  _stopOutboxPoll(alias) {
    const state = this._outboxPollers.get(alias);
    if (state?.timer) clearInterval(state.timer);
    this._outboxPollers.delete(alias);
  }

  // Deliver a peer's async reply to the local agent that sent the original tell.
  async _deliverRemoteReply(peer, entry) {
    const sender = this._resolveLocal(entry.toName);
    if (!sender) {
      this.daemon.audit.log('innerchat.relay.reply_undeliverable', { to: entry.toName, peer: peer.alias });
      return;
    }
    const msg = [
      `[InnerChat reply from ${entry.fromName}@${peer.alias}]`,
      '',
      entry.text,
      '',
      'This is a reply to a message you sent earlier to a peer agent (you were not '
      + 'blocking on it). Fold it into your work, or reply again to continue.',
    ].join('\n');
    try {
      await deliverInstruction(this.daemon, sender.id, msg, { recordFeedback: false });
    } catch (err) {
      this.daemon.audit.log('innerchat.relay.reply_failed', { to: sender.id, error: err.message });
    }
  }

  // Clear all outstanding timers so a shutdown (or a test) doesn't hang on
  // pending ask/tell timeouts. Blocking asks are rejected so their HTTP
  // requests don't hang either.
  stop() {
    for (const [targetId, pending] of this.awaiting) {
      if (pending.timer) clearTimeout(pending.timer);
      if (pending.mode === 'block') {
        try { pending.reject(new Error('Daemon shutting down')); } catch { /* already settled */ }
      }
      this.awaiting.delete(targetId);
    }
    this.blockedOn.clear();
    for (const alias of [...this._outboxPollers.keys()]) this._stopOutboxPoll(alias);
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
