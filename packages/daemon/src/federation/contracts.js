// GROOVE — Federation Diplomatic Pouch Contracts
// FSL-1.1-Apache-2.0 — see LICENSE

const CONTRACT_SCHEMAS = {
  'task-request': {
    required: ['taskId', 'description', 'requesterRole'],
    optional: ['priority', 'suggestedRole', 'context', 'deadline'],
  },
  'task-accepted': {
    required: ['taskId', 'assignedAgentId', 'assignedRole'],
    optional: ['estimatedCompletion'],
  },
  'task-rejected': {
    required: ['taskId', 'reason'],
    optional: ['suggestion'],
  },
  'status-update': {
    required: ['taskId', 'status'],
    optional: ['progress', 'details', 'blockers'],
  },
  'delivery': {
    required: ['taskId', 'result'],
    optional: ['artifacts', 'summary', 'followUp'],
  },
  'question': {
    required: ['questionId', 'text'],
    optional: ['taskId', 'context', 'urgency'],
  },
  'capability-query': {
    required: [],
    optional: ['filter'],
  },
  'capability-response': {
    required: ['roles', 'providerCount', 'agentCount'],
    optional: ['availableRoles', 'busyAgents'],
  },
};

const VALID_TYPES = new Set(Object.keys(CONTRACT_SCHEMAS));

export function validateContract(contract) {
  if (!contract || typeof contract !== 'object') {
    return { valid: false, error: 'Contract must be an object' };
  }
  if (!contract.type || !VALID_TYPES.has(contract.type)) {
    return { valid: false, error: `Invalid contract type: ${contract.type}` };
  }
  if (!contract.spec || typeof contract.spec !== 'object') {
    return { valid: false, error: 'Contract must have a spec object' };
  }

  const schema = CONTRACT_SCHEMAS[contract.type];
  for (const field of schema.required) {
    if (contract.spec[field] === undefined || contract.spec[field] === null) {
      return { valid: false, error: `Missing required field: spec.${field}` };
    }
  }

  return { valid: true };
}

export function getContractTypes() {
  return Object.keys(CONTRACT_SCHEMAS);
}

export class ContractHandlerRegistry {
  constructor() {
    this.handlers = new Map();
  }

  register(type, handler) {
    if (!VALID_TYPES.has(type)) {
      throw new Error(`Cannot register handler for unknown type: ${type}`);
    }
    this.handlers.set(type, handler);
  }

  async handle(contract, context) {
    const validation = validateContract(contract);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const handler = this.handlers.get(contract.type);
    if (!handler) {
      throw new Error(`No handler registered for type: ${contract.type}`);
    }

    return handler(contract, context);
  }

  has(type) {
    return this.handlers.has(type);
  }
}

export function createCapabilityResponse(daemon) {
  const agents = daemon.registry.getAll();
  const roles = new Set(agents.map(a => a.role));
  const busy = agents.filter(a => a.status === 'running');

  return {
    type: 'capability-response',
    spec: {
      roles: Array.from(roles),
      providerCount: agents.reduce((s, a) => { s.add(a.provider); return s; }, new Set()).size,
      agentCount: agents.length,
      availableRoles: Array.from(roles),
      busyAgents: busy.length,
    },
  };
}
