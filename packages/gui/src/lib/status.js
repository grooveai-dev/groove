// FSL-1.1-Apache-2.0 — see LICENSE
// Single source of truth for agent status colors + role colors

export const STATUS_COLORS = {
  running:   'var(--color-accent)',
  starting:  'var(--color-text-3)',
  stopped:   'var(--color-text-3)',
  crashed:   'var(--color-danger)',
  completed: 'var(--color-accent)',
  killed:    'var(--color-text-3)',
  rotating:  'var(--color-accent)',
};

export const STATUS_LABELS = {
  running:   'Running',
  starting:  'Starting',
  stopped:   'Stopped',
  crashed:   'Crashed',
  completed: 'Done',
  killed:    'Killed',
  rotating:  'Rotating',
};

export function statusColor(status) {
  return STATUS_COLORS[status] || 'var(--color-text-3)';
}

const NEUTRAL_ROLE = { bg: 'rgba(139,146,158,0.08)', text: '#8b929e', border: '#8b929e' };

export const ROLE_COLORS = {
  planner:    NEUTRAL_ROLE,
  backend:    NEUTRAL_ROLE,
  frontend:   NEUTRAL_ROLE,
  fullstack:  NEUTRAL_ROLE,
  testing:    NEUTRAL_ROLE,
  devops:     NEUTRAL_ROLE,
  docs:       NEUTRAL_ROLE,
  security:   NEUTRAL_ROLE,
  database:   NEUTRAL_ROLE,
  cmo:        NEUTRAL_ROLE,
  cfo:        NEUTRAL_ROLE,
  ea:         NEUTRAL_ROLE,
  support:    NEUTRAL_ROLE,
  analyst:    NEUTRAL_ROLE,
  creative:   NEUTRAL_ROLE,
  slides:     NEUTRAL_ROLE,
  chat:       NEUTRAL_ROLE,
};

export function roleColor(role) {
  const lower = (role || '').toLowerCase();
  return ROLE_COLORS[lower] || { bg: 'rgba(139, 146, 158, 0.12)', text: '#8b929e', border: '#8b929e' };
}

export function contextColor() {
  return 'var(--color-accent)';
}
