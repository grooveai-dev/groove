// FSL-1.1-Apache-2.0 — see LICENSE

export class StepClassifier {
  constructor() {
    this.hasAgentActed = false;
  }

  classifyUserMessage(text) {
    if (!this.hasAgentActed) {
      return null;
    }
    return {
      type: 'correction',
      content: text,
      source: 'user',
    };
  }

  classifyCoordinationEvent(event) {
    return {
      type: 'coordination',
      coordination_id: event.coordination_id || event.id || '',
      direction: event.direction || (event.source ? 'inbound' : 'outbound'),
      target_agent: event.target_agent || event.targetAgent || '',
      protocol: event.protocol || 'knock',
      content: event.content || event.message || '',
    };
  }

  onStep(step) {
    if (step.type === 'action') {
      this.hasAgentActed = true;
    }
  }

  static detectErrorRecovery(steps) {
    for (let i = 0; i < steps.length - 1; i++) {
      if (steps[i].type === 'error') {
        for (let j = i + 1; j < steps.length; j++) {
          if (steps[j].type === 'resolution') return true;
          if (steps[j].type === 'error') break;
        }
      }
    }
    return false;
  }

  static countUserInterventions(steps) {
    return steps.filter((s) => s.type === 'correction').length;
  }
}
