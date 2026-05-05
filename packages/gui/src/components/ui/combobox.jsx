// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '../../lib/cn';
import { ChevronDown } from 'lucide-react';

export function Combobox({ value, onChange, options = [], placeholder, className, renderOption }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  const filtered = query
    ? options.filter((o) => (o.name || o.id).toLowerCase().includes(query.toLowerCase()))
    : options;

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setHighlightIndex(-1);
  }, [query, open]);

  const handleSelect = useCallback((val) => {
    onChange(val);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }, [onChange]);

  function handleKeyDown(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIndex >= 0 && filtered[highlightIndex]) {
        handleSelect(filtered[highlightIndex].id || filtered[highlightIndex].name);
      } else if (query.trim()) {
        handleSelect(query.trim());
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }

  const displayValue = value && !open ? (options.find((o) => (o.id || o.name) === value)?.name || value) : query;

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      <div className="relative">
        <input
          ref={inputRef}
          value={displayValue}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            'h-8 w-full rounded-md pl-3 pr-8 text-sm',
            'bg-surface-1 border border-border text-text-0 font-sans',
            'placeholder:text-text-4',
            'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
            'transition-colors duration-100',
          )}
        />
        <ChevronDown
          size={12}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-4 pointer-events-none"
        />
      </div>

      {open && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-surface-1 border border-border rounded-md shadow-xl py-1 max-h-48 overflow-y-auto">
          {filtered.map((option, i) => (
            <button
              key={option.id || option.name}
              onClick={() => handleSelect(option.id || option.name)}
              onMouseEnter={() => setHighlightIndex(i)}
              className={cn(
                'w-full text-left px-3 py-1.5 text-sm font-sans cursor-pointer transition-colors',
                (option.id || option.name) === value && 'text-accent',
                highlightIndex === i ? 'bg-accent/10 text-text-0' : 'text-text-2 hover:bg-surface-5 hover:text-text-0',
              )}
            >
              {renderOption ? renderOption(option) : (option.name || option.id)}
            </button>
          ))}
        </div>
      )}

      {open && filtered.length === 0 && query && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-surface-1 border border-border rounded-md shadow-xl py-2 px-3">
          <p className="text-xs text-text-3 font-sans">
            Press Enter to use &ldquo;{query}&rdquo;
          </p>
        </div>
      )}
    </div>
  );
}
