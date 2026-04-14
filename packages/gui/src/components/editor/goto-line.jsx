// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef } from 'react';

export function GotoLine({ currentLine, onGoto, onClose }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      const line = parseInt(value, 10);
      if (line > 0) onGoto(line);
      onClose();
    }
    if (e.key === 'Escape') onClose();
  }

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-surface-2 border border-border rounded-lg shadow-xl p-2">
      <label className="text-2xs font-sans text-text-3 whitespace-nowrap">Go to Line:</label>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={onClose}
        placeholder={String(currentLine)}
        className="w-20 h-6 px-2 text-xs bg-surface-0 border border-border-subtle rounded text-text-0 font-mono focus:outline-none focus:border-accent"
      />
    </div>
  );
}
