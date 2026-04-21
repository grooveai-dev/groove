// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Globe, Cpu, Zap, Sparkles } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/badge';

export function formatModelName(id) {
  if (!id) return '';
  return id
    .replace(/^claude-/, '')
    .replace(/-(\d)/, ' $1')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const TIER_CONFIG = {
  frontier: { label: 'Frontier', variant: 'purple', icon: Sparkles },
  mid: { label: 'Mid', variant: 'accent', icon: Zap },
  fast: { label: 'Fast', variant: 'success', icon: Zap },
};

function getTier(model) {
  const name = (model || '').toLowerCase();
  if (name.includes('opus') || name.includes('pro') || name.includes('o3') || name.includes('gpt-4o')) return 'frontier';
  if (name.includes('sonnet') || name.includes('flash') || name.includes('o4-mini')) return 'mid';
  return 'fast';
}

function getContextSize(model) {
  const name = (model || '').toLowerCase();
  if (name.includes('opus') || name.includes('sonnet')) return '200k';
  if (name.includes('haiku')) return '200k';
  if (name.includes('pro')) return '1M';
  if (name.includes('flash')) return '1M';
  if (name.includes('o3') || name.includes('o4')) return '128k';
  return '128k';
}

export function ModelPicker({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState([]);
  const fetchProviders = useGrooveStore((s) => s.fetchProviders);
  const ref = useRef(null);

  useEffect(() => {
    fetchProviders().then((data) => {
      if (Array.isArray(data)) setProviders(data);
      else if (data?.providers) setProviders(data.providers);
    }).catch(() => {});
  }, [fetchProviders]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const currentModel = value?.model || '';
  const currentModelDisplay = currentModel ? formatModelName(currentModel) : 'Select model';
  const currentProvider = value?.provider || '';
  const isNetwork = currentProvider === 'groove-network';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={cn(
          'flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium font-sans transition-colors cursor-pointer',
          'bg-surface-4 border border-border-subtle hover:bg-surface-5',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          isNetwork && 'border-purple/30 bg-purple/8',
        )}
      >
        {isNetwork ? <Globe size={12} className="text-purple" /> : <Cpu size={12} className="text-text-3" />}
        <span className="text-text-1 max-w-[120px] truncate">{currentModelDisplay}</span>
        <ChevronDown size={12} className="text-text-4" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-72 max-h-80 overflow-y-auto rounded-lg border border-border bg-surface-1 shadow-xl z-50">
          {providers.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-text-3 font-sans">No providers available</div>
          )}
          {providers.map((provider) => {
            const models = provider.models || [];
            if (models.length === 0) return null;
            const isNetworkProvider = provider.id === 'groove-network';
            return (
              <div key={provider.id}>
                <div className="px-3 py-1.5 text-2xs font-semibold text-text-3 uppercase tracking-wider font-sans bg-surface-2 border-b border-border-subtle flex items-center gap-1.5">
                  {isNetworkProvider && <Globe size={10} className="text-purple" />}
                  {provider.name || provider.id}
                </div>
                {models.map((model) => {
                  const modelId = typeof model === 'string' ? model : model.id || model.name;
                  const modelDisplayName = typeof model === 'string' ? model : model.name || model.id;
                  const tier = getTier(modelId);
                  const tierConfig = TIER_CONFIG[tier];
                  const TierIcon = tierConfig.icon;
                  const isActive = currentModel === modelId && currentProvider === provider.id;
                  return (
                    <button
                      key={modelId}
                      onClick={() => {
                        onChange({ provider: provider.id, model: modelId });
                        setOpen(false);
                      }}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer',
                        isActive ? 'bg-accent/10 text-text-0' : 'hover:bg-surface-3 text-text-1',
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium font-sans truncate">{modelDisplayName}</div>
                        <div className="text-2xs text-text-4 font-sans">{getContextSize(modelId)} context</div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {isNetworkProvider && (
                          <Badge variant="purple" className="text-[9px]">
                            <Globe size={8} /> Decentralized
                          </Badge>
                        )}
                        <Badge variant={tierConfig.variant} className="text-[9px]">
                          <TierIcon size={8} /> {tierConfig.label}
                        </Badge>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
