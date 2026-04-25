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
    <div className={cn('flex items-center gap-3 h-10', disabled && 'opacity-40 pointer-events-none', className)}>
      <span className="text-xs text-text-2 font-sans w-28 shrink-0">{label}</span>
      <span className="text-2xs text-text-4 font-mono w-6 text-right shrink-0">{min}</span>
      <div className="relative flex-1 flex items-center group">
        <div className="absolute inset-y-0 flex items-center w-full pointer-events-none">
          <div className="w-full h-1.5 rounded-full bg-surface-5 overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-all"
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
          className="relative w-full h-4 appearance-none bg-transparent cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:border-2
            [&::-webkit-slider-thumb]:border-surface-1 [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(51,175,188,0.4)]
            [&::-webkit-slider-thumb]:hover:shadow-[0_0_10px_rgba(51,175,188,0.6)]
            [&::-webkit-slider-thumb]:transition-shadow
            [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-surface-1
            [&::-moz-range-thumb]:shadow-[0_0_6px_rgba(51,175,188,0.4)]
            [&::-moz-range-track]:bg-transparent
            disabled:cursor-not-allowed"
        />
      </div>
      <span className="text-2xs text-text-4 font-mono w-6 shrink-0">{max}</span>
      <span className="text-xs text-accent font-mono font-semibold w-10 text-right shrink-0">{display}</span>
    </div>
  );
}
