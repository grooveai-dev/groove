// FSL-1.1-Apache-2.0 — see LICENSE

import { motion } from 'framer-motion';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/badge';
import { CheckCircle2, Download, Loader2, AlertCircle, Check, RotateCcw } from 'lucide-react';

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
  onInstall,
  gradientFrom,
  letter,
  statusChecking,
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        'relative flex flex-col rounded-md border p-6 transition-all duration-200',
        'bg-surface-2 hover:bg-surface-3 hover:shadow-lg hover:shadow-black/20',
        selected
          ? 'border-accent ring-1 ring-accent/30 shadow-md shadow-accent/10'
          : 'border-border-subtle',
        installing && 'pointer-events-none opacity-70',
      )}
    >
      {/* Selected checkmark */}
      {selected && (
        <div className="absolute top-3 left-3 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
          <Check className="w-3 h-3 text-surface-0" strokeWidth={3} />
        </div>
      )}

      {/* Header row */}
      <div className="flex items-start gap-4 mb-5">
        <div
          className={cn(
            'w-14 h-14 rounded-md flex items-center justify-center text-lg font-bold font-mono shrink-0',
            gradientFrom,
          )}
        >
          {letter}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text-0">{name}</h3>
            {recommended && (
              <Badge variant="purple" className="text-2xs">Recommended</Badge>
            )}
          </div>
          <p className="text-xs text-text-2 mt-0.5">{subtitle}</p>
        </div>
      </div>

      {/* Model tags */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {models.map((m) => (
          <span key={m} className="text-xs text-text-2 bg-surface-4 px-2 py-0.5 rounded font-mono">
            {m}
          </span>
        ))}
      </div>

      <p className="text-2xs text-text-3 mb-4">{authType}</p>

      {/* Status / Action area */}
      <div className="mt-auto pt-4 border-t border-border-subtle">
        {installing ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-accent animate-spin" />
              <span className="text-xs text-accent font-medium">Installing...</span>
            </div>
            <div className="h-1 bg-surface-4 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-accent rounded-full"
                initial={{ width: '0%' }}
                animate={{ width: '90%' }}
                transition={{ duration: 15, ease: 'easeOut' }}
              />
            </div>
          </div>
        ) : installed ? (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-success" />
            <span className="text-xs text-success font-medium">Ready</span>
          </div>
        ) : failed ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-danger" />
              <span className="text-xs text-danger font-medium">Failed</span>
            </div>
            <button
              type="button"
              className="h-8 px-5 rounded-full text-xs font-medium bg-danger/15 text-danger hover:bg-danger/25 transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger flex items-center gap-1.5"
              onClick={(e) => { e.stopPropagation(); onInstall?.(id); }}
            >
              <RotateCcw className="w-3 h-3" />
              Retry
            </button>
          </div>
        ) : statusChecking ? (
          <div className="flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 text-text-4 animate-spin" />
            <span className="text-xs text-text-4">Checking...</span>
          </div>
        ) : (
          <div className="flex items-center justify-end">
            <button
              type="button"
              className="h-8 px-5 rounded-full text-xs font-medium bg-accent text-surface-0 hover:bg-accent/80 transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent flex items-center gap-1.5"
              onClick={(e) => { e.stopPropagation(); onInstall?.(id); }}
            >
              <Download className="w-3.5 h-3.5" />
              Install
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
