// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { HEX } from '../../lib/theme-hex';

const SIZE = 36;
const STROKE = 3;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const START_ANGLE = -90;

function gaugeColor() {
  return HEX.accent;
}

function MiniGauge({ name, pct, threshold }) {
  const color = gaugeColor(pct);
  const dashLen = (pct / 100) * CIRCUMFERENCE;

  return (
    <div className="flex flex-col items-center gap-0.5" title={`${name}: ${pct}% context used`}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
          fill="none" strokeWidth={STROKE}
          className="stroke-surface-4"
        />
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
          fill="none" strokeWidth={STROKE}
          strokeLinecap="round"
          style={{
            stroke: color,
            strokeDasharray: `${dashLen} ${CIRCUMFERENCE - dashLen}`,
            strokeDashoffset: 0,
            transition: 'stroke-dasharray 0.5s ease',
          }}
          transform={`rotate(${START_ANGLE} ${SIZE / 2} ${SIZE / 2})`}
        />
        {threshold && (
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
            fill="none" strokeWidth={1}
            strokeLinecap="butt"
            style={{
              stroke: HEX.accent,
              strokeDasharray: `1 ${CIRCUMFERENCE - 1}`,
              strokeDashoffset: -(threshold / 100) * CIRCUMFERENCE,
            }}
            transform={`rotate(${START_ANGLE} ${SIZE / 2} ${SIZE / 2})`}
          />
        )}
        <text
          x={SIZE / 2} y={SIZE / 2 + 1}
          textAnchor="middle" dominantBaseline="central"
          className="fill-text-1 font-mono font-semibold"
          style={{ fontSize: 9 }}
        >
          {pct}
        </text>
      </svg>
      <span className="text-2xs font-mono text-text-3 truncate max-w-[40px] leading-none">{name}</span>
    </div>
  );
}

function FleetSummary({ zones }) {
  return (
    <div className="flex items-center gap-2 text-2xs font-mono">
      <span className="text-text-2">{zones.healthy}</span>
      <span className="text-text-4">/</span>
      <span className="text-text-2">{zones.warning}</span>
      <span className="text-text-4">/</span>
      <span className="text-text-2">{zones.critical}</span>
    </div>
  );
}

const ContextGauges = memo(function ContextGauges({ agentBreakdown }) {
  const alive = (agentBreakdown || []).filter(
    (a) => a.status === 'running' || a.status === 'starting',
  );
  if (alive.length === 0) return null;

  const zones = { healthy: 0, warning: 0, critical: 0 };
  for (const a of alive) {
    const pct = Math.round((a.contextUsage || 0) * 100);
    if (pct > 80) zones.critical++;
    else if (pct > 60) zones.warning++;
    else zones.healthy++;
  }

  return (
    <div className="px-3 py-2 flex-shrink-0 border-b border-border">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Context Health</span>
        <FleetSummary zones={zones} />
      </div>
      <div className="flex items-start gap-2 overflow-x-auto">
        {alive.map((a) => {
          const pct = Math.round((a.contextUsage || 0) * 100);
          const threshold = a.rotationThreshold ? Math.round(a.rotationThreshold * 100) : null;
          return <MiniGauge key={a.id} name={a.name} pct={pct} threshold={threshold} />;
        })}
      </div>
    </div>
  );
});

export { ContextGauges };
