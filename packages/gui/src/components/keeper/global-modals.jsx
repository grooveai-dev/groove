// FSL-1.1-Apache-2.0 — see LICENSE
// Global Keeper modals — rendered at App level so they work from any view (chat commands, etc.)
import { useState, useEffect, useRef } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Dialog, DialogContent } from '../ui/dialog';
import { Button } from '../ui/button';
import { Save, HelpCircle, Sparkles, Link2, FileText } from 'lucide-react';

const COMMANDS = [
  { cmd: '[save]',     args: '#tag',                desc: 'Save the current message as a tagged memory' },
  { cmd: '[append]',   args: '#tag',                desc: 'Add to an existing memory without overwriting' },
  { cmd: '[update]',   args: '#tag',                desc: 'Open the editor to modify a memory in place' },
  { cmd: '[delete]',   args: '#tag',                desc: 'Remove a memory permanently' },
  { cmd: '[view]',     args: '#tag',                desc: 'Read a memory in the viewer' },
  { cmd: '[read]',     args: '#tag1 #tag2 ...',     desc: 'Send memory content to the agent — agent reads it, chat stays clean' },
  { cmd: '[doc]',      args: '#tag',                desc: 'AI synthesizes the full conversation into a document' },
  { cmd: '[link]',     args: '#tag path/to/doc',    desc: 'Link a memory to a NORTHSTAR or external document' },
  { cmd: '[instruct]', args: '',                    desc: 'Show this command reference' },
];

function KeeperEditorModal() {
  const keeperEditing = useGrooveStore((s) => s.keeperEditing);
  const setKeeperEditing = useGrooveStore((s) => s.setKeeperEditing);
  const saveKeeperItem = useGrooveStore((s) => s.saveKeeperItem);
  const updateKeeperItem = useGrooveStore((s) => s.updateKeeperItem);
  const activeView = useGrooveStore((s) => s.activeView);

  const [tag, setTag] = useState('');
  const [content, setContent] = useState('');
  const textareaRef = useRef(null);

  // Only render this global modal when NOT on the memory view (memory view has its own)
  const open = !!keeperEditing && activeView !== 'memory';

  useEffect(() => {
    if (keeperEditing) {
      setTag(keeperEditing.tag || '');
      setContent(keeperEditing.content || '');
    }
  }, [keeperEditing]);

  useEffect(() => {
    if (open && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open]);

  const handleClose = (isOpen) => {
    if (!isOpen) setKeeperEditing(null);
  };

  const handleSave = async () => {
    if (!tag.trim() || keeperEditing?.readOnly) return;
    if (keeperEditing?.isNew) {
      await saveKeeperItem(tag.trim(), content);
    } else {
      await updateKeeperItem(tag.trim(), content);
    }
    setKeeperEditing(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  if (!keeperEditing) return null;

  const readOnly = keeperEditing.readOnly;
  const isNew = keeperEditing.isNew;
  const title = readOnly ? `#${keeperEditing.tag}` : isNew ? 'New Memory' : `Edit #${keeperEditing.tag}`;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent title={title} description="Memory content" className="max-w-2xl">
        <div className="p-5 space-y-4" onKeyDown={handleKeyDown}>
          {isNew && (
            <div>
              <label className="block text-xs font-medium text-text-2 mb-1.5">Tag</label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-text-3">#</span>
                <input
                  type="text"
                  value={tag}
                  onChange={(e) => setTag(e.target.value.replace(/[^a-zA-Z0-9/_-]/g, '').toLowerCase())}
                  placeholder="project/feature-name"
                  className="flex-1 px-2 py-1.5 text-sm font-mono rounded-md bg-surface-0 border border-border text-text-0 placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => !readOnly && setContent(e.target.value)}
            readOnly={readOnly}
            rows={16}
            className="w-full px-3 py-2 text-sm font-mono leading-relaxed rounded-md bg-surface-0 border border-border text-text-0 placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent resize-y"
            placeholder="Write your thoughts, ideas, context..."
          />
          <div className="flex items-center justify-between pt-1">
            {readOnly ? (
              <p className="text-2xs text-text-4">Read-only view</p>
            ) : (
              <p className="text-2xs text-text-4">{navigator.platform?.includes('Mac') ? 'Cmd' : 'Ctrl'}+S to save</p>
            )}
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setKeeperEditing(null)}>
                {readOnly ? 'Close' : 'Cancel'}
              </Button>
              {!readOnly && (
                <Button variant="primary" size="sm" onClick={handleSave} disabled={!tag.trim()}>
                  <Save size={14} /> Save
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KeeperInstructModal() {
  const open = useGrooveStore((s) => s.keeperInstructOpen);
  const activeView = useGrooveStore((s) => s.activeView);

  // Only render globally when NOT on memory view
  if (activeView === 'memory') return null;

  return (
    <Dialog open={open} onOpenChange={(o) => useGrooveStore.setState({ keeperInstructOpen: o })}>
      <DialogContent title="Keeper Commands" description="Memory system command reference" className="max-w-lg">
        <div className="p-5 space-y-4">
          <p className="text-xs text-text-2 leading-relaxed">
            Type these commands in any agent chat to manage your tagged memories. Commands are intercepted by Keeper — the agent never sees them.
          </p>
          <div className="space-y-1.5">
            {COMMANDS.map((c) => (
              <div key={c.cmd} className="flex items-start gap-3 py-1.5 border-b border-border-subtle last:border-0">
                <div className="flex-shrink-0 flex items-center gap-1">
                  <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent font-mono text-xs font-semibold">{c.cmd}</span>
                  {c.args && <span className="text-xs text-text-3 font-mono">{c.args}</span>}
                </div>
                <span className="text-xs text-text-3 pt-0.5">{c.desc}</span>
              </div>
            ))}
          </div>
          <div className="pt-2 space-y-2">
            <h3 className="text-xs font-semibold text-text-1">Tag Hierarchy</h3>
            <p className="text-xs text-text-3 leading-relaxed">
              Use <span className="font-mono text-accent">/</span> for nesting: <span className="font-mono text-accent">#groove/memory-system</span>. Pull a parent to get all children.
            </p>
            <h3 className="text-xs font-semibold text-text-1">Memory Types</h3>
            <p className="text-xs text-text-3 leading-relaxed">
              <span className="font-semibold">Manual</span> — you write via [save]/[append]/[update]. <span className="font-semibold">Doc</span> — AI writes via [doc]. Both editable.
            </p>
          </div>
          <div className="flex justify-end pt-1">
            <Button variant="ghost" size="sm" onClick={() => useGrooveStore.setState({ keeperInstructOpen: false })}>Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function KeeperGlobalModals() {
  return (
    <>
      <KeeperEditorModal />
      <KeeperInstructModal />
    </>
  );
}
