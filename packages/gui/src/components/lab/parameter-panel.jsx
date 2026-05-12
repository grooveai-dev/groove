// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { TuningSlider } from '../ui/slider';
import { Tooltip } from '../ui/tooltip';
import { RotateCcw, Brain, Braces, ChevronRight, Dices, X, Plus } from 'lucide-react';
import { cn } from '../../lib/cn';

const DEFAULTS = {
  temperature: 0.7, topP: 0.9, topK: 40, minP: 0, repeatPenalty: 1.1,
  maxTokens: 2048, frequencyPenalty: 0, presencePenalty: 0,
  thinking: false, seed: null, stopSequences: [], jsonMode: false,
};

const SAMPLING_SLIDERS = [
  { key: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.01 },
  { key: 'topP', label: 'Top P', min: 0, max: 1, step: 0.01 },
  { key: 'minP', label: 'Min P', min: 0, max: 1, step: 0.01 },
  { key: 'topK', label: 'Top K', min: 0, max: 200, step: 1 },
];

const PENALTY_SLIDERS = [
  { key: 'repeatPenalty', label: 'Repeat Penalty', min: 0, max: 2, step: 0.01 },
  { key: 'frequencyPenalty', label: 'Freq Penalty', min: 0, max: 2, step: 0.01 },
  { key: 'presencePenalty', label: 'Pres Penalty', min: 0, max: 2, step: 0.01 },
];

function ParamGroup({ title, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 py-1.5 text-left cursor-pointer group"
      >
        <ChevronRight
          size={10}
          className={cn('text-text-4 transition-transform duration-150 flex-shrink-0', open && 'rotate-90')}
        />
        <span className="text-2xs font-semibold text-text-4 font-sans uppercase tracking-wider">{title}</span>
      </button>
      {open && <div className="space-y-0.5 pb-1">{children}</div>}
    </div>
  );
}

function ToggleRow({ icon: Icon, label, active, onClick, description }) {
  return (
    <Tooltip content={description} side="right">
      <button
        onClick={onClick}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1.5 rounded-sm transition-colors cursor-pointer text-left',
          active ? 'bg-accent/8' : 'hover:bg-surface-3',
        )}
      >
        <Icon size={12} className={cn(active ? 'text-accent' : 'text-text-4')} />
        <span className="flex-1 text-2xs font-sans text-text-2">{label}</span>
        <span className={cn('text-2xs font-mono', active ? 'text-accent' : 'text-text-4')}>
          {active ? 'ON' : 'OFF'}
        </span>
      </button>
    </Tooltip>
  );
}

function SeedInput({ value, onChange }) {
  function handleRandomize() {
    onChange(Math.floor(Math.random() * 2147483647));
  }
  return (
    <div className="flex items-center gap-1.5 px-2 py-1">
      <span className="text-2xs text-text-3 font-sans flex-shrink-0 w-12">Seed</span>
      <input
        type="number"
        min={0}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
        placeholder="Random"
        className="flex-1 min-w-0 h-6 px-1.5 text-2xs font-mono bg-surface-1 border border-border rounded-sm text-text-1 placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent tabular-nums"
      />
      <Tooltip content="Randomize seed">
        <button onClick={handleRandomize} className="p-0.5 text-text-4 hover:text-accent transition-colors cursor-pointer">
          <Dices size={12} />
        </button>
      </Tooltip>
      {value != null && (
        <button onClick={() => onChange(null)} className="p-0.5 text-text-4 hover:text-danger transition-colors cursor-pointer">
          <X size={10} />
        </button>
      )}
    </div>
  );
}

function StopSequenceInput({ sequences, onChange }) {
  const [input, setInput] = useState('');

  function handleAdd() {
    const val = input.trim();
    if (!val || sequences.length >= 10 || sequences.includes(val)) return;
    onChange([...sequences, val]);
    setInput('');
  }

  function handleRemove(idx) {
    onChange(sequences.filter((_, i) => i !== idx));
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
    if (e.key === 'Backspace' && !input && sequences.length) handleRemove(sequences.length - 1);
  }

  return (
    <div className="px-2 py-1 space-y-1.5">
      <span className="text-2xs text-text-3 font-sans">Stop Sequences</span>
      {sequences.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {sequences.map((s, i) => (
            <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-surface-3 rounded text-2xs font-mono text-text-2">
              {s.length > 12 ? s.slice(0, 12) + '...' : s}
              <button onClick={() => handleRemove(i)} className="text-text-4 hover:text-danger cursor-pointer"><X size={8} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add sequence..."
          maxLength={100}
          className="flex-1 min-w-0 h-6 px-1.5 text-2xs font-mono bg-surface-1 border border-border rounded-sm text-text-1 placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          onClick={handleAdd}
          disabled={!input.trim() || sequences.length >= 10}
          className="p-1 text-text-4 hover:text-accent disabled:opacity-30 transition-colors cursor-pointer"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}

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

      {/* Mode toggles */}
      <div className="space-y-px pb-1">
        <ToggleRow
          icon={Brain}
          label="Thinking"
          active={parameters.thinking}
          onClick={() => setParameter('thinking', !parameters.thinking)}
          description="Chain-of-thought for supported models (Qwen3, etc.)"
        />
        <ToggleRow
          icon={Braces}
          label="JSON Mode"
          active={parameters.jsonMode}
          onClick={() => setParameter('jsonMode', !parameters.jsonMode)}
          description="Constrain output to valid JSON"
        />
      </div>

      {/* Sampling group */}
      <ParamGroup title="Sampling">
        {SAMPLING_SLIDERS.map((s) => (
          <TuningSlider
            key={s.key}
            label={s.label}
            value={parameters[s.key]}
            onChange={(v) => setParameter(s.key, v)}
            min={s.min}
            max={s.max}
            step={s.step}
          />
        ))}
      </ParamGroup>

      {/* Generation group */}
      <ParamGroup title="Generation">
        <TuningSlider
          label="Max Tokens"
          value={parameters.maxTokens}
          onChange={(v) => setParameter('maxTokens', v)}
          min={1}
          max={32768}
          step={1}
          formatValue={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
        />
        <SeedInput value={parameters.seed} onChange={(v) => setParameter('seed', v)} />
        <StopSequenceInput
          sequences={parameters.stopSequences || []}
          onChange={(v) => setParameter('stopSequences', v)}
        />
      </ParamGroup>

      {/* Penalties group — collapsed by default */}
      <ParamGroup title="Penalties" defaultOpen={false}>
        {PENALTY_SLIDERS.map((s) => (
          <TuningSlider
            key={s.key}
            label={s.label}
            value={parameters[s.key]}
            onChange={(v) => setParameter(s.key, v)}
            min={s.min}
            max={s.max}
            step={s.step}
          />
        ))}
      </ParamGroup>
    </div>
  );
}
