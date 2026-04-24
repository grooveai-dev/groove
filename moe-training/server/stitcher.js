// FSL-1.1-Apache-2.0 — see LICENSE

export class TrajectoryStitcher {
  constructor(storage) {
    this.storage = storage;
  }

  stitch(sessionId) {
    const envelopes = this.storage.getSessionEnvelopes(sessionId);
    if (!envelopes.length) return null;

    const chunks = envelopes
      .filter(e => e.type !== 'SESSION_CLOSE')
      .sort((a, b) => (a.chunk_sequence ?? 0) - (b.chunk_sequence ?? 0));

    const closeEnvelope = envelopes.find(e => e.type === 'SESSION_CLOSE');
    const firstChunk = chunks[0];
    if (!firstChunk) return null;

    const allSteps = [];
    for (const chunk of chunks) {
      if (Array.isArray(chunk.trajectory_log)) {
        allSteps.push(...chunk.trajectory_log);
      }
    }

    allSteps.sort((a, b) => a.step - b.step);

    const toolsUsed = new Set();
    const stepTypeCounts = {};
    let totalTokens = 0;

    for (const step of allSteps) {
      if (step.tool) toolsUsed.add(step.tool);
      stepTypeCounts[step.type] = (stepTypeCounts[step.type] || 0) + 1;
      totalTokens += step.token_count || 0;
    }

    return {
      session_id: sessionId,
      contributor_id: firstChunk.contributor_id,
      metadata: firstChunk.metadata || {},
      trajectory_log: allSteps,
      outcome: closeEnvelope?.outcome || null,
      total_steps: allSteps.length,
      total_tokens: totalTokens,
      unique_tools_used: [...toolsUsed],
      step_type_distribution: stepTypeCounts,
      total_chunks: chunks.length,
    };
  }

  linkCoordination(trajectory) {
    if (!trajectory || !trajectory.trajectory_log) return trajectory;

    const coordSteps = trajectory.trajectory_log.filter(s => s.type === 'coordination' && s.coordination_id);

    for (const step of coordSteps) {
      step.coordination_partner = {
        coordination_id: step.coordination_id,
        direction: step.direction,
        target_agent: step.target_agent || null,
        linked: true,
      };
    }

    return trajectory;
  }
}
