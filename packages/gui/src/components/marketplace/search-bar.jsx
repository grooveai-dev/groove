// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../lib/cn';

export function SearchBar({ value, onChange, placeholder = 'Search skills, tags, authors...', large }) {
  const [local, setLocal] = useState(value || '');
  const timerRef = useRef(null);

  useEffect(() => { setLocal(value || ''); }, [value]);

  function handleChange(e) {
    const v = e.target.value;
    setLocal(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(v), 300);
  }

  return (
    <div className="relative w-full">
      <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-4 pointer-events-none" />
      <input
        value={local}
        onChange={handleChange}
        placeholder={placeholder}
        className={cn(
          'w-full font-sans outline-none',
          'bg-surface-0 border border-border text-text-0 placeholder:text-text-4',
          'focus:border-accent/40 transition-colors',
          large ? 'py-3 pl-11 pr-12 text-[15px] rounded-lg' : 'py-2.5 pl-10 pr-3 text-sm rounded-md',
        )}
      />
      {large && (
        <kbd className="absolute right-3.5 top-1/2 -translate-y-1/2 bg-surface-4 text-text-4 px-2 py-0.5 rounded text-xs font-mono">
          /
        </kbd>
      )}
    </div>
  );
}
