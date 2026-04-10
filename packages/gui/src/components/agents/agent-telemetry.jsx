// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect, useMemo } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { fmtNum, fmtDollar, timeAgo } from '../../lib/format';
import { HEX } from '../../lib/theme-hex';
import { cn } from '../../lib/cn';
import {
  Flame, DollarSign, RotateCw, Heart, Clock,
  FileEdit, Search, Terminal, Eye, AlertCircle, Zap,
  CheckCircle2,
} from 'lucide-react';

const EMPTY = [];

function SparklineChart({ data, isAlive, height = 48 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data.length) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const vals = data.map((d) => d.v);
    const min = Math.min(...vals);
    const max = Math.max(...vals, 1);
    const range = max - min || 1;

    // Gradient fill
    ctx.beginPath();
    ctx.moveTo(0, h);
    data.forEach((d, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((d.v - min) / range) * (h - 4) - 2;
      ctx.lineTo(x, y);
    });
    ctx.lineTo(w, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, isAlive ? 'rgba(51,175,188,0.15)' : 'rgba(110,118,129,0.08)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.strokeStyle = isAlive ? HEX.accent : HEX.text3;
    ctx.lineWidth = 1.5;
    data.forEach((d, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((d.v - min) / range) * (h - 4) - 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Endpoint glow
    if (data.length > 1 && isAlive) {
      const last = data[data.length - 1];
      const x = w - 1;
      const y = h - ((last.v - min) / range) * (h - 4) - 2;

      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(51,175,188,0.3)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = HEX.accent;
      ctx.fill();
    }
  }, [data, isAlive]);

  return (
    <div className="w-full rounded-lg bg-surface-0 overflow-hidden border border-border-subtle" style={{ height }}>
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, color, sub }) {
  return (
    <div className="bg-surface-0 rounded-lg px-3 py-2.5 border border-border-subtle">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={12} className={color || 'text-text-3'} />
        <span className="text-2xs text-text-4 font-sans uppercase tracking-wider">{label}</span>
      </div>
      <div className={cn('text-lg font-bold font-mono tabular-nums', color || 'text-text-0')}>
        {value}
      </div>
      {sub && <div className="text-2xs text-text-4 font-sans mt-0.5">{sub}</div>}
    </div>
  );
}

function HealthBar({ score }) {
  const s = Math.min(Math.max(score, 0), 100);
  let color = HEX.success;
  let label = 'Healthy';
  if (s < 40) { color = HEX.danger; label = 'Degraded'; }
  else if (s < 70) { color = HEX.warning; label = 'Fair'; }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-2xs text-text-3 font-sans flex items-center gap-1.5">
          <Heart size={11} />
          Session Health
        </span>
        <span className="text-xs font-bold font-mono" style={{ color }}>{s}/100</span>
      </div>
      <div className="h-2 bg-surface-0 rounded-full overflow-hidden border border-border-subtle">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${s}%`, background: color }}
        />
      </div>
      <span className="text-2xs font-sans mt-1 block" style={{ color }}>{label}</span>
    </div>
  );
}

function activityIcon(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('edit') || t.includes('writ')) return { icon: FileEdit, color: 'text-warning' };
  if (t.includes('read') || t.includes('view')) return { icon: Eye, color: 'text-info' };
  if (t.includes('search') || t.includes('grep') || t.includes('glob')) return { icon: Search, color: 'text-purple' };
  if (t.includes('bash') || t.includes('command') || t.includes('terminal')) return { icon: Terminal, color: 'text-orange' };
  if (t.includes('error') || t.includes('fail')) return { icon: AlertCircle, color: 'text-danger' };
  if (t.includes('spawn') || t.includes('start')) return { icon: Zap, color: 'text-success' };
  if (t.includes('complet') || t.includes('done')) return { icon: CheckCircle2, color: 'text-success' };
  return { icon: Clock, color: 'text-text-4' };
}

export function AgentTelemetry({ agent }) {
  const timeline = useGrooveStore((s) => s.tokenTimeline[agent.id]) || EMPTY;
  const activityLog = useGrooveStore((s) => s.activityLog[agent.id]) || EMPTY;
  const isAlive = agent.status === 'running' || agent.status === 'starting';

  const burnRate = useMemo(() => {
    if (timeline.length < 2) return 0;
    const recent = timeline.slice(-10);
    const dt = (recent[recent.length - 1].t - recent[0].t) / 60000;
    const dv = recent[recent.length - 1].v - recent[0].v;
    return dt > 0 ? Math.round(dv / dt) : 0;
  }, [timeline]);

  // Rough health score based on context usage and burn rate
  const healthScore = useMemo(() => {
    const ctx = agent.contextUsage || 0;
    let score = 100;
    if (ctx > 90) score -= 50;
    else if (ctx > 70) score -= 25;
    else if (ctx > 50) score -= 10;
    if (burnRate > 5000) score -= 15;
    else if (burnRate > 3000) score -= 8;
    if (agent.status === 'crashed') score = 10;
    if (agent.status === 'completed') score = 95;
    return Math.max(0, Math.min(100, score));
  }, [agent.contextUsage, agent.status, burnRate]);

  return (
    <div className="px-5 py-5 space-y-5 overflow-y-auto h-full">
      {/* Token Sparkline */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider">Token Burn</span>
          {isAlive && <span className="text-2xs text-accent font-mono animate-pulse">LIVE</span>}
        </div>
        <SparklineChart data={timeline} isAlive={isAlive} height={56} />
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard
          icon={Flame}
          label="Burn Rate"
          value={burnRate > 0 ? `${fmtNum(burnRate)}/m` : '—'}
          color={burnRate > 5000 ? 'text-danger' : burnRate > 2000 ? 'text-warning' : 'text-text-0'}
        />
        <MetricCard
          icon={DollarSign}
          label="Cost"
          value={fmtDollar(agent.costUsd || 0)}
          color="text-text-0"
        />
        <MetricCard
          icon={RotateCw}
          label="Rotations"
          value={agent.rotations || '0'}
          color="text-text-0"
        />
        <MetricCard
          icon={Zap}
          label="Turns"
          value={agent.turns || '0'}
          color="text-text-0"
        />
      </div>

      {/* Session Health */}
      <HealthBar score={healthScore} />

      {/* Original Prompt */}
      {agent.prompt && (
        <div>
          <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider block mb-1.5">Task</span>
          <div className="bg-surface-0 rounded-lg px-3 py-2.5 text-xs text-text-2 font-sans leading-relaxed max-h-28 overflow-y-auto border border-border-subtle">
            {agent.prompt}
          </div>
        </div>
      )}

      {/* Activity Timeline */}
      {activityLog.length > 0 && (
        <div>
          <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider block mb-2">Activity</span>
          <div className="space-y-0 relative">
            {/* Vertical line */}
            <div className="absolute left-[9px] top-2 bottom-2 w-px bg-border-subtle" />
            {activityLog.slice(-12).reverse().map((entry, i) => {
              const meta = activityIcon(entry.text);
              const Icon = meta.icon;
              return (
                <div key={i} className="flex items-start gap-3 py-1.5 relative">
                  <div className={cn(
                    'w-[18px] h-[18px] rounded-full flex items-center justify-center flex-shrink-0 z-10',
                    'bg-surface-1 border border-border-subtle',
                  )}>
                    <Icon size={9} className={meta.color} />
                  </div>
                  <span className="text-2xs text-text-2 font-sans flex-1 line-clamp-1 pt-0.5">{entry.text}</span>
                  <span className="text-2xs text-text-4 font-mono flex-shrink-0 pt-0.5">{timeAgo(entry.timestamp)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
