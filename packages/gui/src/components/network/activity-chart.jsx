// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect, useState, useCallback, useMemo, memo } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { HEX, hexAlpha } from '../../lib/theme-hex';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/badge';

function shortAddr(addr) {
  if (!addr || typeof addr !== 'string') return '—';
  if (addr.length < 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export const ActivityChart = memo(function ActivityChart() {
  const snapshots = useGrooveStore((s) => s.networkSnapshots);
  const perfSnapshots = useGrooveStore((s) => s.networkPerfSnapshots);
  const nodes = useGrooveStore((s) => s.networkStatus.nodes || []);
  const ownNodeId = useGrooveStore((s) => s.networkNode.nodeId);

  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState(null);
  const [mode, setMode] = useState('sessions');

  const { width, height } = size;
  const pad = { top: 28, right: 12, bottom: 8, left: 12 };
  const w = Math.max(width - pad.left - pad.right, 0);
  const h = Math.max(height - pad.top - pad.bottom, 0);

  const chartData = useMemo(() => {
    if (mode === 'performance') {
      if (!perfSnapshots || perfSnapshots.length < 2) return [];
      return perfSnapshots;
    }
    if (!snapshots || snapshots.length < 2) return [];
    return snapshots;
  }, [snapshots, perfSnapshots, mode]);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !chartData.length || width <= 0 || height <= 0 || w <= 0 || h <= 0) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const isPerfMode = mode === 'performance';

    if (isPerfMode) {
      // Performance mode: plot TPS
      const tpsVals = chartData.map((d) => d.tps || 0);
      const maxVal = Math.max(...tpsVals, 1);

      const xAt = (i) => pad.left + (i / Math.max(chartData.length - 1, 1)) * w;
      const yAt = (v) => pad.top + h - (v / maxVal) * h;

      // Grid
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = hexAlpha(HEX.text4, 0.2);
      ctx.lineWidth = 1;
      for (let gi = 1; gi <= 3; gi++) {
        const gy = pad.top + (h / 4) * gi;
        ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + w, gy); ctx.stroke();
      }
      ctx.setLineDash([]);

      ctx.font = "9px 'JetBrains Mono Variable', monospace";
      ctx.textAlign = 'left';
      ctx.fillStyle = hexAlpha(HEX.text3, 0.5);
      ctx.fillText(`${maxVal.toFixed(1)} t/s`, pad.left + 4, pad.top + 10);

      // Fill
      ctx.beginPath();
      ctx.moveTo(pad.left, pad.top + h);
      for (let i = 0; i < chartData.length; i++) ctx.lineTo(xAt(i), yAt(tpsVals[i]));
      ctx.lineTo(xAt(chartData.length - 1), pad.top + h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + h);
      grad.addColorStop(0, hexAlpha(HEX.accent, 0.2));
      grad.addColorStop(0.7, hexAlpha(HEX.accent, 0.04));
      grad.addColorStop(1, hexAlpha(HEX.accent, 0));
      ctx.fillStyle = grad;
      ctx.fill();

      // Line
      ctx.beginPath();
      ctx.strokeStyle = HEX.accent;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      for (let i = 0; i < chartData.length; i++) {
        i === 0 ? ctx.moveTo(xAt(i), yAt(tpsVals[i])) : ctx.lineTo(xAt(i), yAt(tpsVals[i]));
      }
      ctx.stroke();

      // Legend
      ctx.font = "9px 'Inter Variable', sans-serif";
      ctx.textAlign = 'right';
      ctx.fillStyle = HEX.accent;
      ctx.fillText('TPS', width - pad.right - 4, 14);

      // Hover
      if (hover && hover.index >= 0 && hover.index < chartData.length) {
        const hx = hover.x;
        const d = chartData[hover.index];
        ctx.beginPath(); ctx.moveTo(hx, pad.top); ctx.lineTo(hx, pad.top + h);
        ctx.strokeStyle = hexAlpha(HEX.text1, 0.15); ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); ctx.arc(hx, yAt(d.tps || 0), 3, 0, Math.PI * 2);
        ctx.fillStyle = HEX.accent; ctx.fill();

        const tooltipW = 90;
        const tooltipH = 28;
        let tx = hx + 12;
        if (tx + tooltipW > width - 8) tx = hx - tooltipW - 12;
        const ty = Math.max(pad.top, yAt(d.tps || 0) - tooltipH / 2);
        ctx.fillStyle = hexAlpha(HEX.surface0, 0.92);
        ctx.beginPath(); ctx.roundRect(tx, ty, tooltipW, tooltipH, 4); ctx.fill();
        ctx.strokeStyle = hexAlpha(HEX.text4, 0.2); ctx.lineWidth = 1; ctx.stroke();
        ctx.font = "9px 'JetBrains Mono Variable', monospace";
        ctx.textAlign = 'center';
        ctx.fillStyle = HEX.text0;
        ctx.fillText(`${(d.tps || 0).toFixed(1)} t/s`, tx + tooltipW / 2, ty + 17);
      }
    } else {
      // Sessions mode (original)
      const globalSessions = chartData.map((d) => d.globalSessions);
      const mySessions = chartData.map((d) => d.mySessions);
      const maxVal = Math.max(...globalSessions, ...mySessions, 1);

      const xAt = (i) => pad.left + (i / Math.max(chartData.length - 1, 1)) * w;
      const yAt = (v) => pad.top + h - (v / maxVal) * h;

      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = hexAlpha(HEX.text4, 0.2);
      ctx.lineWidth = 1;
      for (let gi = 1; gi <= 3; gi++) {
        const gy = pad.top + (h / 4) * gi;
        ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + w, gy); ctx.stroke();
      }
      ctx.setLineDash([]);

      ctx.font = "9px 'JetBrains Mono Variable', monospace";
      ctx.textAlign = 'left';
      ctx.fillStyle = hexAlpha(HEX.text3, 0.5);
      ctx.fillText(String(maxVal), pad.left + 4, pad.top + 10);
      ctx.fillText(String(Math.round(maxVal / 2)), pad.left + 4, pad.top + h / 2 + 4);

      // Network line — gradient fill
      ctx.beginPath();
      ctx.moveTo(pad.left, pad.top + h);
      for (let i = 0; i < chartData.length; i++) ctx.lineTo(xAt(i), yAt(globalSessions[i]));
      ctx.lineTo(xAt(chartData.length - 1), pad.top + h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + h);
      grad.addColorStop(0, hexAlpha(HEX.purple, 0.2));
      grad.addColorStop(0.7, hexAlpha(HEX.purple, 0.04));
      grad.addColorStop(1, hexAlpha(HEX.purple, 0));
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      ctx.strokeStyle = HEX.purple;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      for (let i = 0; i < chartData.length; i++) {
        const x = xAt(i); const y = yAt(globalSessions[i]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = HEX.accent;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      for (let i = 0; i < chartData.length; i++) {
        const x = xAt(i); const y = yAt(mySessions[i]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Legend
      ctx.font = "9px 'Inter Variable', sans-serif";
      ctx.textAlign = 'right';
      let rx = width - pad.right - 4;
      const ly = 14;
      ctx.fillStyle = HEX.accent;
      ctx.fillText('Your Node', rx, ly);
      rx -= ctx.measureText('Your Node').width + 4;
      ctx.beginPath(); ctx.arc(rx, ly - 3, 2.5, 0, Math.PI * 2); ctx.fill();
      rx -= 14;
      ctx.fillStyle = HEX.purple;
      ctx.fillText('Network', rx, ly);
      rx -= ctx.measureText('Network').width + 4;
      ctx.beginPath(); ctx.arc(rx, ly - 3, 2.5, 0, Math.PI * 2); ctx.fill();

      // Hover
      if (hover && hover.index >= 0 && hover.index < chartData.length) {
        const hx = hover.x;
        const d = chartData[hover.index];
        ctx.beginPath(); ctx.moveTo(hx, pad.top); ctx.lineTo(hx, pad.top + h);
        ctx.strokeStyle = hexAlpha(HEX.text1, 0.15); ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); ctx.arc(hx, yAt(d.globalSessions), 3, 0, Math.PI * 2);
        ctx.fillStyle = HEX.purple; ctx.fill();
        ctx.beginPath(); ctx.arc(hx, yAt(d.mySessions), 3, 0, Math.PI * 2);
        ctx.fillStyle = HEX.accent; ctx.fill();

        const lines = [
          { label: 'Network', value: String(d.globalSessions), color: HEX.purple },
          { label: 'Your Node', value: String(d.mySessions), color: HEX.accent },
          { label: 'Nodes', value: String(d.nodeCount), color: HEX.text2 },
        ];
        const tooltipW = 104;
        const tooltipH = lines.length * 16 + 12;
        let tx = hx + 12;
        if (tx + tooltipW > width - 8) tx = hx - tooltipW - 12;
        const ty = Math.max(pad.top, yAt(d.globalSessions) - tooltipH / 2);

        ctx.fillStyle = hexAlpha(HEX.surface0, 0.92);
        ctx.beginPath(); ctx.roundRect(tx, ty, tooltipW, tooltipH, 4); ctx.fill();
        ctx.strokeStyle = hexAlpha(HEX.text4, 0.2); ctx.lineWidth = 1; ctx.stroke();

        ctx.textAlign = 'left';
        lines.forEach((line, li) => {
          const rowY = ty + 14 + li * 16;
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
    }
  }, [chartData, width, height, hover, w, h, pad, mode]);

  const activeNodes = nodes.filter((n) => n.status === 'active');

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-2.5 pb-1 flex-shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Network Activity</span>
          <div className="flex items-center bg-surface-2 rounded-full p-0.5">
            <button
              onClick={() => setMode('sessions')}
              className={cn(
                'px-2 py-0.5 text-2xs font-mono rounded-full transition-colors',
                mode === 'sessions' ? 'bg-surface-4 text-text-0' : 'text-text-3 hover:text-text-1',
              )}
            >
              Sessions
            </button>
            <button
              onClick={() => setMode('performance')}
              className={cn(
                'px-2 py-0.5 text-2xs font-mono rounded-full transition-colors',
                mode === 'performance' ? 'bg-surface-4 text-text-0' : 'text-text-3 hover:text-text-1',
              )}
            >
              Perf
            </button>
          </div>
        </div>
        <span className="text-2xs font-mono text-text-3 tabular-nums">{activeNodes.length} nodes</span>
      </div>

      <div ref={containerRef} className="relative flex-1 min-h-0">
        {chartData.length < 2 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-mono text-text-3">Collecting network data…</span>
          </div>
        ) : width > 0 && height > 0 ? (
          <canvas
            ref={canvasRef}
            style={{ width, height }}
            className="absolute inset-0 block cursor-crosshair"
            onMouseMove={onMouseMove}
            onMouseLeave={onMouseLeave}
          />
        ) : null}
      </div>

      <div className="px-3 py-1.5 border-t border-border-subtle flex items-center gap-2 flex-shrink-0 font-mono text-2xs" style={{ background: hexAlpha(HEX.accent, 0.04) }}>
        <span className="text-text-3">{activeNodes.length} node{activeNodes.length !== 1 ? 's' : ''} online</span>
        {activeNodes.map((n) => {
          const id = n.node_id || n.nodeId || '';
          const isSelf = ownNodeId && id === ownNodeId;
          const layers = Array.isArray(n.layers) ? `${n.layers[0]}-${n.layers[1]}` : '';
          return (
            <span key={id} className={isSelf ? 'text-accent' : 'text-text-2'}>
              {shortAddr(id)}{isSelf ? ' (You' : '('}{layers ? ` · ${layers}` : ''})
            </span>
          );
        })}
      </div>
    </div>
  );
});
