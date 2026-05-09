// FSL-1.1-Apache-2.0 — see LICENSE
import { useGrooveStore } from '../../stores/groove';
import { TuningSlider } from '../ui/slider';
import { Tooltip } from '../ui/tooltip';
import { RotateCcw } from 'lucide-react';

const DEFAULTS = {
  temperature: 0.7, topP: 0.9, topK: 40, repeatPenalty: 1.1,
  maxTokens: 2048, frequencyPenalty: 0, presencePenalty: 0,
};

const SLIDERS = [
  { key: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.01 },
  { key: 'topP', label: 'Top P', min: 0, max: 1, step: 0.01 },
  { key: 'topK', label: 'Top K', min: 0, max: 200, step: 1 },
  { key: 'repeatPenalty', label: 'Repeat Penalty', min: 0, max: 2, step: 0.01 },
  { key: 'maxTokens', label: 'Max Tokens', min: 1, max: 32768, step: 1, format: (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v },
  { key: 'frequencyPenalty', label: 'Freq Penalty', min: 0, max: 2, step: 0.01 },
  { key: 'presencePenalty', label: 'Pres Penalty', min: 0, max: 2, step: 0.01 },
];

export function ParameterPanel() {
  const parameters = useGrooveStore((s) => s.labParameters);
  const setParameter = useGrooveStore((s) => s.setLabParameter);

  function handleReset() {
    for (const [key, value] of Object.entries(DEFAULTS)) {
      setParameter(key, value);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-2xs font-semibold font-sans text-text-3 uppercase tracking-wider">Parameters</span>
        <Tooltip content="Reset to defaults">
          <button
            onClick={handleReset}
            className="p-1 text-text-4 hover:text-accent transition-colors cursor-pointer"
          >
            <RotateCcw size={11} />
          </button>
        </Tooltip>
      </div>
      {SLIDERS.map((s) => (
        <TuningSlider
          key={s.key}
          label={s.label}
          value={parameters[s.key]}
          onChange={(v) => setParameter(s.key, v)}
          min={s.min}
          max={s.max}
          step={s.step}
          formatValue={s.format}
        />
      ))}
    </div>
  );
}
