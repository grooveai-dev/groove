// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef, useCallback } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { api } from '../../lib/api';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, FileEdit, Eye, FilePlus, FolderPlus, RefreshCw, ChevronsDownUp, PanelLeftClose, Pencil, Trash2 } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';

const FILE_COLORS = {
  js: 'text-warning', jsx: 'text-warning', ts: 'text-info', tsx: 'text-info',
  css: 'text-info', html: 'text-orange', json: 'text-warning',
  md: 'text-text-2', py: 'text-success', rs: 'text-orange',
  go: 'text-accent', sh: 'text-success', yaml: 'text-danger', yml: 'text-danger',
  sql: 'text-purple', xml: 'text-orange', svg: 'text-warning',
};

function getFileColor(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  return FILE_COLORS[ext] || 'text-text-3';
}

function matchesScope(filePath, scopePatterns) {
  if (!scopePatterns || scopePatterns.length === 0) return true;
  for (const pattern of scopePatterns) {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '<<GLOBSTAR>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<GLOBSTAR>>/g, '.*');
    if (new RegExp(`^${escaped}$`).test(filePath) || new RegExp(`^${escaped}`).test(filePath)) {
      return true;
    }
  }
  return false;
}

// ── Inline Input (for new file/folder) ─────────────────
function InlineInput({ defaultValue = '', placeholder, onSubmit, onCancel, depth = 0 }) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (defaultValue) inputRef.current?.select();
  }, [defaultValue]);

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      const name = value.trim();
      if (name) onSubmit(name);
    }
    if (e.key === 'Escape') onCancel();
  }

  return (
    <div className="flex items-center py-0.5" style={{ paddingLeft: depth * 16 + 8 }}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={onCancel}
        placeholder={placeholder}
        className="w-full h-5 px-1.5 text-xs bg-surface-0 border border-accent rounded text-text-0 font-sans focus:outline-none"
      />
    </div>
  );
}

function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] py-1 bg-surface-2 border border-border rounded-lg shadow-xl"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="h-px bg-border-subtle my-1" />
        ) : (
          <button
            key={i}
            onClick={() => { item.action(); onClose(); }}
            className={cn(
              'w-full flex items-center gap-2.5 px-3 py-1.5 text-xs font-sans text-left cursor-pointer transition-colors',
              item.danger
                ? 'text-danger hover:bg-danger/10'
                : 'text-text-1 hover:bg-surface-5',
            )}
          >
            {item.icon && <item.icon size={12} className={item.danger ? 'text-danger' : 'text-text-3'} />}
            {item.label}
          </button>
        )
      )}
    </div>
  );
}

function TreeEntry({ entry, depth, onOpen, expandedDirs, onToggleDir, onContextMenu, dragState, onDragStartEntry, onDragEndEntry, onSetDragOver, onDropOnDir }) {
  const isDir = entry.type === 'dir';
  const isExpanded = expandedDirs.has(entry.path);
  const fileColor = isDir ? 'text-accent' : getFileColor(entry.name);
  const isDragging = dragState?.draggingPath === entry.path;
  const isDragOver = isDir && dragState?.dragOverPath === entry.path;

  function handleCtxMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu?.(e, entry);
  }

  return (
    <>
      <button
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/json', JSON.stringify({ path: entry.path, name: entry.name, type: entry.type }));
          e.dataTransfer.effectAllowed = 'move';
          onDragStartEntry(entry.path);
        }}
        onDragEnd={onDragEndEntry}
        onDragOver={isDir ? (e) => { e.preventDefault(); e.stopPropagation(); onSetDragOver(entry.path); } : undefined}
        onDrop={isDir ? (e) => onDropOnDir(entry.path, e) : undefined}
        onClick={() => isDir ? onToggleDir(entry.path) : onOpen(entry.path)}
        onDoubleClick={handleCtxMenu}
        onContextMenu={handleCtxMenu}
        className={cn(
          'w-full flex items-center gap-1.5 py-1 text-xs font-sans cursor-pointer',
          'hover:bg-surface-4/50 transition-colors text-left',
          isDragging && 'opacity-50',
          isDragOver && 'bg-accent/15 ring-1 ring-accent/50 rounded',
        )}
        style={{ paddingLeft: depth * 14 + 8 }}
      >
        {isDir ? (
          <>
            {isExpanded ? <ChevronDown size={12} className="text-text-4 flex-shrink-0" /> : <ChevronRight size={12} className="text-text-4 flex-shrink-0" />}
            {isExpanded ? <FolderOpen size={13} className={cn(fileColor, 'flex-shrink-0')} /> : <Folder size={13} className={cn(fileColor, 'flex-shrink-0')} />}
          </>
        ) : (
          <>
            <span className="w-3 flex-shrink-0" />
            <File size={13} className={cn(fileColor, 'flex-shrink-0')} />
          </>
        )}
        <span className="truncate text-text-1">{entry.name}</span>
      </button>
      {isDir && isExpanded && entry.children?.map((child) => (
        <TreeEntry
          key={child.path}
          entry={child}
          depth={depth + 1}
          onOpen={onOpen}
          expandedDirs={expandedDirs}
          onToggleDir={onToggleDir}
          onContextMenu={onContextMenu}
          dragState={dragState}
          onDragStartEntry={onDragStartEntry}
          onDragEndEntry={onDragEndEntry}
          onSetDragOver={onSetDragOver}
          onDropOnDir={onDropOnDir}
        />
      ))}
    </>
  );
}

export function AgentFileTree({ agentId, onCollapse }) {
  const agents = useGrooveStore((s) => s.agents);
  const openFile = useGrooveStore((s) => s.openFile);
  const editorActiveFile = useGrooveStore((s) => s.editorActiveFile);
  const createFile = useGrooveStore((s) => s.createFile);
  const addToast = useGrooveStore((s) => s.addToast);
  const fetchTreeDir = useGrooveStore((s) => s.fetchTreeDir);

  const agent = agents.find((a) => a.id === agentId);
  const scope = agent?.scope || [];
  const workingDir = agent?.workingDir || '';
  const isRunning = agent?.status === 'running' || agent?.status === 'starting';

  const [treeData, setTreeData] = useState([]);
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [touchedFiles, setTouchedFiles] = useState([]);
  const [inlineInput, setInlineInput] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [dragState, setDragState] = useState({ draggingPath: null, dragOverPath: null });
  const fetchedRef = useRef(new Set());

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const data = await api.get(`/agents/${encodeURIComponent(agentId)}/files-touched`);
        if (!cancelled && data.files) setTouchedFiles(data.files);
      } catch { /* agent may not exist yet */ }
    }
    poll();
    const interval = isRunning ? setInterval(poll, 5000) : null;
    return () => { cancelled = true; if (interval) clearInterval(interval); };
  }, [agentId, isRunning]);

  const fetchDir = useCallback(async (dirPath) => {
    if (fetchedRef.current.has(dirPath)) return;
    fetchedRef.current.add(dirPath);
    try {
      const data = await api.get(`/files/tree?path=${encodeURIComponent(dirPath)}`);
      return data.entries || [];
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadTree() {
      setLoading(true);
      fetchedRef.current = new Set();

      if (scope.length === 0) {
        const entries = await fetchDir('');
        if (!cancelled) setTreeData(entries);
        setLoading(false);
        return;
      }

      const dirs = new Set();
      for (const pattern of scope) {
        const parts = pattern.split('/');
        let dir = '';
        for (let i = 0; i < parts.length; i++) {
          if (parts[i].includes('*')) break;
          dir = dir ? `${dir}/${parts[i]}` : parts[i];
        }
        if (dir) dirs.add(dir);
      }

      if (dirs.size === 0) {
        const entries = await fetchDir('');
        if (!cancelled) setTreeData(entries);
        setLoading(false);
        return;
      }

      const results = [];
      for (const dir of dirs) {
        const entries = await fetchDir(dir);
        if (entries.length > 0) {
          results.push({ name: dir.split('/').pop(), path: dir, type: 'dir', children: entries });
        }
      }
      if (!cancelled) setTreeData(results);
      setLoading(false);
    }
    loadTree();
    return () => { cancelled = true; };
  }, [agentId, scope.join(','), fetchDir]);

  async function handleToggleDir(path) {
    const next = new Set(expandedDirs);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
      const entries = await fetchDir(path);
      setTreeData((prev) => updateTreeChildren(prev, path, entries));
    }
    setExpandedDirs(next);
  }

  function handleOpen(path) {
    openFile(path);
  }

  function handleNewFile() {
    setInlineInput({
      type: 'file',
      onSubmit: async (name) => {
        setInlineInput(null);
        await createFile?.(name);
      },
      onCancel: () => setInlineInput(null)
    });
  }

  function handleNewFolder() {
    setInlineInput({
      type: 'folder',
      onSubmit: async (name) => {
        setInlineInput(null);
        try {
          await api.post('/files/mkdir', { path: name });
          addToast('success', `Created ${name}/`);
          handleRefresh();
        } catch (err) {
          addToast('error', 'Create folder failed', err.message);
        }
      },
      onCancel: () => setInlineInput(null)
    });
  }

  function handleRefresh() {
    fetchedRef.current = new Set();
    setExpandedDirs(new Set());
    setLoading(true);
    fetchDir('').then((entries) => { setTreeData(entries || []); setLoading(false); });
  }

  function handleCollapseAll() {
    setExpandedDirs(new Set());
  }

  function handleDragStartEntry(path) {
    setDragState({ draggingPath: path, dragOverPath: null });
  }

  function handleDragEndEntry() {
    setDragState({ draggingPath: null, dragOverPath: null });
  }

  function setDragOverDir(path) {
    setDragState(prev => prev.dragOverPath === path ? prev : { ...prev, dragOverPath: path });
  }

  async function handleDropOnDir(targetDirPath, e) {
    e.preventDefault();
    e.stopPropagation();
    setDragState({ draggingPath: null, dragOverPath: null });

    let data;
    try { data = JSON.parse(e.dataTransfer.getData('application/json')); } catch { return; }
    if (!data?.path) return;

    if (data.type === 'dir' && (targetDirPath === data.path || targetDirPath.startsWith(data.path + '/'))) {
      addToast('error', 'Cannot move a folder into itself');
      return;
    }
    const sourceDir = parentDir(data.path);
    if (sourceDir === targetDirPath) return;

    const newPath = targetDirPath ? `${targetDirPath}/${data.name}` : data.name;
    try {
      await api.post('/files/rename', { oldPath: data.path, newPath });
      addToast('success', `Moved ${data.name} to ${targetDirPath || '/'}`);
      handleRefresh();
    } catch (err) {
      addToast('error', 'Move failed', err.message);
    }
  }

  function toRelativePath(absPath) {
    if (!absPath || !absPath.startsWith('/')) return absPath;
    if (workingDir && absPath.startsWith(workingDir + '/')) {
      return absPath.slice(workingDir.length + 1);
    }
    return absPath;
  }

  function parentDir(path) {
    const parts = path.split('/');
    parts.pop();
    return parts.join('/');
  }

  function handleContextMenu(e, entry) {
    e.preventDefault?.();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }

  function handleNewFileIn(dirPath) {
    setExpandedDirs((prev) => new Set([...prev, dirPath]));
    setInlineInput({
      type: 'file',
      parentPath: dirPath,
      onSubmit: async (name) => {
        const path = dirPath ? `${dirPath}/${name}` : name;
        try {
          await api.post('/files/create', { path, content: '' });
          addToast('success', `Created ${name}`);
          handleRefresh();
          openFile(path);
        } catch (err) {
          addToast('error', 'Create failed', err.message);
        }
        setInlineInput(null);
      },
      onCancel: () => setInlineInput(null),
    });
  }

  function handleNewFolderIn(dirPath) {
    setExpandedDirs((prev) => new Set([...prev, dirPath]));
    setInlineInput({
      type: 'folder',
      parentPath: dirPath,
      onSubmit: async (name) => {
        const path = dirPath ? `${dirPath}/${name}` : name;
        try {
          await api.post('/files/mkdir', { path });
          addToast('success', `Created ${name}/`);
          handleRefresh();
        } catch (err) {
          addToast('error', 'Create folder failed', err.message);
        }
        setInlineInput(null);
      },
      onCancel: () => setInlineInput(null),
    });
  }

  function handleRename(entry) {
    setInlineInput({
      type: 'rename',
      renamePath: entry.path,
      defaultValue: entry.name,
      onSubmit: async (newName) => {
        const dir = parentDir(entry.path);
        const newPath = dir ? `${dir}/${newName}` : newName;
        try {
          await api.post('/files/rename', { oldPath: entry.path, newPath });
          addToast('success', `Renamed to ${newName}`);
          handleRefresh();
        } catch (err) {
          addToast('error', 'Rename failed', err.message);
        }
        setInlineInput(null);
      },
      onCancel: () => setInlineInput(null),
    });
  }

  async function handleDelete(entry) {
    const label = entry.type === 'dir' ? `folder "${entry.name}" and all contents` : `"${entry.name}"`;
    if (!window.confirm(`Delete ${label}?`)) return;
    try {
      await api.delete(`/files/delete?path=${encodeURIComponent(entry.path)}`);
      addToast('success', `Deleted ${entry.name}`);
      handleRefresh();
    } catch (err) {
      addToast('error', 'Delete failed', err.message);
    }
  }

  function buildContextMenuItems(entry) {
    const isDir = entry.type === 'dir';
    const items = [];
    if (isDir) {
      items.push({ icon: FilePlus, label: 'New File', action: () => handleNewFileIn(entry.path) });
      items.push({ icon: FolderPlus, label: 'New Folder', action: () => handleNewFolderIn(entry.path) });
      items.push({ separator: true });
    }
    items.push({ icon: Pencil, label: 'Rename', action: () => handleRename(entry) });
    items.push({ icon: Trash2, label: 'Delete', danger: true, action: () => handleDelete(entry) });
    return items;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border-subtle flex-shrink-0">
        <span className="flex-1 text-2xs font-semibold text-text-3 uppercase tracking-wider px-1">Files</span>
        <button onClick={handleNewFile} className="p-1 text-text-4 hover:text-text-1 transition-colors cursor-pointer" title="New file">
          <FilePlus size={12} />
        </button>
        <button onClick={handleNewFolder} className="p-1 text-text-4 hover:text-text-1 transition-colors cursor-pointer" title="New folder">
          <FolderPlus size={12} />
        </button>
        <button onClick={handleRefresh} className="p-1 text-text-4 hover:text-text-1 transition-colors cursor-pointer" title="Refresh">
          <RefreshCw size={12} />
        </button>
        <button onClick={handleCollapseAll} className="p-1 text-text-4 hover:text-text-1 transition-colors cursor-pointer" title="Collapse all">
          <ChevronsDownUp size={12} />
        </button>
        {onCollapse && (
          <button onClick={onCollapse} className="p-1 text-text-4 hover:text-text-1 transition-colors cursor-pointer" title="Collapse sidebar">
            <PanelLeftClose size={12} />
          </button>
        )}
      </div>
      <ScrollArea className="flex-1 min-h-0">
      <div className="py-2">
        {inlineInput && (
          <InlineInput
            placeholder={inlineInput.type === 'file' ? 'filename.ext' : 'folder-name'}
            onSubmit={inlineInput.onSubmit}
            onCancel={inlineInput.onCancel}
            depth={0}
          />
        )}
        {touchedFiles.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-2xs font-semibold text-text-3 uppercase tracking-wider">
              <FileEdit size={10} />
              Agent Files
            </div>
            {touchedFiles.slice(0, 15).map((f) => {
              const relPath = toRelativePath(f.path);
              const name = relPath.split('/').pop();
              const hasWrites = f.writes > 0;
              return (
                <button
                  key={f.path}
                  onClick={() => openFile(relPath)}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); handleContextMenu(e, { path: relPath, name, type: 'file' }); }}
                  onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); handleContextMenu(e, { path: relPath, name, type: 'file' }); }}
                  className={cn(
                    'w-full flex items-center gap-1.5 px-3 py-1 text-xs font-sans cursor-pointer',
                    'hover:bg-surface-4/50 transition-colors text-left',
                    (editorActiveFile === f.path || editorActiveFile === relPath) && 'bg-accent/8 text-accent',
                  )}
                >
                  {hasWrites
                    ? <FileEdit size={12} className="text-warning flex-shrink-0" />
                    : <Eye size={12} className="text-info flex-shrink-0" />
                  }
                  <span className="truncate text-text-1 flex-1">{name}</span>
                  {hasWrites && <span className="text-2xs text-warning/60 flex-shrink-0">{f.writes}w</span>}
                </button>
              );
            })}
            <div className="h-px bg-border-subtle mx-3 mt-2" />
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8 text-text-4 text-xs font-sans">
            Loading...
          </div>
        ) : treeData.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-text-4 text-xs font-sans">
            No files in scope
          </div>
        ) : (
          <div
            className="px-1"
            onDragOver={(e) => { if (!dragState.draggingPath) return; e.preventDefault(); setDragOverDir(null); }}
            onDrop={(e) => handleDropOnDir('', e)}
          >
            <div className="flex items-center gap-1.5 px-2 py-1.5 text-2xs font-semibold text-text-3 uppercase tracking-wider">
              <Folder size={10} />
              Scope
            </div>
            {treeData.map((entry) => (
              inlineInput?.renamePath === entry.path ? (
                <InlineInput
                  key={entry.path}
                  defaultValue={entry.name}
                  onSubmit={inlineInput.onSubmit}
                  onCancel={inlineInput.onCancel}
                  depth={0}
                />
              ) : (
                <TreeEntry
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  onOpen={handleOpen}
                  expandedDirs={expandedDirs}
                  onToggleDir={handleToggleDir}
                  onContextMenu={handleContextMenu}
                  dragState={dragState}
                  onDragStartEntry={handleDragStartEntry}
                  onDragEndEntry={handleDragEndEntry}
                  onSetDragOver={setDragOverDir}
                  onDropOnDir={handleDropOnDir}
                />
              )
            ))}
          </div>
        )}
      </div>
    </ScrollArea>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextMenuItems(contextMenu.entry)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

function updateTreeChildren(tree, targetPath, children) {
  return tree.map((entry) => {
    if (entry.path === targetPath) {
      return { ...entry, children };
    }
    if (entry.children) {
      return { ...entry, children: updateTreeChildren(entry.children, targetPath, children) };
    }
    return entry;
  });
}
