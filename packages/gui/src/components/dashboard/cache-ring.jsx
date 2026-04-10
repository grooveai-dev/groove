// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect, memo } from 'react';
import { HEX, hexAlpha } from '../../lib/theme-hex';
import { fmtNum, fmtPct } from '../../lib/format';

const CacheRing = memo(function CacheRing({ cacheRead = 0, cacheCreation = 0, totalInput = 0, size = 140 }) {
  const canvasRef = useRef(null);
  const total = cacheRead + cacheCreation + totalInput;
  const hitRate = total > 0 ? (cacheRead / total) * 100 : 0;

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

    // Arc spans 270 degrees (135° to 405°)
    const startAngle = (135 * Math.PI) / 180;
    const endAngle = (405 * Math.PI) / 180;
    const sweep = endAngle - startAngle;

    // Background track
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = HEX.surface4;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    if (total > 0) {
      const readPct = cacheRead / total;
      const createPct = cacheCreation / total;

      // Segment 1: Cache Read (accent)
      if (readPct > 0) {
        const segEnd = startAngle + sweep * readPct;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAngle, segEnd);
        ctx.strokeStyle = HEX.accent;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Segment 2: Cache Creation (purple)
      if (createPct > 0) {
        const segStart = startAngle + sweep * readPct;
        const segEnd = segStart + sweep * createPct;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, segStart, segEnd);
        ctx.strokeStyle = HEX.purple;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'butt';
        ctx.stroke();
      }
    }

    // Center text — hit rate
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${size * 0.18}px 'JetBrains Mono Variable', monospace`;
    ctx.fillStyle = HEX.text0;
    ctx.fillText(`${Math.round(hitRate)}%`, cx, cy - 3);

    ctx.font = `500 ${size * 0.07}px 'JetBrains Mono Variable', monospace`;
    ctx.fillStyle = HEX.text4;
    ctx.fillText('CACHE', cx, cy + size * 0.12);
  }, [cacheRead, cacheCreation, totalInput, size, total, hitRate]);

  return (
    <div className="flex flex-col items-center justify-center h-full px-3 py-3">
      <canvas
        ref={canvasRef}
        className="flex-shrink-0"
        style={{ width: size, height: size }}
      />
      <div className="w-full mt-3 space-y-1.5 max-w-[160px]">
        <StatRow color={HEX.accent} label="Read" value={fmtNum(cacheRead)} />
        <StatRow color={HEX.purple} label="Create" value={fmtNum(cacheCreation)} />
        <StatRow color={HEX.surface5} label="Miss" value={fmtNum(Math.max(totalInput - cacheRead - cacheCreation, 0))} />
      </div>
    </div>
  );
});

function StatRow({ color, label, value }) {
  return (
    <div className="flex items-center gap-2 text-[9px] font-mono">
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="text-[#505862] uppercase tracking-wider flex-1">{label}</span>
      <span className="text-[#8b929e] tabular-nums">{value}</span>
    </div>
  );
}

export { CacheRing };
