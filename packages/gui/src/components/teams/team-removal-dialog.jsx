// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '../ui/dialog';
import { Button } from '../ui/button';
import { Archive, Trash2, AlertTriangle } from 'lucide-react';

export function TeamRemovalDialog({ team, open, onOpenChange, onArchive, onDeletePermanently, mode }) {
  const [confirmName, setConfirmName] = useState('');
  const [showConfirmInput, setShowConfirmInput] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirmName('');
      setShowConfirmInput(false);
    }
  }, [open]);

  const nameMatch = confirmName === (team?.name || '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Remove Team: ${team?.name || ''}`} description="Choose how to remove this team">
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-text-1 font-sans">
            What would you like to do with this team and its files?
          </p>

          {/* Archive option */}
          <button
            onClick={() => { onArchive(team?.id); onOpenChange(false); }}
            className="w-full flex items-start gap-3 p-3.5 rounded-lg border border-border-subtle bg-surface-0 hover:border-accent/30 hover:bg-surface-2 transition-all cursor-pointer text-left group"
          >
            <div className="w-8 h-8 rounded-md bg-accent/10 flex items-center justify-center flex-shrink-0 group-hover:bg-accent/20 transition-colors">
              <Archive size={16} className="text-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text-0 font-sans">Archive</div>
              <p className="text-xs text-text-3 font-sans mt-0.5">
                {mode === 'production'
                  ? 'Team metadata will be archived. Your files remain in the project directory.'
                  : 'Files are preserved. You can restore the team later.'}
              </p>
            </div>
          </button>

          {/* Delete Permanently option */}
          <div className="rounded-lg border border-danger/20 bg-danger/5 overflow-hidden">
            <button
              onClick={() => setShowConfirmInput(true)}
              className="w-full flex items-start gap-3 p-3.5 cursor-pointer text-left group"
            >
              <div className="w-8 h-8 rounded-md bg-danger/10 flex items-center justify-center flex-shrink-0 group-hover:bg-danger/20 transition-colors">
                <Trash2 size={16} className="text-danger" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-danger font-sans">Delete Permanently</div>
                <p className="text-xs text-text-3 font-sans mt-0.5">
                  {mode === 'production'
                    ? 'Team will be removed. Your files remain in the project directory.'
                    : 'All files in this team will be permanently deleted.'}
                </p>
              </div>
            </button>

            {showConfirmInput && (
              <div className="px-3.5 pb-3.5 space-y-2">
                <div className="flex items-center gap-1.5 text-2xs text-warning font-sans">
                  <AlertTriangle size={11} />
                  <span>Type <span className="font-mono font-semibold text-text-0">{team?.name}</span> to confirm</span>
                </div>
                <input
                  type="text"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={team?.name}
                  className="w-full h-8 px-3 text-xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-danger"
                  autoFocus
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && nameMatch) {
                      onDeletePermanently(team?.id);
                      onOpenChange(false);
                    }
                    if (e.key === 'Escape') setShowConfirmInput(false);
                  }}
                />
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!nameMatch}
                  onClick={() => { onDeletePermanently(team?.id); onOpenChange(false); }}
                  className="w-full"
                >
                  <Trash2 size={12} /> Delete Forever
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border-subtle flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PurgeConfirmDialog({ team, open, onOpenChange, onPurge }) {
  const [confirmName, setConfirmName] = useState('');

  useEffect(() => {
    if (!open) setConfirmName('');
  }, [open]);

  const displayName = team?.originalName || team?.name || '';
  const nameMatch = confirmName === displayName;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Permanently Delete" description="Confirm permanent deletion">
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-text-1 font-sans">
            Permanently delete <span className="font-semibold text-text-0">{displayName}</span>?
          </p>
          <p className="text-xs text-danger font-sans">
            This cannot be undone. All team files will be permanently removed.
          </p>
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-1.5 text-2xs text-warning font-sans">
              <AlertTriangle size={11} />
              <span>Type <span className="font-mono font-semibold text-text-0">{displayName}</span> to confirm</span>
            </div>
            <input
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={displayName}
              className="w-full h-8 px-3 text-xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-danger"
              autoFocus
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && nameMatch) {
                  onPurge(team?.id);
                  onOpenChange(false);
                }
              }}
            />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-border-subtle flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="danger" size="sm" disabled={!nameMatch} onClick={() => { onPurge(team?.id); onOpenChange(false); }}>
            <Trash2 size={12} /> Delete Forever
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
