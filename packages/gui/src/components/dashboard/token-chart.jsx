// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect, useState, useCallback, useMemo, memo } from 'react';
import { HEX, hexAlpha } from '../../lib/theme-hex';
import { fmtNum, fmtPct } from '../../lib/format';

/**
 * Modern burn-rate chart — shows tokens/interval (velocity) + running agent count
 * instead of monotonically climbing cumulative values. Self-sizing.
 */
const TokenChart = memo(function TokenChart({ data }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState(null);

  const { width, height } = size;
  const pad = { top: 28, right: 12, bottom: 8, left: 12 };
  const w = Math.max(width - pad.left - pad.right, 0);
  const h = Math.max(height - pad.top - pad.bottom, 0);

  // Derive burn rate + cache rate from consecutive snapshots
  const chartData = useMemo(() => {
    if (!data || data.length < 2) return [];
    return data.slice(1).map((d, i) => {
      const prev = data[i];
      const dt = (d.t - prev.t) / 60000; // minutes
      const dTokens = Math.max((d.tokens || 0) - (prev.tokens || 0), 0);
      return {
        burnRate: dt > 0 ? Math.round(dTokens / dt) : 0, // tokens/min
        cacheHitRate: d.cacheHitRate || 0,
        running: d.running || 0,
        agents: d.agents || 0,
        t: d.t,
      };
    });
  }, [data]);

  // Self-size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width: cw, height: ch } = entries[0].contentRect;
      if (cw > 0 && ch > 0) setSize({ width: Math.floor(cw), height: Math.floor(ch) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas || !chartData.length || w <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - pad.left;
    if (x < 0 || x > w) { setHover(null); return; }
    const index = Math.round((x / w) * (chartData.length - 1));
    setHover({ x: pad.left + (index / Math.max(chartData.length - 1, 1)) * w, index });
  }, [chartData, w, pad.left]);

  const onMouseLeave = useCallback(() => setHover(null), []);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !chartData.length || width <= 0 || height <= 0 || w <= 0 || h <= 0) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const burns = chartData.map((d) => d.burnRate);
    const caches = chartData.map((d) => d.cacheHitRate);
    const running = chartData.map((d) => d.running);
    const maxBurn = Math.max(...burns, 100);
    const maxRunning = Math.max(...running, 1);

    const xAt = (i) => pad.left + (i / Math.max(chartData.length - 1, 1)) * w;
    const yBurn = (v) => pad.top + h - (v / maxBurn) * h;
    const yCache = (v) => pad.top + h - (v * h);

    // ── Running agents bars (background, subtle) ────────────
    const barW = Math.max(w / chartData.length - 1, 2);
    for (let i = 0; i < chartData.length; i++) {
      const r = running[i];
      if (r <= 0) continue;
      const barH = (r / maxRunning) * h * 0.3; // max 30% height
      const x = xAt(i) - barW / 2;
      const y = pad.top + h - barH;
      ctx.fillStyle = hexAlpha(HEX.surface5, 0.5);
      ctx.fillRect(x, y, barW, barH);
    }

    // ── Subtle horizontal guidelines ────────────────────────
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = hexAlpha(HEX.text4, 0.2);
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const y = pad.top + (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + w, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // ── Floating Y labels ───────────────────────────────────
    ctx.font = "9px 'JetBrains Mono Variable', monospace";
    ctx.textAlign = 'left';
    ctx.fillStyle = hexAlpha(HEX.text3, 0.5);
    ctx.fillText(`${fmtNum(maxBurn)}/m`, pad.left + 4, pad.top + 10);
    ctx.fillText(`${fmtNum(Math.round(maxBurn / 2))}/m`, pad.left + 4, pad.top + h / 2 + 4);

    // ── Burn rate area fill ─────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top + h);
    for (let i = 0; i < chartData.length; i++) {
      ctx.lineTo(xAt(i), yBurn(burns[i]));
    }
    ctx.lineTo(xAt(chartData.length - 1), pad.top + h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + h);
    grad.addColorStop(0, hexAlpha(HEX.accent, 0.2));
    grad.addColorStop(0.7, hexAlpha(HEX.accent, 0.04));
    grad.addColorStop(1, hexAlpha(HEX.accent, 0));
    ctx.fillStyle = grad;
    ctx.fill();

    // ── Burn rate line ──────────────────────────────────────
    ctx.beginPath();
    ctx.strokeStyle = HEX.accent;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    for (let i = 0; i < chartData.length; i++) {
      const x = xAt(i);
      const y = yBurn(burns[i]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ── Cache hit rate line ─────────────────────────────────
    const hasCacheData = caches.some((c) => c > 0);
    if (hasCacheData) {
      ctx.beginPath();
      ctx.strokeStyle = hexAlpha(HEX.info, 0.45);
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      ctx.setLineDash([2, 3]);
      for (let i = 0; i < chartData.length; i++) {
        const x = xAt(i);
        const y = yCache(caches[i]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Inline legend (top-right) ───────────────────────────
    ctx.font = "9px 'Inter Variable', sans-serif";
    ctx.textAlign = 'right';
    let rx = width - pad.right - 4;
    const ly = 14;

    if (hasCacheData) {
      ctx.fillStyle = hexAlpha(HEX.info, 0.5);
      ctx.fillText('Cache %', rx, ly);
      rx -= ctx.measureText('Cache %').width + 4;
      ctx.beginPath(); ctx.arc(rx, ly - 3, 2.5, 0, Math.PI * 2); ctx.fill();
      rx -= 14;
    }

    ctx.fillStyle = hexAlpha(HEX.surface5, 0.7);
    ctx.fillText('Agents', rx, ly);
    rx -= ctx.measureText('Agents').width + 4;
    ctx.beginPath(); ctx.arc(rx, ly - 3, 2.5, 0, Math.PI * 2); ctx.fill();
    rx -= 14;

    ctx.fillStyle = HEX.accent;
    ctx.fillText('Burn Rate', rx, ly);
    rx -= ctx.measureText('Burn Rate').width + 4;
    ctx.beginPath(); ctx.arc(rx, ly - 3, 2.5, 0, Math.PI * 2); ctx.fill();

    // ── Hover ───────────────────────────────────────────────
    if (hover && hover.index >= 0 && hover.index < chartData.length) {
      const hx = hover.x;
      const d = chartData[hover.index];

      // Crosshair
      ctx.beginPath();
      ctx.moveTo(hx, pad.top);
      ctx.lineTo(hx, pad.top + h);
      ctx.strokeStyle = hexAlpha(HEX.text1, 0.15);
      ctx.lineWidth = 1;
      ctx.stroke();

      // Dot
      const dotY = yBurn(d.burnRate);
      ctx.beginPath(); ctx.arc(hx, dotY, 3, 0, Math.PI * 2);
      ctx.fillStyle = HEX.accent; ctx.fill();

      // Tooltip
      const lines = [
        { label: 'Burn', value: `${fmtNum(d.burnRate)}/m`, color: HEX.accent },
        { label: 'Cache', value: fmtPct(d.cacheHitRate * 100), color: HEX.info },
        { label: 'Agents', value: `${d.running}/${d.agents}`, color: HEX.text2 },
      ];
      const tooltipW = 104;
      const tooltipH = lines.length * 16 + 12;
      let tx = hx + 12;
      if (tx + tooltipW > width - 8) tx = hx - tooltipW - 12;
      const ty = Math.max(pad.top, dotY - tooltipH / 2);

      ctx.fillStyle = hexAlpha(HEX.surface0, 0.92);
      ctx.beginPath(); ctx.roundRect(tx, ty, tooltipW, tooltipH, 4); ctx.fill();
      ctx.strokeStyle = hexAlpha(HEX.text4, 0.2);
      ctx.lineWidth = 1; ctx.stroke();

      ctx.textAlign = 'left';
      lines.forEach((line, i) => {
        const rowY = ty + 14 + i * 16;
        ctx.beginPath(); ctx.arc(tx + 8, rowY - 3, 2, 0, Math.PI * 2);
        ctx.fillStyle = line.color; ctx.fill();
        ctx.font = "8px 'Inter Variable', sans-serif";
        ctx.fillStyle = HEX.text3; ctx.fillText(line.label, tx + 14, rowY);
        ctx.font = "9px 'JetBrains Mono Variable', monospace";
        ctx.fillStyle = HEX.text0; ctx.textAlign = 'right';
        ctx.fillText(line.value, tx + tooltipW - 8, rowY);
        ctx.textAlign = 'left';
      });
    }
  }, [chartData, width, height, hover, w, h, pad]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {width > 0 && height > 0 && (
        <canvas
          ref={canvasRef}
          style={{ width, height }}
          className="block cursor-crosshair"
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
        />
      )}
    </div>
  );
});

export { TokenChart };
