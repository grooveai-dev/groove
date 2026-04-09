// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '../ui/dialog';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { Folder, ChevronRight, ArrowUp } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

export function DirPicker({ open, onOpenChange, onSelect, title = 'Choose Directory' }) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get(`/browse-system?path=${encodeURIComponent(currentPath)}`)
      .then((data) => setEntries(data.entries || []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [open, currentPath]);

  function goUp() {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath(parts.length ? '/' + parts.join('/') : '/');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} className="max-w-md">
        {/* Path */}
        <div className="px-4 py-2 border-b border-border-subtle">
          <div className="flex items-center gap-2 text-xs font-mono text-text-2">
            <button onClick={goUp} className="p-1 hover:bg-surface-5 rounded cursor-pointer">
              <ArrowUp size={14} />
            </button>
            <span className="truncate">{currentPath || '/'}</span>
          </div>
        </div>

        {/* Entries */}
        <ScrollArea className="h-64">
          <div className="py-1">
            {entries.filter((e) => e.type === 'dir').map((entry) => (
              <button
                key={entry.path}
                onClick={() => setCurrentPath(entry.path)}
                className="w-full flex items-center gap-2 px-4 py-1.5 text-sm font-sans text-text-1 hover:bg-surface-5 cursor-pointer text-left"
              >
                <Folder size={14} className="text-accent flex-shrink-0" />
                <span className="truncate">{entry.name}</span>
                <ChevronRight size={12} className="ml-auto text-text-4" />
              </button>
            ))}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border-subtle flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={() => { onSelect(currentPath); onOpenChange(false); }}>
            Select
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
