// FSL-1.1-Apache-2.0 — see LICENSE
import { useMemo, memo } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { HEX } from '../../lib/theme-hex';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/badge';

const PHASE_COLORS = {
  serialize_ms: HEX.info,
  send_ms: HEX.accent,
  wait_ms: HEX.text3,
  forward_ms: HEX.success,
  queue_ms: HEX.warning,
};

const PHASE_LABELS = {
  serialize_ms: 'Serialize',
  send_ms: 'Send',
  wait_ms: 'Wait',
  forward_ms: 'Forward',
  queue_ms: 'Queue',
};

function shortAddr(addr) {
  if (!addr || typeof addr !== 'string') return '\u2014';
  if (addr.length < 14) return addr;
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
}

export const TokenWaterfall = memo(function TokenWaterfall() {
  const timing = useGrooveStore((s) => s.networkTokenTiming);

  const stages = useMemo(() => {
    if (!timing?.stages || !Array.isArray(timing.stages)) return [];
    return timing.stages;
  }, [timing]);

  if (!stages.length) {
    return (
      <div className="flex items-center justify-center py-6">
        <span className="text-xs font-mono text-text-3">Waiting for token timing data\u2026</span>
      </div>
    );
  }

  const maxRtt = Math.max(...stages.map((s) => s.rtt_ms || 1), 1);
  const phases = Object.keys(PHASE_COLORS);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-3 px-3 py-1.5 flex-wrap">
        {phases.map((p) => (
          <div key={p} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: PHASE_COLORS[p] }} />
            <span className="text-2xs font-mono text-text-3">{PHASE_LABELS[p]}</span>
          </div>
        ))}
      </div>

      {stages.map((stage, i) => {
        const rtt = stage.rtt_ms || 1;
        const tel = stage.node_telemetry;
        const gpuModel = tel?.gpu_model;
        const device = tel?.device;

        return (
          <div key={i} className="flex items-center gap-2 px-3 py-1">
            <div className="w-[110px] flex-shrink-0 flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-2xs font-mono text-text-2 truncate">{shortAddr(stage.node)}</span>
                <Badge variant={stage.via === 'p2p' ? 'success' : 'warning'} className="text-2xs px-1 py-0 leading-tight">
                  {stage.via || '?'}
                </Badge>
              </div>
              {gpuModel && (
                <div className="flex items-center gap-1">
                  {device && (
                    <span className={cn(
                      'text-2xs font-mono px-1 py-0 rounded leading-tight',
                      device === 'cuda' ? 'bg-info/20 text-info' : 'bg-purple/20 text-purple',
                    )}>
                      {device}
                    </span>
                  )}
                  <span className="text-2xs font-mono text-text-4 truncate">{gpuModel}</span>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0 h-4 bg-surface-2 rounded-sm overflow-hidden relative flex">
              {phases.map((p) => {
                const ms = stage[p] || 0;
                const pct = (ms / maxRtt) * 100;
                return (
                  <div
                    key={p}
                    className="h-full flex-shrink-0 transition-all"
                    style={{ width: `${pct}%`, background: PHASE_COLORS[p] }}
                    title={`${PHASE_LABELS[p]}: ${ms.toFixed(1)}ms`}
                  />
                );
              })}
            </div>
            <span className="text-2xs font-mono text-text-3 tabular-nums w-[52px] text-right flex-shrink-0">
              {rtt.toFixed(1)}ms
            </span>
          </div>
        );
      })}
    </div>
  );
});
