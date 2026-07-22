// FSL-1.1-Apache-2.0 — see LICENSE

import { wrapWithRoleReminder } from './process.js';
import { getProvider } from './providers/index.js';

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

  const wrappedMessage = wrapWithRoleReminder(agent.role, finalMessage);

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
