// FSL-1.1-Apache-2.0 — see LICENSE

const ERROR_SIGNAL_RE = /\b(?:error|Error|ERROR|exception|Exception|EXCEPTION|failed|FAILED|exit code [1-9]|ENOENT|EACCES|EPERM|TypeError|ReferenceError|SyntaxError|Cannot find|Module not found|Command failed|non-zero exit)\b/;
const FIX_SIGNAL_RE = /\b(?:fix|correcting|I see the issue|let me fix|the (?:issue|problem|bug) (?:is|was)|instead I should|my mistake)\b/i;

export class StepClassifier {
  constructor() {
    this.hasAgentActed = false;
    this._lastStepType = null;
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

    const content = step.content || '';

    if ((step.type === 'action' || step.type === 'observation') && ERROR_SIGNAL_RE.test(content)) {
      step.type = 'error';
    }

    if (step.type === 'thought' && this._lastStepType === 'correction' && FIX_SIGNAL_RE.test(content)) {
      step.correction_context = true;
    }

    this._lastStepType = step.type;
    return step;
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
