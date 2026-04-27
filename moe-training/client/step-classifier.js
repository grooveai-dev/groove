// FSL-1.1-Apache-2.0 — see LICENSE

const ERROR_SIGNAL_RE = /\b(?:error|Error|ERROR|exception|Exception|EXCEPTION|failed|FAILED|exit code [1-9]|ENOENT|EACCES|EPERM|TypeError|ReferenceError|SyntaxError|Cannot find|Module not found|Command failed|non-zero exit)\b/;
const FIX_SIGNAL_RE = /\b(?:fix|correcting|I see the issue|let me fix|the (?:issue|problem|bug) (?:is|was)|instead I should|my mistake)\b/i;

const CORRECTION_RE = /\b(?:no[,. ](?:that|not|don't|wrong)|that'?s (?:not|wrong|incorrect)|don'?t do that|stop (?:doing|that)|instead (?:of|do)|undo|revert|go back|try (?:again|differently)|you (?:broke|missed|forgot))\b/i;
const APPROVAL_RE = /\b(?:looks? good|lgtm|approved?|go ahead|ship it|that'?s (?:right|correct|perfect)|perfect|exactly right|nice work|well done|great job)\b/i;
const CLARIFICATION_RE = /\b(?:what (?:about|I (?:mean|want))|I meant|to (?:be clear|clarify)|let me (?:rephrase|explain)|clarif(?:y|ication)|more specifically)\b/i;

export class StepClassifier {
  constructor() {
    this.hasAgentActed = false;
    this._lastStepType = null;
  }

  classifyUserMessage(text, source = 'user') {
    if (!this.hasAgentActed) {
      return {
        type: 'instruction',
        content: text,
        source,
      };
    }
    return {
      type: StepClassifier.classifyIntent(text),
      content: text,
      source,
    };
  }

  static classifyIntent(text) {
    if (!text || typeof text !== 'string') return 'instruction';
    if (CORRECTION_RE.test(text)) return 'correction';
    if (APPROVAL_RE.test(text)) return 'approval';
    if (CLARIFICATION_RE.test(text)) return 'clarification';
    return 'instruction';
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

    if ((step.type === 'action' || step.type === 'observation') && step.is_error !== false && ERROR_SIGNAL_RE.test(content)) {
      step.type = 'error';
    }

    if (step.type === 'thought' && (this._lastStepType === 'correction' || this._lastStepType === 'instruction') && FIX_SIGNAL_RE.test(content)) {
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
    return steps.filter((s) => s.type === 'correction' || s.type === 'clarification').length;
  }
}
