// FSL-1.1-Apache-2.0 — see LICENSE
import { useGrooveStore } from '../../stores/groove';

export function useToast() {
  const addToast = useGrooveStore((s) => s.addToast);
  return {
    success: (message, detail) => addToast('success', message, detail),
    error:   (message, detail) => addToast('error', message, detail),
    info:    (message, detail) => addToast('info', message, detail),
    warning: (message, detail) => addToast('warning', message, detail),
  };
}
