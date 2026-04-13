// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent } from '../ui/dialog';
import { Button } from '../ui/button';

export function RepoNukeDialog({ repo, open, onClose, onConfirm }) {
  const [deleteFiles, setDeleteFiles] = useState(true);

  if (!repo) return null;

  const agents = repo.agents?.length || 0;
  const processes = repo.processes?.length || 0;
  const credentials = repo.credentialKeys?.length || 0;
  const fileCount = repo.fileCount || 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent title={`Nuke ${repo.repoName || repo.name}?`} description="Confirm destructive removal of imported repo">
        <div className="px-5 py-4 space-y-4">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-danger flex-shrink-0 mt-0.5" />
            <p className="text-sm text-text-1 font-sans">This cannot be undone.</p>
          </div>

          <div className="space-y-1.5 text-xs text-text-2 font-sans">
            {agents > 0 && <div className="flex items-center gap-2">
              <span className="text-success">✓</span> Kill {agents} agent{agents !== 1 ? 's' : ''}
            </div>}
            {processes > 0 && <div className="flex items-center gap-2">
              <span className="text-success">✓</span> Stop {processes} process{processes !== 1 ? 'es' : ''}
            </div>}
            {credentials > 0 && <div className="flex items-center gap-2">
              <span className="text-success">✓</span> Remove {credentials} credential{credentials !== 1 ? 's' : ''}
            </div>}
            <div className="flex items-center gap-2">
              <span className="text-success">✓</span> Delete team &quot;{repo.teamId || repo.repoName || repo.name}&quot;
            </div>
            <div className="flex items-center gap-2">
              <span className="text-success">✓</span> Clean all .groove state
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteFiles}
              onChange={(e) => setDeleteFiles(e.target.checked)}
              className="accent-[var(--color-danger)]"
            />
            <span className="text-xs text-text-1 font-sans">
              Delete repo files{fileCount > 0 ? ` (${fileCount} files)` : ''}
            </span>
          </label>

          <div className="flex items-center gap-2 pt-1">
            <Button variant="danger" size="sm" onClick={() => onConfirm(deleteFiles)}>
              Nuke Everything
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
