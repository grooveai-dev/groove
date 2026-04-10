// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect, memo } from 'react';
import { HEX } from '../../lib/theme-hex';
import { fmtNum, fmtDollar } from '../../lib/format';

const TIER_COLORS = {
  heavy: HEX.danger,
  medium: HEX.warning,
  light: HEX.success,
};

const TIER_LABELS = {
  heavy: 'Heavy',
  medium: 'Medium',
  light: 'Light',
};

const RoutingChart = memo(function RoutingChart({ routing, size = 120 }) {
  const canvasRef = useRef(null);
  if (!routing) return null;

  const { byTier = {}, costByTier = {}, totalDecisions = 0, autoRoutedCount = 0 } = routing;
  const tiers = ['heavy', 'medium', 'light'];
  const total = tiers.reduce((s, t) => s + (byTier[t] || 0), 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const radius = (size - 12) / 2;
    const strokeWidth = 5;

    if (total === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = HEX.surface4;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    } else {
      let angle = -Math.PI / 2;
      for (const tier of tiers) {
        const count = byTier[tier] || 0;
        if (count === 0) continue;
        const sweep = (count / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, angle, angle + sweep);
        ctx.strokeStyle = TIER_COLORS[tier];
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'butt';
        ctx.stroke();
        angle += sweep;
      }
    }

    // Center text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${size * 0.19}px 'JetBrains Mono Variable', monospace`;
    ctx.fillStyle = HEX.text0;
    ctx.fillText(fmtNum(totalDecisions), cx, cy - 3);

    ctx.font = `500 ${size * 0.09}px 'JetBrains Mono Variable', monospace`;
    ctx.fillStyle = HEX.text3;
    ctx.fillText('ROUTES', cx, cy + size * 0.13);
  }, [routing, size, total, totalDecisions]);

  return (
    <div className="flex flex-col items-center justify-center h-full px-3 py-3">
      <canvas
        ref={canvasRef}
        className="flex-shrink-0"
        style={{ width: size, height: size }}
      />

      <div className="w-full mt-3 space-y-2 max-w-[180px]">
        {tiers.map((tier) => {
          const count = byTier[tier] || 0;
          const cost = costByTier[tier] || 0;
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={tier} className="space-y-0.5">
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TIER_COLORS[tier] }} />
                <span className="text-text-3 uppercase tracking-wider flex-1">{TIER_LABELS[tier]}</span>
                <span className="text-text-1 tabular-nums">{count}</span>
                <span className="text-text-4">/</span>
                <span className="text-text-2 tabular-nums">{fmtDollar(cost)}</span>
              </div>
              <div className="h-[2px] bg-surface-0 rounded-full overflow-hidden ml-3.5">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(pct, 100)}%`, background: TIER_COLORS[tier] }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {autoRoutedCount > 0 && (
        <div className="mt-2.5 text-2xs font-mono text-text-3 uppercase tracking-wider">
          {autoRoutedCount} auto-routed
        </div>
      )}
    </div>
  );
});

export { RoutingChart };
