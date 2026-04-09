// FSL-1.1-Apache-2.0 — see LICENSE

export function PriceBadge({ price = 0, size = 'sm' }) {
  const isFree = !price || price === 0;
  const sizeClasses = {
    sm: 'text-2xs px-2 py-0.5',
    md: 'text-xs px-2.5 py-0.5',
    lg: 'text-xs px-3 py-1',
  };
  return (
    <span className={`inline-flex items-center font-mono font-semibold rounded whitespace-nowrap ${sizeClasses[size] || sizeClasses.sm} ${isFree ? 'bg-success/12 text-success' : 'bg-white/8 text-text-1'}`}>
      {isFree ? 'Free' : `$${price.toFixed(2)}`}
    </span>
  );
}
