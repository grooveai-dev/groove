// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { cn } from '../../lib/cn';

const RootNode = memo(({ data }) => {
  const { agentCount, runningCount } = data;
  const isActive = runningCount > 0;

  // Handles are positioned on the outer orbit ring (14px beyond core)
  // Core is 56px (w-14), orbit at inset-[-14px] = 84px diameter
  // Handle offset: push handles out so edges connect at the ring
  const handleStyle = { background: 'transparent', border: 0, width: 2, height: 2 };

  return (
    <div className="relative flex items-center justify-center" style={{ width: 84, height: 84 }}>
      {/* Outer orbit ring */}
      <div
        className={cn(
          'absolute inset-0 rounded-full transition-all duration-500',
          isActive && 'animate-[spin-slow_30s_linear_infinite]',
        )}
        style={{
          border: `1px dashed ${isActive ? 'rgba(97,175,239,0.5)' : 'rgba(97,175,239,0.25)'}`,
        }}
      />

      {/* Inner glow */}
      <div
        className="absolute inset-[10px] rounded-full"
        style={{
          background: isActive
            ? 'radial-gradient(circle, rgba(97,175,239,0.15) 0%, transparent 70%)'
            : 'radial-gradient(circle, rgba(97,175,239,0.05) 0%, transparent 70%)',
          animation: isActive ? 'node-pulse-bar 2.5s ease-in-out infinite' : 'none',
        }}
      />

      {/* Core circle */}
      <div className={cn(
        'w-14 h-14 rounded-full flex items-center justify-center relative z-10 transition-all duration-300',
        isActive
          ? 'bg-[#1c1f26] border-2 border-[#61afef]/35 shadow-[0_0_28px_rgba(97,175,239,0.15)]'
          : 'bg-[#1c1f26] border border-[#61afef]/20',
      )}>
        <img src="/favicon.png" alt="G" className={cn('h-7 w-7 rounded-full transition-opacity', isActive ? 'opacity-90' : 'opacity-60')} />
      </div>

      {/* Count badge */}
      {agentCount > 0 && (
        <div className={cn(
          'absolute z-20 min-w-[20px] h-[20px] rounded-sm flex items-center justify-center',
          'text-[10px] font-mono font-bold px-1 transition-all duration-300',
          isActive
            ? 'bg-[#1c1f26] text-[#61afef] border border-[#61afef]/40'
            : 'bg-[#1c1f26] text-[#61afef]/60 border border-[#61afef]/20',
        )}
        style={{ bottom: 2, right: 2 }}
        >
          {agentCount}
        </div>
      )}

      {/* Handles at the orbit ring edge (42px from center = edge of 84px box) */}
      <Handle id="bottom" type="source" position={Position.Bottom} style={handleStyle} />
      <Handle id="right" type="source" position={Position.Right} style={handleStyle} />
      <Handle id="left" type="source" position={Position.Left} style={handleStyle} />
      <Handle id="top" type="source" position={Position.Top} style={handleStyle} />
    </div>
  );
});

RootNode.displayName = 'RootNode';
export { RootNode };
