// FSL-1.1-Apache-2.0 — see LICENSE

import { wrapWithRoleReminder } from './process.js';
import { getProvider } from './providers/index.js';
import { innerChatInstructions } from './innerchat-docs.js';

// Reviving a >5M-token claude session has crashed the CLI mid-HTTP-parse
// (V8 fatal in JsonStringifier) — past this ceiling the rotator's handoff
// brief sidesteps the resume entirely.
const SESSION_RESUME_CEILING = 5_000_000;

/**
 * Deliver a message to an agent, whatever state it's in.
 *
 * This is the single pipe every inbound message travels — user chat from the
 * GUI and InnerChat relays alike. Handles agent-loop delivery, one-shot and
 * non-interactive providers, queueing behind a running task, session resume,
 * and full rotation when the session is too large to revive.
 *
 * Respawn paths mint a NEW agent id. Callers that track the agent afterwards
 * (InnerChat keys response capture on it) must use the returned `agentId`,
 * not the one they passed in.
 *
 * @returns {Promise<{agentId: string, status: string, resumed: boolean, agent: object|null}>}
 */
export async function deliverInstruction(daemon, agentId, message, opts = {}) {
  const { recordFeedback = true } = opts;

  const agent = daemon.registry.get(agentId);
  if (!agent) throw new Error('Agent not found');

  const finalMessage = message.trim();
  if (!finalMessage) throw new Error('message is required');

  // Journalist/rotator treat this as a human steering signal — InnerChat
  // relays opt out so agent-to-agent chatter doesn't pollute user feedback.
  if (recordFeedback) {
    if (daemon.journalist) daemon.journalist.recordUserFeedback(agent, finalMessage);
    if (daemon.rotator) daemon.rotator.recordUserMessage(agentId);
  }

  // Prepend a fresh wall-clock anchor so the agent gauges progress by real time
  // and the user's direction, not by how much context has piled up.
  const clock = daemon.processes.sessionClock?.(agent);
  const timedMessage = clock ? `${clock}\n\n${finalMessage}` : finalMessage;
  // Spawn-prompt capabilities scroll out of a long session, after which the
  // agent denies it can reach other agents at all. This rides every turn, so
  // it cannot decay — terse by default, expanded when the turn actually asks
  // the agent to contact someone.
  const reach = agentReachHint(daemon, agent, finalMessage);
  const wrappedMessage = wrapWithRoleReminder(agent.role, reach ? `${reach}\n\n${timedMessage}` : timedMessage);

  // Agent loop path — send straight to the running loop.
  if (daemon.processes.hasAgentLoop(agentId)) {
    const sent = await daemon.processes.sendMessage(agentId, wrappedMessage);
    if (sent) {
      daemon.audit.log('agent.chat', { id: agentId });
      return { agentId, status: 'message_sent', resumed: false, agent };
    }
    // Loop exists but isn't running — fall through to resume/rotate.
  }

  const provider = getProvider(agent.provider);

  // One-shot providers (groove-network): kill any running instance and respawn
  // with the message as --prompt. No handoff brief, no resume, no queue.
  if (provider?.constructor?.isOneShot) {
    const oldConfig = { ...agent };
    if (daemon.processes.isRunning(agentId)) {
      await daemon.processes.kill(agentId);
    }
    daemon.registry.remove(agentId, { silent: true });
    daemon.locks.release(agentId);

    const newAgent = await respawn(daemon, {
      role: oldConfig.role,
      scope: oldConfig.scope,
      provider: oldConfig.provider,
      model: oldConfig.model,
      prompt: finalMessage,
      permission: oldConfig.permission || 'full',
      workingDir: oldConfig.workingDir,
      name: oldConfig.name,
      teamId: oldConfig.teamId,
    });
    daemon.audit.log('agent.instruct', { id: agentId, newId: newAgent.id, resumed: false });
    return { agentId: newAgent.id, status: 'respawned', resumed: false, agent: newAgent };
  }

  // Non-interactive CLI providers (e.g. Gemini): one prompt per spawn, cannot
  // resume — respawn preserving the original introContext.
  if (provider?.constructor?.nonInteractive && !daemon.processes.isRunning(agentId)) {
    const oldConfig = { ...agent };
    daemon.registry.remove(agentId, { silent: true });
    daemon.locks.release(agentId);

    const newAgent = await respawn(daemon, {
      role: oldConfig.role,
      scope: oldConfig.scope,
      provider: oldConfig.provider,
      model: oldConfig.model,
      prompt: finalMessage,
      introContext: oldConfig.introContext,
      permission: oldConfig.permission || 'full',
      workingDir: oldConfig.workingDir,
      name: oldConfig.name,
      teamId: oldConfig.teamId,
    });
    daemon.audit.log('agent.instruct', { id: agentId, newId: newAgent.id, resumed: false });
    return { agentId: newAgent.id, status: 'respawned', resumed: false, agent: newAgent };
  }

  // Running CLI agent (no loop) — queue behind the current task rather than
  // killing and respawning mid-work.
  if (daemon.processes.isRunning(agentId)) {
    daemon.processes.queueMessage(agentId, wrappedMessage);
    daemon.audit.log('agent.chat.queued', { id: agentId });
    return { agentId, status: 'message_queued', resumed: false, agent };
  }

  // Stopped CLI agent — resume the session, or rotate past the ceiling.
  const resumed = !!agent.sessionId && (agent.tokensUsed || 0) < SESSION_RESUME_CEILING;
  const newAgent = resumed
    ? await daemon.processes.resume(agentId, wrappedMessage)
    : await daemon.rotator.rotate(agentId, { additionalPrompt: wrappedMessage });

  daemon.audit.log('agent.instruct', { id: agentId, newId: newAgent.id, resumed });
  return { agentId: newAgent.id, status: resumed ? 'resumed' : 'rotated', resumed, agent: newAgent };
}

// Spawn, flushing the registry's pending removals if it fails so a failed
// respawn doesn't silently erase the agent it was replacing.
async function respawn(daemon, config) {
  try {
    return await daemon.processes.spawn(config);
  } catch (spawnErr) {
    daemon.registry.flushPendingRemovals();
    throw spawnErr;
  }
}

// Phrases that mean "go talk to another agent". Deliberately broad: a false
// positive costs a few tokens of accurate instruction, a false negative costs
// the user a turn spent watching their agent claim the capability isn't real.
const CONTACT_INTENT = /\b(ask|message|msg|tell|consult|coordinate|check|sync|reach out|talk|speak|ping|liaise|confer|follow up|loop in)\b/i;

// Naming the feature is an EXPLICIT request for it — usually typed after the
// agent has already failed to find it. That earns the full instructions
// verbatim, not a hint: no inference, no heuristic that can miss. Matches
// innerchat / inner chat / inner-chat / InnerChat, and the CLI verbs by name.
const INNERCHAT_KEYWORD = /\b(inner[\s_-]?chat|groove\s+(?:ask|tell|who))\b/i;

/**
 * A capability line appended to every delivered turn.
 *
 * Spawn-time instructions decay — on a long session (or under a model that
 * compacts aggressively) they scroll away, and the agent then insists it has
 * no way to contact anyone, or reaches for a built-in sub-agent tool that
 * cannot see GROOVE agents. Two tiers:
 *
 *   - Always: one terse line naming the CLI verbs. ~20 tokens.
 *   - When the turn expresses intent to contact someone: the exact command,
 *     with the target's real name already filled in.
 */
export function agentReachHint(daemon, agent, message) {
  let others;
  try {
    others = (daemon.registry.getAll() || []).filter((a) => a.name !== agent.name);
  } catch { return null; }

  const peers = Array.isArray(daemon.config?.innerchatPeers) ? daemon.config.innerchatPeers : [];
  if (!others.length && !peers.length) return null;

  const base = '[You can talk to other GROOVE agents: `groove ask <name> "<question>"` waits for their '
    + 'answer, `groove tell <name> "<message>"` does not. `groove who` lists who is reachable. '
    + 'Your own built-in sub-agent/task tools CANNOT reach them.]';

  const explicit = INNERCHAT_KEYWORD.test(message);
  if (!explicit && !CONTACT_INTENT.test(message)) return base;

  // Name the agent the user is actually pointing at, so the model has a
  // runnable command rather than a template it has to fill in from memory.
  const lower = message.toLowerCase();
  const named = others.filter((a) => lower.includes(a.name.toLowerCase()));
  const target = named.length === 1 ? named[0] : null;

  const lines = [
    '[REACHING ANOTHER AGENT — this capability is real and available right now.]',
  ];
  if (explicit) {
    // The user named the feature. Say plainly that it exists, since the usual
    // failure is the agent asserting it doesn't and stopping there.
    lines.push(
      'The user explicitly asked you to use InnerChat. It exists, it is wired up, and the',
      'commands below work from your shell right now. Do not tell the user the feature is',
      'unavailable and do not ask them how to use it — run the command.',
      '',
    );
  }
  if (target) {
    lines.push(
      `To contact ${target.name}, run exactly:`,
      `    groove ask ${target.name} "your question here"`,
      'That blocks until they answer and prints their reply. Use `groove tell` instead if you '
      + 'do not need the answer before continuing.',
    );
  } else {
    lines.push(
      '    groove who                         — list who is reachable',
      '    groove ask <name> "<question>"     — blocks until they answer, prints the reply',
      '    groove tell <name> "<message>"     — returns immediately',
      `Agents reachable now: ${others.map((a) => a.name).join(', ') || '(none)'}`,
    );
  }
  if (peers.length) {
    lines.push(`Agents on peer machines use name@peer (peers: ${peers.map((p) => p.alias).join(', ')}).`);
  }
  lines.push(
    'Do NOT use your built-in sub-agent/Task/SendMessage tools for this — they cannot see GROOVE '
    + 'agents and will fail. If a name is wrong the command tells you the valid ones; read it and retry.',
  );

  // Explicit request → re-attach the full reference, so the agent has the
  // complete semantics (blocking vs not, exchange budget, peer addressing)
  // even if the spawn prompt scrolled away long ago.
  if (explicit) {
    lines.push(
      '',
      '--- Full reference (re-sent because you asked for InnerChat by name) ---',
      ...innerChatInstructions(daemon.port || 31415, agent.name, peers),
    );
  }
  return lines.join('\n');
}
