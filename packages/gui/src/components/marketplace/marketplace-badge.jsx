// FSL-1.1-Apache-2.0 — see LICENSE
import { cn } from '../../lib/cn';

const VARIANTS = {
  design:      { color: '#c678dd', bg: 'rgba(198,120,221,0.12)' },
  quality:     { color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  devtools:    { color: '#33afbc', bg: 'rgba(51,175,188,0.14)' },
  workflow:    { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  security:    { color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  specialized: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  verified:    { color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  anthropic:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  published:   { color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  draft:       { color: '#6b7f95', bg: 'rgba(255,255,255,0.06)' },
  review:      { color: '#c678dd', bg: 'rgba(198,120,221,0.12)' },
  rejected:    { color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  free:        { color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
};

export function MarketplaceBadge({ label, variant, className }) {
  const v = VARIANTS[variant] || VARIANTS.draft;
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap font-sans select-none',
        className,
      )}
      style={{
        padding: '3px 8px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        lineHeight: 1.4,
        color: v.color,
        background: v.bg,
      }}
    >
      {label}
    </span>
  );
}
