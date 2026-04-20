// FSL-1.1-Apache-2.0 — see LICENSE
import { useGrooveStore } from '../../stores/groove';
import { AsciiGauge } from './AsciiGauge';

const MAX_RAM_MB = 256 * 1024;
const MAX_VRAM_MB = 128 * 1024;
const MAX_CPU = 128;
const MAX_BW = 10000;
const MAX_LOAD = 4.0;

export function ComputeHeader() {
  const compute = useGrooveStore((s) => s.networkCompute);
  const allZero = !compute.totalRamMb && !compute.totalVramMb && !compute.totalCpuCores && !compute.totalBandwidthMbps;

  return (
    <div className="border border-border-subtle bg-surface-0 rounded-sm p-3">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-2xs font-mono text-text-4 tracking-wider">--- NETWORK COMPUTE ---</span>
        <div className="flex-1 h-px bg-border-subtle" />
        {compute.totalNodes > 0 && (
          <span className="text-2xs font-mono text-text-3 tabular-nums">
            {compute.activeNodes}/{compute.totalNodes} online
          </span>
        )}
      </div>
      {allZero ? (
        <div className="text-2xs font-mono text-text-4 py-2">
          Waiting for node data...
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <AsciiGauge label="RAM" value={compute.totalRamMb} max={MAX_RAM_MB} unit="GB" nodeCount={compute.totalNodes} />
          <AsciiGauge label="VRAM" value={compute.totalVramMb} max={MAX_VRAM_MB} unit="GB" nodeCount={compute.totalNodes} />
          <AsciiGauge label="CPU" value={compute.totalCpuCores} max={MAX_CPU} unit="cores" />
          <AsciiGauge label="BW" value={compute.totalBandwidthMbps} max={MAX_BW} unit="Mbps" />
          <AsciiGauge label="LOAD" value={compute.avgLoad} max={MAX_LOAD} unit="%" />
        </div>
      )}
    </div>
  );
}
