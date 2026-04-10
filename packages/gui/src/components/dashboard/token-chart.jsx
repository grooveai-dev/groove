// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { HEX, hexAlpha } from '../../lib/theme-hex';
import { fmtNum, fmtDollar, fmtPct } from '../../lib/format';

const TokenChart = memo(function TokenChart({ data, width, height }) {
  const canvasRef = useRef(null);
  const [hover, setHover] = useState(null); // { x, index }

  const pad = { top: 16, right: 62, bottom: 30, left: 62 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;

  const onMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas || !data?.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - pad.left;
    if (x < 0 || x > w) { setHover(null); return; }
    const index = Math.round((x / w) * (data.length - 1));
    setHover({ x: pad.left + (index / (data.length - 1)) * w, index });
  }, [data, w, pad.left]);

  const onMouseLeave = useCallback(() => setHover(null), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data?.length) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const tokens = data.map((d) => d.tokens || 0);
    const costs = data.map((d) => d.costUsd || 0);
    const caches = data.map((d) => d.cacheHitRate ?? null);
    const maxT = Math.max(...tokens, 1);
    const maxC = Math.max(...costs, 0.01);
    const hasCacheData = caches.some((c) => c !== null && c > 0);

    // Grid lines
    ctx.strokeStyle = HEX.surface5;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + w, y);
      ctx.stroke();
    }

    // Helper: map data index to x
    const xAt = (i) => pad.left + (i / (data.length - 1)) * w;
    const yToken = (v) => pad.top + h - (v / maxT) * h;
    const yCost = (v) => pad.top + h - (v / maxC) * h;
    const yCache = (v) => pad.top + h - (v * h);

    // Token area fill
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top + h);
    for (let i = 0; i < data.length; i++) {
      ctx.lineTo(xAt(i), yToken(tokens[i]));
    }
    ctx.lineTo(xAt(data.length - 1), pad.top + h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + h);
    grad.addColorStop(0, hexAlpha(HEX.accent, 0.12));
    grad.addColorStop(1, hexAlpha(HEX.accent, 0.01));
    ctx.fillStyle = grad;
    ctx.fill();

    // Token line
    ctx.beginPath();
    ctx.strokeStyle = HEX.accent;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < data.length; i++) {
      const x = xAt(i);
      const y = yToken(tokens[i]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Cost line (dashed)
    ctx.beginPath();
    ctx.strokeStyle = HEX.warning;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (let i = 0; i < data.length; i++) {
      const x = xAt(i);
      const y = yCost(costs[i]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Cache hit rate line (dotted, if data available)
    if (hasCacheData) {
      ctx.beginPath();
      ctx.strokeStyle = hexAlpha(HEX.info, 0.5);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      let started = false;
      for (let i = 0; i < data.length; i++) {
        const c = caches[i];
        if (c === null || c === undefined) continue;
        const x = xAt(i);
        const y = yCache(c);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Left axis labels (tokens)
    ctx.fillStyle = HEX.text2;
    ctx.font = "10px 'JetBrains Mono Variable', monospace";
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const val = (maxT / 4) * (4 - i);
      ctx.fillText(fmtNum(val), pad.left - 6, pad.top + (h / 4) * i + 4);
    }

    // Right axis labels (cost)
    ctx.textAlign = 'left';
    ctx.fillStyle = HEX.text3;
    for (let i = 0; i <= 4; i++) {
      const val = (maxC / 4) * (4 - i);
      ctx.fillText(fmtDollar(val), pad.left + w + 6, pad.top + (h / 4) * i + 4);
    }

    // Legend
    ctx.font = "10px 'Inter Variable', sans-serif";
    ctx.textAlign = 'left';
    const legendY = height - 8;
    let lx = pad.left;

    ctx.fillStyle = HEX.accent;
    ctx.fillRect(lx, legendY - 3, 8, 1.5);
    lx += 11;
    ctx.fillStyle = HEX.text2;
    ctx.fillText('Tokens', lx, legendY);
    lx += 44;

    ctx.fillStyle = HEX.warning;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(lx, legendY - 2);
    ctx.lineTo(lx + 8, legendY - 2);
    ctx.strokeStyle = HEX.warning;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    lx += 11;
    ctx.fillStyle = HEX.text2;
    ctx.fillText('Cost', lx, legendY);

    if (hasCacheData) {
      lx += 36;
      ctx.fillStyle = hexAlpha(HEX.info, 0.5);
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(lx, legendY - 2);
      ctx.lineTo(lx + 8, legendY - 2);
      ctx.strokeStyle = hexAlpha(HEX.info, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      lx += 11;
      ctx.fillStyle = HEX.text2;
      ctx.fillText('Cache', lx, legendY);
    }

    // Hover crosshair
    if (hover && hover.index >= 0 && hover.index < data.length) {
      const hx = hover.x;
      ctx.beginPath();
      ctx.moveTo(hx, pad.top);
      ctx.lineTo(hx, pad.top + h);
      ctx.strokeStyle = hexAlpha(HEX.text2, 0.3);
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.stroke();

      // Tooltip background
      const d = data[hover.index];
      const lines = [
        `${fmtNum(d.tokens || 0)} tok`,
        `${fmtDollar(d.costUsd || 0)}`,
      ];
      if (d.cacheHitRate != null) lines.push(`${fmtPct(d.cacheHitRate * 100)} cache`);

      const tooltipW = 80;
      const tooltipH = lines.length * 14 + 8;
      let tx = hx + 8;
      if (tx + tooltipW > width - 4) tx = hx - tooltipW - 8;
      const ty = pad.top + 8;

      ctx.fillStyle = hexAlpha(HEX.surface1, 0.95);
      ctx.strokeStyle = HEX.surface4;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(tx, ty, tooltipW, tooltipH, 3);
      ctx.fill();
      ctx.stroke();

      ctx.font = "9px 'JetBrains Mono Variable', monospace";
      ctx.fillStyle = HEX.text1;
      ctx.textAlign = 'left';
      lines.forEach((line, i) => {
        ctx.fillText(line, tx + 6, ty + 14 + i * 14);
      });
    }
  }, [data, width, height, hover, w, h, pad.left, pad.top, pad.right, pad.bottom]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className="block cursor-crosshair"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    />
  );
});

export { TokenChart };
