// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef } from 'react';
import { useGrooveStore } from '../stores/groove';
import { Button } from '../components/ui/button';
import { ScrollArea } from '../components/ui/scroll-area';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { BookOpen, Plus, Search, Trash2, Pencil, ChevronRight, Hash, FolderOpen, Clock, Save, Link2, FileText, Sparkles, HelpCircle } from 'lucide-react';

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

function formatRelative(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function MemoryCard({ item, onEdit, onDelete }) {
  const [preview, setPreview] = useState(null);
  const getKeeperItem = useGrooveStore((s) => s.getKeeperItem);

  useEffect(() => {
    let cancelled = false;
    getKeeperItem(item.tag).then((data) => {
      if (!cancelled && data) setPreview(data.content);
    });
    return () => { cancelled = true; };
  }, [item.tag, item.updatedAt]);

  const parts = item.tag.split('/');
  const displayName = parts[parts.length - 1];
  const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
  const lines = (preview || '').split('\n').filter(Boolean);
  const previewText = lines.slice(0, 3).join('\n');
  const isDoc = item.type === 'doc';
  const hasLinks = item.links?.length > 0;

  return (
    <div className="group p-3 rounded-lg border border-border bg-surface-1 hover:bg-surface-2 hover:border-border transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {parentPath && (
              <span className="text-2xs text-text-4 font-mono">{parentPath}/</span>
            )}
            <span className="text-sm font-semibold text-text-0">{displayName}</span>
            {isDoc && (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-2xs font-medium bg-purple/10 text-purple">
                <Sparkles size={8} />AI
              </span>
            )}
            {hasLinks && (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-2xs font-medium bg-info/10 text-info">
                <Link2 size={8} />{item.links.length}
              </span>
            )}
          </div>
          {previewText && (
            <p className="text-xs text-text-3 line-clamp-3 whitespace-pre-wrap font-mono leading-relaxed">{previewText}</p>
          )}
          {hasLinks && (
            <div className="flex items-center gap-1.5 mt-1.5">
              {item.links.map((link) => (
                <span key={link} className="inline-flex items-center gap-0.5 text-2xs text-info">
                  <FileText size={9} />{link.split('/').pop()}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 mt-2">
            <span className="flex items-center gap-1 text-2xs text-text-4">
              <Clock size={10} />
              {formatRelative(item.updatedAt)}
            </span>
            {item.size != null && (
              <span className="text-2xs text-text-4">
                {item.size > 1024 ? `${(item.size / 1024).toFixed(1)}KB` : `${item.size}B`}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onEdit(item)}
            className="p-1.5 rounded-md text-text-3 hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => onDelete(item.tag)}
            className="p-1.5 rounded-md text-text-3 hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function EditorModal({ open, onOpenChange, editing, onSave }) {
  const [tag, setTag] = useState('');
  const [content, setContent] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    if (editing) {
      setTag(editing.tag || '');
      setContent(editing.content || '');
    }
  }, [editing]);

  useEffect(() => {
    if (open && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open]);

  const handleSave = () => {
    if (!tag.trim() || editing?.readOnly) return;
    onSave(tag.trim(), content);
    onOpenChange(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  const isNew = editing?.isNew;
  const readOnly = editing?.readOnly;
  const title = readOnly ? `#${editing?.tag || ''}` : isNew ? 'New Memory' : `Edit #${editing?.tag || ''}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              <p className="text-2xs text-text-4 mt-1">Use / for hierarchy: groove/memory-system</p>
            </div>
          )}
          <div>
            {!readOnly && <label className="block text-xs font-medium text-text-2 mb-1.5">Content</label>}
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => !readOnly && setContent(e.target.value)}
              readOnly={readOnly}
              rows={16}
              className="w-full px-3 py-2 text-sm font-mono leading-relaxed rounded-md bg-surface-0 border border-border text-text-0 placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent resize-y"
              placeholder="Write your thoughts, ideas, context..."
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            {readOnly ? (
              <p className="text-2xs text-text-4">Read-only view</p>
            ) : (
              <p className="text-2xs text-text-4">
                {navigator.platform?.includes('Mac') ? 'Cmd' : 'Ctrl'}+S to save
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                {readOnly ? 'Close' : 'Cancel'}
              </Button>
              {!readOnly && (
                <Button variant="primary" size="sm" onClick={handleSave} disabled={!tag.trim()}>
                  <Save size={14} />
                  Save
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InstructModal({ open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Keeper Commands" description="Memory system command reference" className="max-w-lg">
        <div className="p-5 space-y-4">
          <p className="text-xs text-text-2 leading-relaxed">
            Type these commands in any agent chat to manage your tagged memories. Commands are intercepted by the Keeper sidecar — the agent never sees them.
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
              Use <span className="font-mono text-accent">/</span> to create nested tags: <span className="font-mono text-accent">#groove/memory-system</span> lives under <span className="font-mono text-accent">#groove</span>. Pull a parent tag to get all children.
            </p>
            <h3 className="text-xs font-semibold text-text-1">Memory Types</h3>
            <p className="text-xs text-text-3 leading-relaxed">
              <span className="font-semibold">Manual</span> — you write it via [save], [append], [update]. <span className="font-semibold">Doc</span> — AI writes it via [doc], synthesizing your conversation. Both are fully editable.
            </p>
            <h3 className="text-xs font-semibold text-text-1">Spawning with Context</h3>
            <p className="text-xs text-text-3 leading-relaxed">
              When spawning a new agent, use [pull] #tag to inject memories into their context. You can also link memories to NORTHSTAR docs with [link] for cross-referencing.
            </p>
          </div>
          <div className="flex justify-end pt-1">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TreeGroup({ node, onSelect }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <button
        onClick={() => hasChildren ? setExpanded(!expanded) : onSelect(node)}
        className="flex items-center gap-1.5 w-full px-2 py-1 rounded-md text-xs text-text-2 hover:bg-surface-2 transition-colors cursor-pointer"
      >
        {hasChildren ? (
          <ChevronRight size={12} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
        ) : (
          <Hash size={12} className="text-text-4" />
        )}
        <FolderOpen size={12} className={hasChildren ? 'text-accent' : 'text-text-4'} />
        <span className="font-medium">{node.tag}</span>
        {hasChildren && (
          <span className="text-2xs text-text-4 ml-auto">{node.children.length}</span>
        )}
      </button>
      {expanded && hasChildren && (
        <div className="ml-4 mt-0.5 space-y-0.5">
          {node.children.map((child) => (
            <button
              key={child.tag}
              onClick={() => onSelect(child)}
              className="flex items-center gap-1.5 w-full px-2 py-1 rounded-md text-xs text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors cursor-pointer"
            >
              <Hash size={10} className="text-text-4" />
              <span>{child.tag.split('/').pop()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MemoryView() {
  const keeperItems = useGrooveStore((s) => s.keeperItems);
  const keeperTree = useGrooveStore((s) => s.keeperTree);
  const keeperEditing = useGrooveStore((s) => s.keeperEditing);
  const keeperInstructOpen = useGrooveStore((s) => s.keeperInstructOpen);
  const fetchKeeperItems = useGrooveStore((s) => s.fetchKeeperItems);
  const saveKeeperItem = useGrooveStore((s) => s.saveKeeperItem);
  const updateKeeperItem = useGrooveStore((s) => s.updateKeeperItem);
  const deleteKeeperItem = useGrooveStore((s) => s.deleteKeeperItem);
  const getKeeperItem = useGrooveStore((s) => s.getKeeperItem);
  const setKeeperEditing = useGrooveStore((s) => s.setKeeperEditing);

  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState('list');
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => { fetchKeeperItems(); }, []);

  useEffect(() => {
    if (keeperEditing) setEditorOpen(true);
  }, [keeperEditing]);

  const filtered = search
    ? keeperItems.filter((item) => item.tag.includes(search.toLowerCase()))
    : keeperItems;

  const handleNew = () => {
    setKeeperEditing({ tag: '', content: '', isNew: true });
    setEditorOpen(true);
  };

  const handleEdit = async (item) => {
    const full = await getKeeperItem(item.tag);
    setKeeperEditing({ tag: item.tag, content: full?.content || '', isNew: false });
    setEditorOpen(true);
  };

  const handleSave = async (tag, content) => {
    if (keeperEditing?.isNew) {
      await saveKeeperItem(tag, content);
    } else {
      await updateKeeperItem(tag, content);
    }
    setKeeperEditing(null);
  };

  const handleEditorClose = (open) => {
    setEditorOpen(open);
    if (!open) setKeeperEditing(null);
  };

  const handleTreeSelect = async (node) => {
    if (node.virtual) return;
    await handleEdit(node);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h1 className="text-sm font-semibold text-text-0 flex items-center gap-2">
            <BookOpen size={16} />
            Memory
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => useGrooveStore.setState({ keeperInstructOpen: true })}
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-3 hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
              title="Command reference"
            >
              <HelpCircle size={14} />
            </button>
            <div className="flex items-center rounded-md border border-border overflow-hidden">
              <button
                onClick={() => setViewMode('list')}
                className={`px-2 py-1 text-2xs font-medium transition-colors cursor-pointer ${viewMode === 'list' ? 'bg-accent/10 text-accent' : 'text-text-3 hover:text-text-1'}`}
              >
                List
              </button>
              <button
                onClick={() => setViewMode('tree')}
                className={`px-2 py-1 text-2xs font-medium transition-colors cursor-pointer ${viewMode === 'tree' ? 'bg-accent/10 text-accent' : 'text-text-3 hover:text-text-1'}`}
              >
                Tree
              </button>
            </div>
            <Button variant="primary" size="sm" onClick={handleNew}>
              <Plus size={14} />
              New
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-4" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search memories..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-surface-0 border border-border text-text-0 placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {keeperItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <BookOpen size={32} className="text-text-4" />
            <p className="text-sm text-text-3">No memories yet</p>
            <p className="text-xs text-text-4 max-w-xs text-center">
              Save ideas, context, and decisions with tagged memories. Type <span className="font-mono text-accent">[save] #tag</span> in any agent chat, or click New above.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={handleNew}>
                <Plus size={14} />
                Create first memory
              </Button>
              <Button variant="ghost" size="sm" onClick={() => useGrooveStore.setState({ keeperInstructOpen: true })}>
                <HelpCircle size={14} />
                Commands
              </Button>
            </div>
          </div>
        ) : viewMode === 'tree' ? (
          <div className="p-3 space-y-1">
            {keeperTree.map((node) => (
              <TreeGroup key={node.tag} node={node} onSelect={handleTreeSelect} />
            ))}
            {keeperItems
              .filter((item) => !item.tag.includes('/') && !keeperTree.some((t) => t.tag === item.tag && t.children?.length))
              .map((item) => (
                <button
                  key={item.tag}
                  onClick={() => handleEdit(item)}
                  className="flex items-center gap-1.5 w-full px-2 py-1 rounded-md text-xs text-text-2 hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <Hash size={12} className="text-text-4" />
                  <span className="font-medium">{item.tag}</span>
                  {item.type === 'doc' && <Sparkles size={10} className="text-purple" />}
                  <span className="text-2xs text-text-4 ml-auto">{formatRelative(item.updatedAt)}</span>
                </button>
              ))}
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {filtered.map((item) => (
              <MemoryCard key={item.tag} item={item} onEdit={handleEdit} onDelete={(tag) => deleteKeeperItem(tag)} />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Editor Modal (responds to both view clicks and chat commands) */}
      <EditorModal
        open={editorOpen}
        onOpenChange={handleEditorClose}
        editing={keeperEditing}
        onSave={handleSave}
      />

      {/* Instruct Modal (command reference) */}
      <InstructModal
        open={keeperInstructOpen}
        onOpenChange={(open) => useGrooveStore.setState({ keeperInstructOpen: open })}
      />
    </div>
  );
}
