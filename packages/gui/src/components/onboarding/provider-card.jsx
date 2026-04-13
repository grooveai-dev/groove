// FSL-1.1-Apache-2.0 — see LICENSE

import { useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/badge';
import { CheckCircle2, Download, Loader2, AlertCircle } from 'lucide-react';

const statusIcons = {
  installed: <CheckCircle2 className="w-4 h-4 text-success" />,
  installing: <Loader2 className="w-4 h-4 text-accent animate-spin" />,
  failed: <AlertCircle className="w-4 h-4 text-danger" />,
};

export function ProviderCard({
  id,
  name,
  subtitle,
  models,
  authType,
  recommended,
  installed,
  installing,
  failed,
  selected,
  onToggle,
  onInstall,
  gradientFrom,
  letter,
}) {
  const status = installing ? 'installing' : installed ? 'installed' : failed ? 'failed' : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        'relative flex flex-col rounded-md border p-5 transition-all duration-200 cursor-pointer',
        'bg-surface-2 hover:bg-surface-3',
        selected ? 'border-accent ring-1 ring-accent/30' : 'border-border-subtle',
        installing && 'pointer-events-none opacity-70',
      )}
      onClick={() => !installing && onToggle?.(id)}
    >
      {recommended && (
        <Badge variant="purple" className="absolute top-3 right-3">Recommended</Badge>
      )}

      <div className="flex items-start gap-4 mb-4">
        <div
          className={cn(
            'w-12 h-12 rounded-md flex items-center justify-center text-lg font-bold font-mono shrink-0',
            gradientFrom,
          )}
        >
          {letter}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-0">{name}</h3>
          <p className="text-xs text-text-3">{subtitle}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {models.map((m) => (
          <span key={m} className="text-2xs text-text-2 bg-surface-4 px-1.5 py-0.5 rounded font-mono">
            {m}
          </span>
        ))}
      </div>

      <p className="text-2xs text-text-3 mb-4">{authType}</p>

      <div className="mt-auto flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {status && statusIcons[status]}
          <span className={cn(
            'text-xs',
            installed ? 'text-success' : failed ? 'text-danger' : 'text-text-3',
          )}>
            {installing ? 'Installing...' : installed ? 'Installed' : failed ? 'Install failed' : 'Not installed'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className={cn(
              'h-7 px-3 rounded-full text-xs font-medium transition-colors duration-100 cursor-pointer',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
              installed
                ? 'bg-success/12 text-success pointer-events-none'
                : 'bg-accent text-surface-0 hover:bg-accent/80',
            )}
            disabled={installed || installing}
            onClick={(e) => { e.stopPropagation(); onInstall?.(id); }}
          >
            {installing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : installed ? (
              'Installed'
            ) : (
              <span className="flex items-center gap-1.5">
                <Download className="w-3 h-3" />
                Install
              </span>
            )}
          </button>

          <div
            className={cn(
              'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors duration-100',
              selected ? 'bg-accent border-accent' : 'border-border bg-transparent',
            )}
            role="checkbox"
            aria-checked={selected}
            aria-label={`Select ${name}`}
          >
            {selected && (
              <svg className="w-3 h-3 text-surface-0" viewBox="0 0 12 12" fill="none">
                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        </div>
      </div>

      {installing && (
        <div className="mt-3">
          <div className="h-1 bg-surface-4 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-accent rounded-full"
              initial={{ width: '0%' }}
              animate={{ width: '90%' }}
              transition={{ duration: 15, ease: 'easeOut' }}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}
