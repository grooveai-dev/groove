// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect, useCallback } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { File, Folder, Search, X } from 'lucide-react';
import { api } from '../../lib/api';

const FILE_COLORS = {
  js: 'text-text-2', jsx: 'text-text-2', ts: 'text-text-2', tsx: 'text-text-2',
  css: 'text-text-3', html: 'text-text-3', json: 'text-text-3',
  md: 'text-text-3', py: 'text-text-2', rs: 'text-text-3',
};

function getFileColor(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  return FILE_COLORS[ext] || 'text-text-3';
}

export function QuickSearch() {
  const open = useGrooveStore((s) => s.editorQuickSearchOpen);
  const setOpen = useGrooveStore((s) => s.setEditorQuickSearchOpen);
  const openFile = useGrooveStore((s) => s.openFile);
  const setActiveView = (v) => useGrooveStore.setState({ activeView: v });

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    function handleKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        setOpen(!open);
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, setOpen]);

  const search = useCallback(async (q) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const data = await api.get(`/files/search?q=${encodeURIComponent(q)}`);
      setResults(data.results || data.files || []);
      setSelectedIndex(0);
    } catch {
      setResults([]);
    }
    setLoading(false);
  }, []);

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 200);
  }

  function handleSelect(path) {
    setOpen(false);
    const state = useGrooveStore.getState();
    if (state.activeView !== 'editor') setActiveView('editor');
    openFile(path);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      const item = results[selectedIndex];
      if (item) handleSelect(item.path || item);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={() => setOpen(false)}>
      <div
        className="w-[520px] bg-surface-2 border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <Search size={14} className="text-text-4 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Search files by name..."
            className="flex-1 bg-transparent text-sm text-text-0 font-sans placeholder:text-text-4 focus:outline-none"
          />
          {query && (
            <button onClick={() => { setQuery(''); setResults([]); }} className="text-text-4 hover:text-text-1 cursor-pointer">
              <X size={12} />
            </button>
          )}
        </div>

        {/* Results */}
        <div className="max-h-[320px] overflow-y-auto">
          {loading && (
            <div className="px-4 py-6 text-center text-xs text-text-4 font-sans">Searching...</div>
          )}
          {!loading && query && results.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-text-4 font-sans">No files found</div>
          )}
          {!loading && results.map((item, i) => {
            const path = item.path || item;
            const name = path.split('/').pop();
            const dir = path.split('/').slice(0, -1).join('/');
            const isDir = item.type === 'dir';

            return (
              <button
                key={path}
                onClick={() => handleSelect(path)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-4 py-2 text-left cursor-pointer transition-colors',
                  i === selectedIndex ? 'bg-accent/10' : 'hover:bg-surface-4',
                )}
              >
                {isDir
                  ? <Folder size={14} className="text-accent flex-shrink-0" />
                  : <File size={14} className={cn('flex-shrink-0', getFileColor(name))} />
                }
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-sans text-text-0">{name}</span>
                  {dir && <span className="text-2xs text-text-4 font-sans ml-2 truncate">{dir}</span>}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-border-subtle text-2xs text-text-4 font-sans">
          <span><kbd className="px-1 py-0.5 rounded bg-surface-4 text-text-3 font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="px-1 py-0.5 rounded bg-surface-4 text-text-3 font-mono">↵</kbd> open</span>
          <span><kbd className="px-1 py-0.5 rounded bg-surface-4 text-text-3 font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
