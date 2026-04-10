// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { HEX, hexAlpha } from '../../lib/theme-hex';
import { fmtNum, fmtDollar, fmtPct } from '../../lib/format';

/**
 * Modern token flow chart — edge-to-edge gradient fill, floating labels,
 * hover tooltip for detail. Self-sizing via internal ResizeObserver.
 */
const TokenChart = memo(function TokenChart({ data }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState(null);

  const { width, height } = size;
  // Minimal padding — just enough for floating labels to breathe
  const pad = { top: 28, right: 12, bottom: 8, left: 12 };
  const w = Math.max(width - pad.left - pad.right, 0);
  const h = Math.max(height - pad.top - pad.bottom, 0);

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
    if (!canvas || !data?.length || w <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - pad.left;
    if (x < 0 || x > w) { setHover(null); return; }
    const index = Math.round((x / w) * (data.length - 1));
    setHover({ x: pad.left + (index / (data.length - 1)) * w, index });
  }, [data, w, pad.left]);

  const onMouseLeave = useCallback(() => setHover(null), []);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data?.length || width <= 0 || height <= 0 || w <= 0 || h <= 0) return;
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

    const xAt = (i) => pad.left + (i / Math.max(data.length - 1, 1)) * w;
    const yToken = (v) => pad.top + h - (v / maxT) * h;
    const yCost = (v) => pad.top + h - (v / maxC) * h;
    const yCache = (v) => pad.top + h - (v * h);

    // ── Subtle horizontal guidelines (3 lines, dotted) ──────
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = hexAlpha(HEX.text4, 0.25);
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const y = pad.top + (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + w, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // ── Floating Y-axis labels (inside chart, top-left) ─────
    ctx.font = "9px 'JetBrains Mono Variable', monospace";
    ctx.textAlign = 'left';
    ctx.fillStyle = hexAlpha(HEX.text3, 0.6);
    // Top label (max)
    ctx.fillText(fmtNum(maxT), pad.left + 4, pad.top + 10);
    // Mid label
    ctx.fillText(fmtNum(maxT / 2), pad.left + 4, pad.top + h / 2 + 4);

    // ── Token area fill (edge-to-edge gradient) ─────────────
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top + h);
    for (let i = 0; i < data.length; i++) {
      ctx.lineTo(xAt(i), yToken(tokens[i]));
    }
    ctx.lineTo(xAt(data.length - 1), pad.top + h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + h);
    grad.addColorStop(0, hexAlpha(HEX.accent, 0.18));
    grad.addColorStop(0.7, hexAlpha(HEX.accent, 0.04));
    grad.addColorStop(1, hexAlpha(HEX.accent, 0));
    ctx.fillStyle = grad;
    ctx.fill();

    // ── Token line ──────────────────────────────────────────
    ctx.beginPath();
    ctx.strokeStyle = HEX.accent;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    for (let i = 0; i < data.length; i++) {
      const x = xAt(i);
      const y = yToken(tokens[i]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ── Cost line (dashed, subtle) ──────────────────────────
    ctx.beginPath();
    ctx.strokeStyle = hexAlpha(HEX.warning, 0.6);
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.setLineDash([5, 4]);
    for (let i = 0; i < data.length; i++) {
      const x = xAt(i);
      const y = yCost(costs[i]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Cache hit rate line (dotted, subtle) ────────────────
    if (hasCacheData) {
      ctx.beginPath();
      ctx.strokeStyle = hexAlpha(HEX.info, 0.45);
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
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

    // ── Inline legend (top-right, pill-style) ───────────────
    ctx.font = "9px 'Inter Variable', sans-serif";
    ctx.textAlign = 'right';
    let rx = width - pad.right - 4;
    const ly = 14;

    if (hasCacheData) {
      ctx.fillStyle = hexAlpha(HEX.info, 0.5);
      ctx.fillText('Cache', rx, ly);
      rx -= ctx.measureText('Cache').width + 4;
      ctx.beginPath();
      ctx.arc(rx, ly - 3, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = hexAlpha(HEX.info, 0.5);
      ctx.fill();
      rx -= 12;
    }

    ctx.fillStyle = hexAlpha(HEX.warning, 0.7);
    ctx.fillText('Cost', rx, ly);
    rx -= ctx.measureText('Cost').width + 4;
    ctx.beginPath();
    ctx.arc(rx, ly - 3, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = hexAlpha(HEX.warning, 0.7);
    ctx.fill();
    rx -= 12;

    ctx.fillStyle = HEX.accent;
    ctx.fillText('Tokens', rx, ly);
    rx -= ctx.measureText('Tokens').width + 4;
    ctx.beginPath();
    ctx.arc(rx, ly - 3, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = HEX.accent;
    ctx.fill();

    // ── Hover crosshair + tooltip ───────────────────────────
    if (hover && hover.index >= 0 && hover.index < data.length) {
      const hx = hover.x;

      // Vertical line
      ctx.beginPath();
      ctx.moveTo(hx, pad.top);
      ctx.lineTo(hx, pad.top + h);
      ctx.strokeStyle = hexAlpha(HEX.text1, 0.15);
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.stroke();

      // Dot on token line
      const d = data[hover.index];
      const dotY = yToken(d.tokens || 0);
      ctx.beginPath();
      ctx.arc(hx, dotY, 3, 0, Math.PI * 2);
      ctx.fillStyle = HEX.accent;
      ctx.fill();

      // Tooltip
      const lines = [
        { label: 'Tokens', value: fmtNum(d.tokens || 0), color: HEX.accent },
        { label: 'Cost', value: fmtDollar(d.costUsd || 0), color: HEX.warning },
      ];
      if (d.cacheHitRate != null) {
        lines.push({ label: 'Cache', value: fmtPct(d.cacheHitRate * 100), color: HEX.info });
      }

      const tooltipW = 100;
      const tooltipH = lines.length * 16 + 12;
      let tx = hx + 12;
      if (tx + tooltipW > width - 8) tx = hx - tooltipW - 12;
      const ty = Math.max(pad.top, dotY - tooltipH / 2);

      // Background
      ctx.fillStyle = hexAlpha(HEX.surface0, 0.92);
      ctx.beginPath();
      ctx.roundRect(tx, ty, tooltipW, tooltipH, 4);
      ctx.fill();
      ctx.strokeStyle = hexAlpha(HEX.text4, 0.2);
      ctx.lineWidth = 1;
      ctx.stroke();

      // Rows
      ctx.textAlign = 'left';
      lines.forEach((line, i) => {
        const rowY = ty + 14 + i * 16;
        // Dot
        ctx.beginPath();
        ctx.arc(tx + 8, rowY - 3, 2, 0, Math.PI * 2);
        ctx.fillStyle = line.color;
        ctx.fill();
        // Label
        ctx.font = "8px 'Inter Variable', sans-serif";
        ctx.fillStyle = HEX.text3;
        ctx.fillText(line.label, tx + 14, rowY);
        // Value
        ctx.font = "9px 'JetBrains Mono Variable', monospace";
        ctx.fillStyle = HEX.text0;
        ctx.textAlign = 'right';
        ctx.fillText(line.value, tx + tooltipW - 8, rowY);
        ctx.textAlign = 'left';
      });
    }
  }, [data, width, height, hover, w, h, pad]);

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
