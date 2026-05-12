// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { SidebarSection } from '../../views/model-lab';
import { TuningSlider } from '../ui/slider';
import { Tooltip } from '../ui/tooltip';
import { RotateCcw, ChevronRight, Dices, X, Plus } from 'lucide-react';
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

function ParamGroup({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 h-7 text-left cursor-pointer group"
      >
        <ChevronRight
          size={10}
          className={cn('text-text-4 transition-transform duration-150 flex-shrink-0', open && 'rotate-90')}
        />
        <span className="text-[10px] font-semibold text-text-4 font-sans uppercase tracking-widest">{title}</span>
      </button>
      {open && <div className="space-y-1 pl-0.5 pt-1">{children}</div>}
    </div>
  );
}

function ToggleSwitch({ label, active, onClick, description }) {
  return (
    <Tooltip content={description} side="right">
      <button
        onClick={onClick}
        className="w-full flex items-center gap-2.5 h-9 text-left cursor-pointer group"
      >
        <span className="text-[11px] font-sans text-text-2 flex-1">{label}</span>
        <div className={cn(
          'w-7 h-[16px] rounded-full transition-colors relative flex-shrink-0',
          active ? 'bg-accent' : 'bg-surface-5',
        )}>
          <div className={cn(
            'absolute top-[2px] w-3 h-3 rounded-full bg-white shadow-sm transition-all',
            active ? 'left-[14px]' : 'left-[2px]',
          )} />
        </div>
      </button>
    </Tooltip>
  );
}

function SeedInput({ value, onChange }) {
  function handleRandomize() {
    onChange(Math.floor(Math.random() * 2147483647));
  }
  return (
    <div className="space-y-2 pt-1.5">
      <span className="text-[11px] text-text-2 font-sans">Seed</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
          placeholder="Random"
          className="flex-1 min-w-0 h-7 px-2.5 text-[11px] font-mono bg-surface-1 border border-border rounded text-text-1 placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50 tabular-nums"
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
    <div className="space-y-2 pt-1.5">
      <span className="text-[11px] text-text-2 font-sans">Stop Sequences</span>
      <div className="flex items-center gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add sequence..."
          maxLength={100}
          className="flex-1 min-w-0 h-7 px-2.5 text-[11px] font-mono bg-surface-1 border border-border rounded text-text-1 placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50"
        />
        <button
          onClick={handleAdd}
          disabled={!input.trim() || sequences.length >= 10}
          className="p-0.5 text-text-4 hover:text-accent disabled:opacity-30 transition-colors cursor-pointer"
        >
          <Plus size={12} />
        </button>
      </div>
      {sequences.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {sequences.map((s, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-surface-2 border border-border-subtle rounded text-[10px] font-mono text-text-2">
              {s.length > 12 ? s.slice(0, 12) + '...' : s}
              <button onClick={() => handleRemove(i)} className="text-text-4 hover:text-danger cursor-pointer"><X size={8} /></button>
            </span>
          ))}
        </div>
      )}
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
    <SidebarSection
      label="Parameters"
      collapsible
      defaultOpen={false}
      action={
        <Tooltip content="Reset to defaults">
          <button
            onClick={handleReset}
            className="p-1 text-text-4 hover:text-accent transition-colors cursor-pointer"
          >
            <RotateCcw size={11} />
          </button>
        </Tooltip>
      }
    >
      <div className="space-y-0.5 rounded-md bg-surface-1/50 border border-border-subtle px-3 py-2">
        <ToggleSwitch
          label="Thinking"
          active={parameters.thinking}
          onClick={() => setParameter('thinking', !parameters.thinking)}
          description="Chain-of-thought for supported models (Qwen3, etc.)"
        />
        <ToggleSwitch
          label="JSON Mode"
          active={parameters.jsonMode}
          onClick={() => setParameter('jsonMode', !parameters.jsonMode)}
          description="Constrain output to valid JSON"
        />
      </div>

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
    </SidebarSection>
  );
}
