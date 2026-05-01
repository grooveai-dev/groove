// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent } from '../ui/dialog';
import { Tooltip } from '../ui/tooltip';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/cn';
import { Save, Trash2, Download, BookmarkCheck } from 'lucide-react';

function SavePresetDialog({ open, onOpenChange }) {
  const savePreset = useGrooveStore((s) => s.saveLabPreset);
  const [name, setName] = useState('');

  function handleSave() {
    if (!name.trim()) return;
    savePreset(name.trim());
    setName('');
    onOpenChange(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSave();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Save Preset" description="Save current parameters as a preset">
        <div className="px-5 py-4 space-y-4">
          <Input
            label="Preset Name"
            placeholder="My Custom Preset"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={!name.trim()}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PresetManager() {
  const presets = useGrooveStore((s) => s.labPresets);
  const activePreset = useGrooveStore((s) => s.labActivePreset);
  const loadPreset = useGrooveStore((s) => s.loadLabPreset);
  const deletePreset = useGrooveStore((s) => s.deleteLabPreset);

  const [saveOpen, setSaveOpen] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold font-sans text-text-2 uppercase tracking-wider">Presets</span>
        <Tooltip content="Save current settings as preset">
          <button
            onClick={() => setSaveOpen(true)}
            className="p-1 rounded text-text-3 hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
          >
            <Save size={14} />
          </button>
        </Tooltip>
      </div>

      {presets.length === 0 ? (
        <div className="px-3 py-3 text-center">
          <BookmarkCheck size={16} className="mx-auto text-text-4 mb-1" />
          <p className="text-2xs text-text-3 font-sans">No presets saved</p>
        </div>
      ) : (
        <ScrollArea className="max-h-32">
          <div className="space-y-0.5">
            {presets.map((preset) => (
              <div
                key={preset.id}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors',
                  activePreset === preset.id ? 'bg-accent/10' : 'hover:bg-surface-5/50',
                )}
              >
                <button
                  onClick={() => loadPreset(preset.id)}
                  className="flex-1 text-left min-w-0 cursor-pointer"
                >
                  <div className={cn(
                    'text-xs font-sans truncate',
                    activePreset === preset.id ? 'text-accent font-medium' : 'text-text-2',
                  )}>
                    {preset.name}
                  </div>
                </button>
                <Tooltip content="Delete preset">
                  <button
                    onClick={() => deletePreset(preset.id)}
                    className="p-0.5 rounded text-text-4 hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer flex-shrink-0"
                  >
                    <Trash2 size={10} />
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      <SavePresetDialog open={saveOpen} onOpenChange={setSaveOpen} />
    </div>
  );
}
