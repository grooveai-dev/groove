// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { fmtNum, fmtPct, fmtUptime, timeAgo } from '../../lib/format';
import { HEX } from '../../lib/theme-hex';
import { cn } from '../../lib/cn';
import { Cpu, Clock, Flame, Activity, FolderOpen, Shield, Layers, Zap } from 'lucide-react';

const EMPTY = [];

function HeartbeatChart({ data, isAlive }) {
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

    // Area fill
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
    grad.addColorStop(0, isAlive ? 'rgba(51,175,188,0.2)' : 'rgba(110,118,129,0.1)');
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

    // Endpoint dot
    if (data.length > 1) {
      const last = data[data.length - 1];
      const x = w;
      const y = h - ((last.v - min) / range) * (h - 4) - 2;
      ctx.beginPath();
      ctx.arc(x - 1, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = isAlive ? HEX.accent : HEX.text3;
      ctx.fill();
    }
  }, [data, isAlive]);

  return (
    <div className="h-16 w-full rounded-lg bg-surface-0 overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, mono }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border-subtle last:border-0">
      <Icon size={14} className="text-text-4 flex-shrink-0" />
      <span className="text-xs text-text-3 font-sans flex-1">{label}</span>
      <span className={cn('text-xs text-text-0', mono ? 'font-mono' : 'font-sans')}>{value}</span>
    </div>
  );
}

export function AgentStats({ agent }) {
  const timeline = useGrooveStore((s) => s.tokenTimeline[agent.id]) || EMPTY;
  const activityLog = useGrooveStore((s) => s.activityLog[agent.id]) || EMPTY;
  const isAlive = agent.status === 'running' || agent.status === 'starting';
  const spawned = agent.spawnedAt || agent.createdAt;
  const uptime = spawned ? Math.floor((Date.now() - new Date(spawned).getTime()) / 1000) : 0;

  let burnRate = 0;
  if (timeline.length >= 2) {
    const recent = timeline.slice(-10);
    const dt = (recent[recent.length - 1].t - recent[0].t) / 60000;
    const dv = recent[recent.length - 1].v - recent[0].v;
    if (dt > 0) burnRate = Math.round(dv / dt);
  }

  return (
    <div className="px-5 py-4 space-y-5">
      {/* ── Token Heartbeat ─────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider">Token Heartbeat</span>
          {isAlive && <span className="text-2xs text-accent font-mono animate-pulse">LIVE</span>}
        </div>
        <HeartbeatChart data={timeline} isAlive={isAlive} />
        {burnRate > 0 && (
          <div className="flex items-center gap-1.5 mt-2 text-2xs text-text-3 font-sans">
            <Flame size={10} className="text-warning" />
            <span className="font-mono text-text-2">{fmtNum(burnRate)}</span>
            <span>tokens/min burn rate</span>
          </div>
        )}
      </div>

      {/* ── Details ──────────────────────────────────────── */}
      <div>
        <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider block mb-1">Agent Details</span>
        <div className="bg-surface-0 rounded-lg px-3">
          <InfoRow icon={Layers} label="Role" value={agent.role} />
          <InfoRow icon={Cpu} label="Provider" value={agent.provider || 'auto'} />
          <InfoRow icon={Zap} label="Model" value={agent.model || 'default'} mono />
          <InfoRow icon={Clock} label="Spawned" value={spawned ? timeAgo(spawned) : '—'} />
          <InfoRow icon={Activity} label="Events" value={`${activityLog.length}`} mono />
          {agent.workingDir && <InfoRow icon={FolderOpen} label="Working Dir" value={agent.workingDir} mono />}
          {agent.scope?.length > 0 && <InfoRow icon={Shield} label="Scope" value={agent.scope.join(', ')} mono />}
        </div>
      </div>

      {/* ── Original Prompt ──────────────────────────────── */}
      {agent.prompt && (
        <div>
          <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider block mb-2">Original Prompt</span>
          <div className="bg-surface-0 rounded-lg px-3 py-2.5 text-xs text-text-2 font-sans leading-relaxed max-h-32 overflow-y-auto">
            {agent.prompt}
          </div>
        </div>
      )}

      {/* ── Recent Activity ─��────────────────────────────── */}
      {activityLog.length > 0 && (
        <div>
          <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider block mb-2">Recent Activity</span>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {activityLog.slice(-10).reverse().map((entry, i) => (
              <div key={i} className="flex items-start gap-2 py-1">
                <span className="text-2xs text-text-4 font-mono flex-shrink-0 mt-0.5 w-10">{timeAgo(entry.timestamp)}</span>
                <span className="text-2xs text-text-2 font-sans line-clamp-2">{entry.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
