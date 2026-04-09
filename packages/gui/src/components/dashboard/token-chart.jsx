// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect } from 'react';
import { HEX } from '../../lib/theme-hex';
import { fmtNum, fmtDollar } from '../../lib/format';

export function TokenChart({ data, width, height }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data?.length) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const pad = { top: 12, right: 60, bottom: 28, left: 60 };
    const w = width - pad.left - pad.right;
    const h = height - pad.top - pad.bottom;

    const tokens = data.map((d) => d.tokens || 0);
    const costs = data.map((d) => d.costUsd || 0);
    const maxT = Math.max(...tokens, 1);
    const maxC = Math.max(...costs, 0.01);

    // Grid lines
    ctx.strokeStyle = HEX.surface4;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + w, y);
      ctx.stroke();
    }

    // Token area
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top + h);
    data.forEach((d, i) => {
      const x = pad.left + (i / (data.length - 1)) * w;
      const y = pad.top + h - ((d.tokens || 0) / maxT) * h;
      ctx.lineTo(x, y);
    });
    ctx.lineTo(pad.left + w, pad.top + h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + h);
    grad.addColorStop(0, 'rgba(51, 175, 188, 0.2)');
    grad.addColorStop(1, 'rgba(51, 175, 188, 0.01)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Token line
    ctx.beginPath();
    ctx.strokeStyle = HEX.accent;
    ctx.lineWidth = 1.5;
    data.forEach((d, i) => {
      const x = pad.left + (i / (data.length - 1)) * w;
      const y = pad.top + h - ((d.tokens || 0) / maxT) * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Cost line
    ctx.beginPath();
    ctx.strokeStyle = HEX.warning;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    data.forEach((d, i) => {
      const x = pad.left + (i / (data.length - 1)) * w;
      const y = pad.top + h - ((d.costUsd || 0) / maxC) * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Left axis labels (tokens)
    ctx.fillStyle = HEX.text3;
    ctx.font = '10px var(--font-mono)';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const val = (maxT / 4) * (4 - i);
      ctx.fillText(fmtNum(val), pad.left - 6, pad.top + (h / 4) * i + 4);
    }

    // Right axis labels (cost)
    ctx.textAlign = 'left';
    ctx.fillStyle = HEX.text4;
    for (let i = 0; i <= 4; i++) {
      const val = (maxC / 4) * (4 - i);
      ctx.fillText(fmtDollar(val), pad.left + w + 6, pad.top + (h / 4) * i + 4);
    }

    // Legend
    ctx.font = '10px sans-serif';
    ctx.fillStyle = HEX.accent;
    ctx.fillText('● Tokens', pad.left, height - 6);
    ctx.fillStyle = HEX.warning;
    ctx.fillText('● Cost', pad.left + 70, height - 6);
  }, [data, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className="block"
    />
  );
}
