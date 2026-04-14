// FSL-1.1-Apache-2.0 — see LICENSE
import { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useGrooveStore } from '../../stores/groove';
import { AnimatePresence, motion } from 'framer-motion';

const ICONS = {
  success: CheckCircle,
  error:   AlertCircle,
  info:    Info,
  warning: AlertTriangle,
};

const BORDER_COLORS = {
  success: 'border-l-success',
  error:   'border-l-danger',
  info:    'border-l-accent',
  warning: 'border-l-warning',
};

const ICON_COLORS = {
  success: 'text-success',
  error:   'text-danger',
  info:    'text-accent',
  warning: 'text-warning',
};

const DURATIONS = {
  success: 3000,
  error:   0, // stays until dismissed
  info:    5000,
  warning: 5000,
};

function ToastItem({ toast }) {
  const removeToast = useGrooveStore((s) => s.removeToast);
  const Icon = ICONS[toast.type] || Info;
  const duration = DURATIONS[toast.type];

  useEffect(() => {
    if (!duration) return;
    const timer = setTimeout(() => removeToast(toast.id), duration);
    return () => clearTimeout(timer);
  }, [toast.id, duration, removeToast]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'w-80 border border-border bg-surface-1 shadow-xl',
        'border-l-2 flex items-center gap-3 px-4 py-3',
        BORDER_COLORS[toast.type],
      )}
    >
      <Icon size={16} className={cn('flex-shrink-0', ICON_COLORS[toast.type])} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-0 font-sans">{toast.message}</p>
        {toast.detail && (
          <p className="text-xs text-text-3 font-sans mt-0.5">{toast.detail}</p>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); removeToast(toast.id); }}
        className="p-1.5 text-text-4 hover:text-text-1 hover:bg-surface-5 rounded transition-colors cursor-pointer flex-shrink-0 z-10"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}

export function ToastContainer() {
  const toasts = useGrooveStore((s) => s.toasts);

  return (
    <div className="fixed bottom-10 left-[60px] z-[100] flex flex-col-reverse gap-2">
      <AnimatePresence mode="popLayout">
        {toasts.slice(-3).map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </div>
  );
}
