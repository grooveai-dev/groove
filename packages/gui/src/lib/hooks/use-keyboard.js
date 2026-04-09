// FSL-1.1-Apache-2.0 — see LICENSE
import { useEffect } from 'react';

/**
 * Register global keyboard shortcuts.
 * @param {Array<{ key: string, meta?: boolean, shift?: boolean, handler: () => void }>} shortcuts
 */
export function useKeyboard(shortcuts) {
  useEffect(() => {
    function onKeyDown(e) {
      for (const s of shortcuts) {
        const metaMatch = s.meta ? (e.metaKey || e.ctrlKey) : true;
        const shiftMatch = s.shift ? e.shiftKey : !e.shiftKey;
        if (e.key.toLowerCase() === s.key.toLowerCase() && metaMatch && shiftMatch) {
          e.preventDefault();
          s.handler();
          return;
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [shortcuts]);
}
