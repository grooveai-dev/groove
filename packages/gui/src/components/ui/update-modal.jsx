// FSL-1.1-Apache-2.0 — see LICENSE
import { ArrowUpCircle, Loader2 } from 'lucide-react';
import { Dialog, DialogContent } from './dialog';
import { Button } from './button';
import { useGrooveStore } from '../../stores/groove';

export function UpdateModal() {
  const open = useGrooveStore((s) => s.updateModalOpen);
  const setOpen = useGrooveStore((s) => s.setUpdateModalOpen);
  const version = useGrooveStore((s) => s.version);
  const updateReady = useGrooveStore((s) => s.updateReady);
  const updateProgress = useGrooveStore((s) => s.updateProgress);
  const installUpdate = useGrooveStore((s) => s.installUpdate);

  const downloading = updateProgress && !updateReady;
  const percent = downloading ? Math.max(0, Math.min(100, updateProgress.percent || 0)) : 100;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Update Available" description="Desktop app update">
        <div className="px-5 py-4 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent/12">
              <ArrowUpCircle size={20} className="text-accent" />
            </div>
            <div>
              <p className="text-sm text-text-1 font-sans font-medium">
                {downloading ? 'Downloading update\u2026' : `Ready to update`}
              </p>
              <p className="text-xs text-text-3 font-sans mt-0.5">
                {version && <span className="font-mono">{version}</span>}
                {version && updateReady && ' \u2192 '}
                {updateReady && <span className="font-mono text-accent">{updateReady}</span>}
              </p>
            </div>
          </div>
          {downloading && (
            <div className="flex items-center gap-2 mt-1">
              <Loader2 size={12} className="animate-spin text-accent flex-shrink-0" />
              <div className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="text-2xs font-mono text-text-3 tabular-nums">{percent}%</span>
            </div>
          )}
          {!downloading && (
            <p className="text-xs text-text-3 font-sans leading-relaxed">
              The app will restart to apply the update. Your work is saved automatically.
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-subtle bg-surface-0">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Later</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={downloading}
            onClick={() => { installUpdate(); setOpen(false); }}
          >
            <ArrowUpCircle size={12} />
            Update &amp; Restart
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
