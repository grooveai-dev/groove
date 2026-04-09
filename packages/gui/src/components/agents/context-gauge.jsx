// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect } from 'react';
import { HEX } from '../../lib/theme-hex';

export function ContextGauge({ percent = 0, size = 100, strokeWidth = 6 }) {
  const canvasRef = useRef(null);

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
    const radius = (size - strokeWidth * 2) / 2;

    // Arc spans from 135° to 405° (270° total sweep)
    const startAngle = (135 * Math.PI) / 180;
    const endAngle = (405 * Math.PI) / 180;
    const sweep = endAngle - startAngle;

    // Track background
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = HEX.surface4;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Color zones — draw three segments for the filled portion
    const pct = Math.min(Math.max(percent, 0), 100);
    const fillAngle = startAngle + (sweep * pct) / 100;

    if (pct > 0) {
      // Determine color based on percentage
      let color;
      if (pct >= 80) color = HEX.danger;
      else if (pct >= 60) color = HEX.warning;
      else color = HEX.success;

      // Glow effect
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, fillAngle);
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();

      // Solid arc on top (no blur)
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, fillAngle);
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Center text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Percentage value
    ctx.font = `700 ${size * 0.22}px 'Inter Variable', sans-serif`;
    ctx.fillStyle = HEX.text0;
    ctx.fillText(`${Math.round(pct)}%`, cx, cy - 2);

    // Label
    ctx.font = `500 ${size * 0.1}px 'Inter Variable', sans-serif`;
    ctx.fillStyle = HEX.text3;
    ctx.fillText('CONTEXT', cx, cy + size * 0.15);
  }, [percent, size, strokeWidth]);

  return (
    <canvas
      ref={canvasRef}
      className="flex-shrink-0"
      style={{ width: size, height: size }}
    />
  );
}
