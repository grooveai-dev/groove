// FSL-1.1-Apache-2.0 — see LICENSE

const SIZES = { sm: 12, md: 16, lg: 20 };

function Star({ fill = 'full', size, color = '#fbbf24', emptyColor = 'rgba(255,255,255,0.4)' }) {
  const id = `star-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      {fill === 'half' && (
        <defs>
          <linearGradient id={id}>
            <stop offset="50%" stopColor={color} />
            <stop offset="50%" stopColor={emptyColor} />
          </linearGradient>
        </defs>
      )}
      <path
        d="M10 1.5l2.47 5.01 5.53.8-4 3.9.94 5.49L10 14.27 5.06 16.7 6 11.21l-4-3.9 5.53-.8L10 1.5z"
        fill={fill === 'full' ? color : fill === 'half' ? `url(#${id})` : emptyColor}
      />
    </svg>
  );
}

export function StarRating({ rating = 0, count, size = 'sm' }) {
  const px = SIZES[size] || SIZES.sm;
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    if (rating >= i) stars.push('full');
    else if (rating >= i - 0.5) stars.push('half');
    else stars.push('empty');
  }

  return (
    <span className="inline-flex items-center" style={{ gap: 1 }}>
      {stars.map((fill, i) => (
        <Star key={i} fill={fill} size={px} />
      ))}
      {count != null && (
        <span className="ml-1 text-[11px] text-[var(--text-dim,#6b7f95)] font-sans">({count})</span>
      )}
    </span>
  );
}
