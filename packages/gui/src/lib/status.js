// FSL-1.1-Apache-2.0 — see LICENSE
// Single source of truth for agent status colors + role colors

export const STATUS_COLORS = {
  running:   'var(--color-success)',
  starting:  'var(--color-warning)',
  stopped:   'var(--color-text-3)',
  crashed:   'var(--color-danger)',
  completed: 'var(--color-accent)',
  killed:    'var(--color-text-3)',
  rotating:  'var(--color-purple)',
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

export const ROLE_COLORS = {
  planner:    { bg: 'rgba(74, 225, 104, 0.12)', text: '#4ae168',  border: '#4ae168' },
  backend:    { bg: 'rgba(51, 175, 188, 0.12)', text: '#33afbc',  border: '#33afbc' },
  frontend:   { bg: 'rgba(229, 192, 123, 0.12)', text: '#e5c07b', border: '#e5c07b' },
  fullstack:  { bg: 'rgba(74, 225, 104, 0.12)', text: '#4ae168',  border: '#4ae168' },
  testing:    { bg: 'rgba(97, 175, 239, 0.12)', text: '#61afef',  border: '#61afef' },
  devops:     { bg: 'rgba(209, 154, 102, 0.12)', text: '#d19a66', border: '#d19a66' },
  docs:       { bg: 'rgba(139, 146, 158, 0.12)', text: '#8b929e', border: '#8b929e' },
  security:   { bg: 'rgba(224, 108, 117, 0.12)', text: '#e06c75', border: '#e06c75' },
  database:   { bg: 'rgba(198, 120, 221, 0.12)', text: '#c678dd', border: '#c678dd' },
  cmo:        { bg: 'rgba(229, 192, 123, 0.12)', text: '#e5c07b', border: '#e5c07b' },
  cfo:        { bg: 'rgba(74, 225, 104, 0.12)', text: '#4ae168',  border: '#4ae168' },
  ea:         { bg: 'rgba(97, 175, 239, 0.12)', text: '#61afef',  border: '#61afef' },
  support:    { bg: 'rgba(51, 175, 188, 0.12)', text: '#33afbc',  border: '#33afbc' },
  analyst:    { bg: 'rgba(198, 120, 221, 0.12)', text: '#c678dd', border: '#c678dd' },
  creative:   { bg: 'rgba(229, 192, 123, 0.12)', text: '#e5c07b', border: '#e5c07b' },
  slides:     { bg: 'rgba(209, 154, 102, 0.12)', text: '#d19a66', border: '#d19a66' },
};

export function roleColor(role) {
  const lower = (role || '').toLowerCase();
  return ROLE_COLORS[lower] || { bg: 'rgba(139, 146, 158, 0.12)', text: '#8b929e', border: '#8b929e' };
}

export function contextColor(pct) {
  if (pct >= 80) return 'var(--color-danger)';
  if (pct >= 60) return 'var(--color-warning)';
  return 'var(--color-success)';
}
