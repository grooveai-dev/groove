// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { api } from '../../lib/api';
import {
  ChevronRight, ChevronDown, File, Folder, FolderOpen,
  Plus, FolderPlus, Search, RefreshCw, Trash2, Pencil, FilePlus,
} from 'lucide-react';
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

// ── Context Menu ─────────────────────────────────────────────

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

// ── Inline Input (for new file/folder/rename) ─────────────────

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

// ── Tree Node ────────────────────────────────────────────────

function TreeNode({ entry, depth = 0, activePath, onFileClick, onDirToggle, expanded, onContextMenu }) {
  const isDir = entry.type === 'dir';
  const isActive = activePath === entry.path;
  const isOpen = expanded.has(entry.path);
  const indent = depth * 16 + 8;

  function handleContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, entry);
  }

  return (
    <button
      onClick={() => isDir ? onDirToggle(entry.path) : onFileClick(entry.path)}
      onContextMenu={handleContextMenu}
      className={cn(
        'w-full flex items-center gap-1.5 py-1 text-xs font-sans cursor-pointer',
        'hover:bg-surface-5 transition-colors text-left select-none',
        isActive && 'bg-accent/10 text-text-0',
        !isActive && 'text-text-1',
      )}
      style={{ paddingLeft: indent }}
    >
      {isDir ? (
        <>
          {isOpen ? <ChevronDown size={12} className="text-text-4 flex-shrink-0" /> : <ChevronRight size={12} className="text-text-4 flex-shrink-0" />}
          {isOpen ? <FolderOpen size={14} className="text-accent flex-shrink-0" /> : <Folder size={14} className="text-text-3 flex-shrink-0" />}
        </>
      ) : (
        <>
          <span className="w-3" />
          <File size={14} className={cn('flex-shrink-0', getFileColor(entry.name))} />
        </>
      )}
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

function TreeDir({ dirPath, depth, activePath, onFileClick, expanded, onDirToggle, treeCache, fetchTreeDir, onContextMenu, inlineInput }) {
  const entries = treeCache[dirPath] || [];

  useEffect(() => {
    if (expanded.has(dirPath) && !treeCache[dirPath]) {
      fetchTreeDir(dirPath);
    }
  }, [expanded, dirPath, treeCache, fetchTreeDir]);

  if (!expanded.has(dirPath)) return null;

  return (
    <>
      {/* Inline input for new file/folder in this directory */}
      {inlineInput?.parentPath === dirPath && (
        <InlineInput
          placeholder={inlineInput.type === 'file' ? 'filename.ext' : 'folder-name'}
          onSubmit={inlineInput.onSubmit}
          onCancel={inlineInput.onCancel}
          depth={depth}
        />
      )}
      {entries.map((entry) => (
        <div key={entry.path}>
          {/* Rename input */}
          {inlineInput?.renamePath === entry.path ? (
            <InlineInput
              defaultValue={entry.name}
              onSubmit={inlineInput.onSubmit}
              onCancel={inlineInput.onCancel}
              depth={depth}
            />
          ) : (
            <TreeNode
              entry={entry}
              depth={depth}
              activePath={activePath}
              onFileClick={onFileClick}
              onDirToggle={onDirToggle}
              expanded={expanded}
              onContextMenu={onContextMenu}
            />
          )}
          {entry.type === 'dir' && (
            <TreeDir
              dirPath={entry.path}
              depth={depth + 1}
              activePath={activePath}
              onFileClick={onFileClick}
              expanded={expanded}
              onDirToggle={onDirToggle}
              treeCache={treeCache}
              fetchTreeDir={fetchTreeDir}
              onContextMenu={onContextMenu}
              inlineInput={inlineInput}
            />
          )}
        </div>
      ))}
    </>
  );
}

// ── Main FileTree ────────────────────────────────────────────

export function FileTree({ rootDir }) {
  const treeCache = useGrooveStore((s) => s.editorTreeCache);
  const activeFile = useGrooveStore((s) => s.editorActiveFile);
  const openFile = useGrooveStore((s) => s.openFile);
  const fetchTreeDir = useGrooveStore((s) => s.fetchTreeDir);
  const addToast = useGrooveStore((s) => s.addToast);

  const [expanded, setExpanded] = useState(new Set(['']));
  const [filter, setFilter] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [inlineInput, setInlineInput] = useState(null);

  useEffect(() => {
    fetchTreeDir('');
  }, [fetchTreeDir, rootDir]);

  function onDirToggle(path) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function handleContextMenu(e, entry) {
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }

  // Empty area context menu (right-click on blank space)
  function handleRootContextMenu(e) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry: { type: 'dir', path: '', name: 'root' } });
  }

  function parentDir(path) {
    const parts = path.split('/');
    parts.pop();
    return parts.join('/');
  }

  async function handleNewFile(dirPath) {
    setExpanded((prev) => new Set([...prev, dirPath]));
    setInlineInput({
      type: 'file',
      parentPath: dirPath,
      onSubmit: async (name) => {
        const path = dirPath ? `${dirPath}/${name}` : name;
        try {
          await api.post('/files/create', { path, content: '' });
          fetchTreeDir(dirPath);
          openFile(path);
          addToast('success', `Created ${name}`);
        } catch (err) {
          addToast('error', 'Create failed', err.message);
        }
        setInlineInput(null);
      },
      onCancel: () => setInlineInput(null),
    });
  }

  async function handleNewFolder(dirPath) {
    setExpanded((prev) => new Set([...prev, dirPath]));
    setInlineInput({
      type: 'folder',
      parentPath: dirPath,
      onSubmit: async (name) => {
        const path = dirPath ? `${dirPath}/${name}` : name;
        try {
          await api.post('/files/mkdir', { path });
          fetchTreeDir(dirPath);
          setExpanded((prev) => new Set([...prev, path]));
          addToast('success', `Created ${name}/`);
        } catch (err) {
          addToast('error', 'Create folder failed', err.message);
        }
        setInlineInput(null);
      },
      onCancel: () => setInlineInput(null),
    });
  }

  async function handleRename(entry) {
    setInlineInput({
      type: 'rename',
      renamePath: entry.path,
      onSubmit: async (newName) => {
        const dir = parentDir(entry.path);
        const newPath = dir ? `${dir}/${newName}` : newName;
        try {
          await api.post('/files/rename', { oldPath: entry.path, newPath });
          fetchTreeDir(dir);
          addToast('success', `Renamed to ${newName}`);
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
      fetchTreeDir(parentDir(entry.path));
      addToast('success', `Deleted ${entry.name}`);
    } catch (err) {
      addToast('error', 'Delete failed', err.message);
    }
  }

  function buildContextMenuItems(entry) {
    const isDir = entry.type === 'dir';
    const items = [];

    if (isDir) {
      items.push({ icon: FilePlus, label: 'New File', action: () => handleNewFile(entry.path) });
      items.push({ icon: FolderPlus, label: 'New Folder', action: () => handleNewFolder(entry.path) });
    }

    if (entry.name !== 'root') {
      if (items.length > 0) items.push({ separator: true });
      items.push({ icon: Pencil, label: 'Rename', action: () => handleRename(entry) });
      items.push({ icon: Trash2, label: 'Delete', danger: true, action: () => handleDelete(entry) });
    } else {
      // Root context — only new file/folder
      items.length = 0;
      items.push({ icon: FilePlus, label: 'New File', action: () => handleNewFile('') });
      items.push({ icon: FolderPlus, label: 'New Folder', action: () => handleNewFolder('') });
    }

    return items;
  }

  const rootEntries = treeCache[''] || [];

  return (
    <div className="flex flex-col h-full bg-surface-1" onContextMenu={handleRootContextMenu}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border-subtle">
        <div className="flex-1 relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-4" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter..."
            className="w-full h-6 pl-6 pr-2 text-xs bg-surface-0 border border-border-subtle rounded text-text-1 placeholder:text-text-4 focus:outline-none focus:border-accent font-sans"
          />
        </div>
        <button
          onClick={() => handleNewFile('')}
          className="p-1 text-text-4 hover:text-text-1 transition-colors cursor-pointer"
          title="New file"
        >
          <FilePlus size={12} />
        </button>
        <button
          onClick={() => handleNewFolder('')}
          className="p-1 text-text-4 hover:text-text-1 transition-colors cursor-pointer"
          title="New folder"
        >
          <FolderPlus size={12} />
        </button>
        <button
          onClick={() => fetchTreeDir('')}
          className="p-1 text-text-4 hover:text-text-1 transition-colors cursor-pointer"
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Tree */}
      <ScrollArea className="flex-1">
        <div className="py-1">
          {/* Inline input at root level */}
          {inlineInput?.parentPath === '' && (
            <InlineInput
              placeholder={inlineInput.type === 'file' ? 'filename.ext' : 'folder-name'}
              onSubmit={inlineInput.onSubmit}
              onCancel={inlineInput.onCancel}
              depth={0}
            />
          )}
          {rootEntries
            .filter((e) => !filter || e.name.toLowerCase().includes(filter.toLowerCase()))
            .map((entry) => (
              <div key={entry.path}>
                {inlineInput?.renamePath === entry.path ? (
                  <InlineInput
                    defaultValue={entry.name}
                    onSubmit={inlineInput.onSubmit}
                    onCancel={inlineInput.onCancel}
                    depth={0}
                  />
                ) : (
                  <TreeNode
                    entry={entry}
                    depth={0}
                    activePath={activeFile}
                    onFileClick={openFile}
                    onDirToggle={onDirToggle}
                    expanded={expanded}
                    onContextMenu={handleContextMenu}
                  />
                )}
                {entry.type === 'dir' && (
                  <TreeDir
                    dirPath={entry.path}
                    depth={1}
                    activePath={activeFile}
                    onFileClick={openFile}
                    expanded={expanded}
                    onDirToggle={onDirToggle}
                    treeCache={treeCache}
                    fetchTreeDir={fetchTreeDir}
                    onContextMenu={handleContextMenu}
                    inlineInput={inlineInput}
                  />
                )}
              </div>
            ))}
          {rootEntries.length === 0 && !filter && (
            <div className="px-3 py-6 text-center">
              <p className="text-xs text-text-4">No files found</p>
              <button
                onClick={() => fetchTreeDir('')}
                className="mt-2 text-xs text-accent hover:underline cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Context menu */}
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
