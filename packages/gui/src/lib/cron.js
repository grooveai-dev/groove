// FSL-1.1-Apache-2.0 — see LICENSE

export const CRON_PRESETS = [
  { label: 'Every hour', cron: '0 * * * *', description: 'Runs at the start of every hour' },
  { label: 'Every morning', cron: '0 9 * * *', description: 'Daily at 9:00 AM' },
  { label: 'Twice daily', cron: '0 9,17 * * *', description: '9:00 AM and 5:00 PM' },
  { label: 'Every weekday', cron: '0 9 * * 1-5', description: 'Monday-Friday at 9:00 AM' },
  { label: 'Mon & Thu', cron: '0 9 * * 1,4', description: 'Monday and Thursday at 9:00 AM' },
  { label: 'Weekly', cron: '0 9 * * 1', description: 'Every Monday at 9:00 AM' },
  { label: 'Monthly', cron: '0 9 1 * *', description: '1st of each month at 9:00 AM' },
];

const presetMap = new Map(CRON_PRESETS.map((p) => [p.cron, p.description]));

export function cronToHuman(expr) {
  if (!expr) return '';
  const trimmed = expr.trim();
  const match = presetMap.get(trimmed);
  if (match) return match;
  return trimmed;
}

const FIELD_RANGES = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
];

function validateField(value, range) {
  if (value === '*') return null;
  if (/^\*\/\d+$/.test(value)) {
    const step = parseInt(value.slice(2), 10);
    if (step < 1 || step > range.max) return `Invalid step ${step} for ${range.name}`;
    return null;
  }
  const parts = value.split(',');
  for (const part of parts) {
    if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(Number);
      if (isNaN(lo) || isNaN(hi) || lo < range.min || hi > range.max || lo > hi) {
        return `Invalid range ${part} for ${range.name} (${range.min}-${range.max})`;
      }
    } else {
      const n = Number(part);
      if (isNaN(n) || n < range.min || n > range.max) {
        return `Invalid value ${part} for ${range.name} (${range.min}-${range.max})`;
      }
    }
  }
  return null;
}

export function validateCron(expr) {
  if (!expr || typeof expr !== 'string') return { valid: false, error: 'Expression is required' };
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return { valid: false, error: `Expected 5 fields, got ${fields.length}` };
  for (let i = 0; i < 5; i++) {
    const err = validateField(fields[i], FIELD_RANGES[i]);
    if (err) return { valid: false, error: err };
  }
  return { valid: true };
}
