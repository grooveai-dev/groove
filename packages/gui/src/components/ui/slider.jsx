// FSL-1.1-Apache-2.0 — see LICENSE
import { cn } from '../../lib/cn';

export function TuningSlider({
  label, value, onChange, min = 0, max = 100, step = 1,
  formatValue, displayValue, disabled, className,
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const fmt = displayValue || formatValue;
  const display = typeof fmt === 'function' ? fmt(value) : (typeof fmt === 'string' ? fmt : value);

  return (
    <div className={cn('group flex items-center gap-2.5 h-8', disabled && 'opacity-40 pointer-events-none', className)}>
      <span className="text-[11px] text-text-2 font-sans w-[76px] shrink-0 truncate">{label}</span>
      <div className="relative flex-1 flex items-center h-5">
        <div className="absolute inset-y-0 flex items-center w-full pointer-events-none">
          <div className="w-full h-[3px] rounded-full bg-surface-5">
            <div
              className="h-full rounded-full bg-accent/60 group-hover:bg-accent transition-colors"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative w-full h-5 appearance-none bg-transparent cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent
            [&::-webkit-slider-thumb]:shadow-[0_0_0_2px_var(--color-surface-1)]
            [&::-webkit-slider-thumb]:hover:shadow-[0_0_0_2px_var(--color-surface-1),0_0_6px_rgba(51,175,188,0.35)]
            [&::-webkit-slider-thumb]:active:scale-110
            [&::-webkit-slider-thumb]:transition-all
            [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-none
            [&::-moz-range-thumb]:shadow-[0_0_0_2px_var(--color-surface-1)]
            [&::-moz-range-track]:bg-transparent
            disabled:cursor-not-allowed"
        />
      </div>
      <span className="text-[11px] text-accent font-mono font-medium w-9 text-right shrink-0 tabular-nums">{display}</span>
    </div>
  );
}
