// FSL-1.1-Apache-2.0 — see LICENSE
export function VerifiedShield({ type = 'verified', size = 12 }) {
  const color = type === 'claude-official' || type === 'anthropic' ? '#f59e0b' : '#4ade80';
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className="inline-block flex-shrink-0">
      <path
        d="M10 0l2.36 3.15L16.18 2l.68 3.93L20.8 7.1l-1.87 3.52L20.8 14.14l-3.94 1.17-.68 3.93-3.82-1.15L10 21.24l-2.36-3.15-3.82 1.15-.68-3.93-3.94-1.17 1.87-3.52L-.8 7.1l3.94-1.17.68-3.93 3.82 1.15L10 0z"
        fill={color}
      />
      <path d="M7 10.5l2 2 4-4.5" fill="none" stroke="#24282f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
