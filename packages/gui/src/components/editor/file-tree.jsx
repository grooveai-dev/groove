// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { api } from '../../lib/api';
import {
  ChevronRight, ChevronDown, File, Folder, FolderOpen,
  FolderPlus, Search, RefreshCw, Trash2, Pencil, FilePlus,
  ChevronsDownUp, PanelLeftClose, Download,
} from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';

const FILE_COLORS = {
  js: 'text-text-2', jsx: 'text-text-2', ts: 'text-text-2', tsx: 'text-text-2',
  css: 'text-text-3', html: 'text-text-3', json: 'text-text-3',
  md: 'text-text-3', py: 'text-text-2', rs: 'text-text-3',
  go: 'text-text-2', sh: 'text-text-3', yaml: 'text-text-3', yml: 'text-text-3',
  sql: 'text-text-3', xml: 'text-text-3', svg: 'text-text-3',
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

function GitDot({ status }) {
  if (!status) return null;
  const color = status === 'A' || status === '?' ? 'bg-success' : status === 'D' ? 'bg-danger' : 'bg-warning';
  return <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', color)} />;
}

function downloadFile(path, isDir) {
  const a = document.createElement('a');
  a.href = `/api/files/download?path=${encodeURIComponent(path)}`;
  a.download = isDir ? `${path.split('/').pop()}.zip` : path.split('/').pop();
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function TreeNode({ entry, depth = 0, activePath, onFileClick, onDirToggle, expanded, onContextMenu, dragState, onDragStartEntry, onDragEndEntry, onSetDragOver, onDropOnDir, gitStatusMap }) {
  const isDir = entry.type === 'dir';
  const isActive = activePath === entry.path;
  const isOpen = expanded.has(entry.path);
  const indent = depth * 16 + 8;
  const isDragging = dragState?.draggingPath === entry.path;
  const isDragOver = isDir && dragState?.dragOverPath === entry.path;
  const fileGitStatus = !isDir ? gitStatusMap?.[entry.path] : null;

  function handleContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, entry);
  }

  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/json', JSON.stringify({ path: entry.path, name: entry.name, type: entry.type }));
        e.dataTransfer.effectAllowed = 'move';
        onDragStartEntry(entry.path);
      }}
      onDragEnd={onDragEndEntry}
      onDragOver={(e) => { e.preventDefault(); if (isDir) { e.stopPropagation(); onSetDragOver(entry.path); } }}
      onDrop={(e) => onDropOnDir(isDir ? entry.path : (entry.path.includes('/') ? entry.path.split('/').slice(0, -1).join('/') : ''), e)}
      onClick={() => isDir ? onDirToggle(entry.path) : onFileClick(entry.path)}
      onDoubleClick={handleContextMenu}
      onContextMenu={handleContextMenu}
      className={cn(
        'w-full flex items-center gap-1.5 py-[3px] text-xs font-sans cursor-pointer',
        'hover:bg-surface-5 transition-colors text-left select-none',
        isActive && 'bg-accent/10 text-text-0',
        !isActive && 'text-text-1',
        isDragging && 'opacity-50',
        isDragOver && 'bg-accent/15 ring-1 ring-accent/50 rounded',
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
      <span className="truncate flex-1">{entry.name}</span>
      {fileGitStatus && <GitDot status={fileGitStatus} />}
    </button>
  );
}

function TreeDir({ dirPath, depth, activePath, onFileClick, expanded, onDirToggle, treeCache, fetchTreeDir, onContextMenu, inlineInput, dragState, onDragStartEntry, onDragEndEntry, onSetDragOver, onDropOnDir, gitStatusMap }) {
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
              dragState={dragState}
              onDragStartEntry={onDragStartEntry}
              onDragEndEntry={onDragEndEntry}
              onSetDragOver={onSetDragOver}
              onDropOnDir={onDropOnDir}
              gitStatusMap={gitStatusMap}
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
              dragState={dragState}
              onDragStartEntry={onDragStartEntry}
              onDragEndEntry={onDragEndEntry}
              onSetDragOver={onSetDragOver}
              onDropOnDir={onDropOnDir}
              gitStatusMap={gitStatusMap}
            />
          )}
        </div>
      ))}
    </>
  );
}

// ── Main FileTree ────────────────────────────────────────────

export function FileTree({ rootDir, onCollapse }) {
  const treeCache = useGrooveStore((s) => s.editorTreeCache);
  const activeFile = useGrooveStore((s) => s.editorActiveFile);
  const openFile = useGrooveStore((s) => s.openFile);
  const fetchTreeDir = useGrooveStore((s) => s.fetchTreeDir);
  const addToast = useGrooveStore((s) => s.addToast);
  const [expanded, setExpanded] = useState(new Set(['']));
  const [filter, setFilter] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [inlineInput, setInlineInput] = useState(null);
  const [dragState, setDragState] = useState({ draggingPath: null, dragOverPath: null });
  const [gitChanges, setGitChanges] = useState([]);

  useEffect(() => {
    fetchTreeDir('');
  }, [fetchTreeDir, rootDir]);

  useEffect(() => {
    api.get('/files/git-status').then((data) => {
      setGitChanges(data.entries || []);
    }).catch(() => setGitChanges([]));
  }, [rootDir]);

  const gitStatusMap = {};
  for (const entry of gitChanges) {
    gitStatusMap[entry.path] = entry.status;
  }

  function onDirToggle(path) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function handleCollapseAll() {
    setExpanded(new Set(['']));
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

    // External files from desktop
    if (e.dataTransfer?.files?.length > 0) {
      handleExternalDrop(targetDirPath, Array.from(e.dataTransfer.files));
      return;
    }

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
      fetchTreeDir(sourceDir);
      fetchTreeDir(targetDirPath);
      addToast('success', `Moved ${data.name} to ${targetDirPath || '/'}`);
    } catch (err) {
      addToast('error', 'Move failed', err.message);
    }
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

  async function handleExternalDrop(targetDir, nativeFiles) {
    const toUpload = [];
    for (const file of nativeFiles) {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      toUpload.push({ name: file.name, content: base64 });
    }
    try {
      const result = await api.post('/files/upload', { dir: targetDir, files: toUpload });
      addToast('success', `Uploaded ${result.total} file${result.total !== 1 ? 's' : ''}`);
      fetchTreeDir(targetDir);
    } catch (err) {
      addToast('error', 'Upload failed', err.message);
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
      items.push({ icon: Download, label: isDir ? 'Download as ZIP' : 'Download', action: () => downloadFile(entry.path, isDir) });
      if (items.length > 0) items.push({ separator: true });
      items.push({ icon: Pencil, label: 'Rename', action: () => handleRename(entry) });
      items.push({ icon: Trash2, label: 'Delete', danger: true, action: () => handleDelete(entry) });
    } else {
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
        <button
          onClick={handleCollapseAll}
          className="p-1 text-text-4 hover:text-text-1 transition-colors cursor-pointer"
          title="Collapse all"
        >
          <ChevronsDownUp size={12} />
        </button>
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="p-1 text-text-4 hover:text-text-1 transition-colors cursor-pointer"
            title="Collapse sidebar"
          >
            <PanelLeftClose size={12} />
          </button>
        )}
      </div>

      {/* Tree */}
      <ScrollArea className="flex-1">
        <div
          className="py-1 min-h-full"
          onDragOver={(e) => { e.preventDefault(); if (dragState.draggingPath) setDragOverDir(null); }}
          onDrop={(e) => handleDropOnDir('', e)}
        >
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
                    dragState={dragState}
                    onDragStartEntry={handleDragStartEntry}
                    onDragEndEntry={handleDragEndEntry}
                    onSetDragOver={setDragOverDir}
                    onDropOnDir={handleDropOnDir}
                    gitStatusMap={gitStatusMap}
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
                    dragState={dragState}
                    onDragStartEntry={handleDragStartEntry}
                    onDragEndEntry={handleDragEndEntry}
                    onSetDragOver={setDragOverDir}
                    onDropOnDir={handleDropOnDir}
                    gitStatusMap={gitStatusMap}
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
