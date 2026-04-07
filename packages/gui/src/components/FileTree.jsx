// GROOVE GUI — File Tree (expandable directory browser)
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useGrooveStore } from '../stores/groove';

const FILE_COLORS = {
  javascript: '#e5c07b',
  typescript: '#61afef',
  css: '#c678dd',
  html: '#e06c75',
  json: '#4ae168',
  markdown: '#c678dd',
  python: '#61afef',
  rust: '#e06c75',
  go: '#33afbc',
  shell: '#4ae168',
  text: '#abb2bf',
};

function TreeNode({ entry, depth, activeFile, expandedDirs, onToggleDir, onFileClick, onContextMenu, renamingPath, renameValue, onRenameChange, onRenameSubmit, onRenameCancel }) {
  const isDir = entry.type === 'dir';
  const isExpanded = expandedDirs.has(entry.path);
  const isActive = !isDir && entry.path === activeFile;
  const isRenaming = renamingPath === entry.path;
  const treeCache = useGrooveStore((s) => s.editorTreeCache);
  const children = treeCache[entry.path] || [];

  return (
    <>
      <div
        onClick={() => isDir ? onToggleDir(entry.path, entry.hasChildren) : onFileClick(entry.path)}
        onContextMenu={(e) => onContextMenu(e, entry)}
        style={{
          ...styles.row,
          paddingLeft: 12 + depth * 16,
          background: isActive ? 'var(--bg-active)' : 'transparent',
          borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
        }}
      >
        {isDir ? (
          <span style={styles.arrow}>{isExpanded ? '\u25BE' : '\u25B8'}</span>
        ) : (
          <span style={{ ...styles.fileDot, background: FILE_COLORS[entry.language] || FILE_COLORS.text }} />
        )}
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit();
              if (e.key === 'Escape') onRenameCancel();
            }}
            onBlur={onRenameCancel}
            onClick={(e) => e.stopPropagation()}
            style={styles.renameInput}
          />
        ) : (
          <span style={{
            ...styles.name,
            color: isDir ? 'var(--text-primary)' : (isActive ? 'var(--text-bright)' : 'var(--text-primary)'),
            fontWeight: isDir ? 600 : 400,
          }}>
            {entry.name}
          </span>
        )}
        {!isDir && !isRenaming && entry.size > 0 && (
          <span style={styles.size}>{formatSize(entry.size)}</span>
        )}
      </div>
      {isDir && isExpanded && children.map((child) => (
        <TreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          activeFile={activeFile}
          expandedDirs={expandedDirs}
          onToggleDir={onToggleDir}
          onFileClick={onFileClick}
          onContextMenu={onContextMenu}
          renamingPath={renamingPath}
          renameValue={renameValue}
          onRenameChange={onRenameChange}
          onRenameSubmit={onRenameSubmit}
          onRenameCancel={onRenameCancel}
        />
      ))}
    </>
  );
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

// --- Context Menu ---
function ContextMenu({ x, y, entry, onClose, onAction }) {
  const ref = useRef(null);

  useEffect(() => {
    const handle = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  const isDir = entry?.type === 'dir';

  const items = [
    { label: 'New File', action: isDir ? 'newFileIn' : 'newFileSibling' },
    { label: 'New Folder', action: isDir ? 'newDirIn' : 'newDirSibling' },
    { sep: true },
    { label: 'Rename', action: 'rename' },
    { label: 'Delete', action: 'delete', danger: true },
  ];

  return (
    <div ref={ref} style={{ ...styles.contextMenu, left: x, top: y }}>
      {items.map((item, i) =>
        item.sep ? (
          <div key={i} style={styles.contextSep} />
        ) : (
          <div
            key={item.action}
            onClick={() => { onAction(item.action, entry); onClose(); }}
            style={{
              ...styles.contextItem,
              color: item.danger ? 'var(--red)' : 'var(--text-primary)',
            }}
          >
            {item.label}
          </div>
        )
      )}
    </div>
  );
}

// --- Inline New-Item Input ---
function InlineInput({ placeholder, onSubmit, onCancel, depth }) {
  const [value, setValue] = useState('');
  return (
    <div style={{ ...styles.row, paddingLeft: 12 + (depth || 0) * 16 }}>
      <input
        autoFocus
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) onSubmit(value.trim());
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={onCancel}
        style={styles.renameInput}
      />
    </div>
  );
}

// --- Main FileTree ---
export default function FileTree() {
  const treeCache = useGrooveStore((s) => s.editorTreeCache);
  const activeFile = useGrooveStore((s) => s.editorActiveFile);
  const fetchTreeDir = useGrooveStore((s) => s.fetchTreeDir);
  const openFile = useGrooveStore((s) => s.openFile);
  const createFile = useGrooveStore((s) => s.createFile);
  const createDir = useGrooveStore((s) => s.createDir);
  const deleteFile = useGrooveStore((s) => s.deleteFile);
  const renameFile = useGrooveStore((s) => s.renameFile);

  const [expandedDirs, setExpandedDirs] = useState(new Set(['']));
  const [filter, setFilter] = useState('');

  // Context menu state
  const [contextMenu, setContextMenu] = useState(null); // { x, y, entry }

  // Inline creation state
  const [creating, setCreating] = useState(null); // { type: 'file'|'dir', parentPath: '' }

  // Rename state
  const [renamingPath, setRenamingPath] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  // Fetch root on mount
  useEffect(() => {
    fetchTreeDir('');
  }, [fetchTreeDir]);

  const onToggleDir = useCallback((path, hasChildren) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        if (hasChildren || !treeCache[path]) {
          fetchTreeDir(path);
        }
      }
      return next;
    });
  }, [fetchTreeDir, treeCache]);

  const onContextMenu = useCallback((e, entry) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const handleContextAction = useCallback(async (action, entry) => {
    const parentDir = entry.path.includes('/') ? entry.path.split('/').slice(0, -1).join('/') : '';

    switch (action) {
      case 'newFileIn':
        setCreating({ type: 'file', parentPath: entry.path });
        setExpandedDirs((prev) => {
          const next = new Set(prev);
          next.add(entry.path);
          if (!treeCache[entry.path]) fetchTreeDir(entry.path);
          return next;
        });
        break;
      case 'newDirIn':
        setCreating({ type: 'dir', parentPath: entry.path });
        setExpandedDirs((prev) => {
          const next = new Set(prev);
          next.add(entry.path);
          if (!treeCache[entry.path]) fetchTreeDir(entry.path);
          return next;
        });
        break;
      case 'newFileSibling':
        setCreating({ type: 'file', parentPath: parentDir });
        break;
      case 'newDirSibling':
        setCreating({ type: 'dir', parentPath: parentDir });
        break;
      case 'rename':
        setRenamingPath(entry.path);
        setRenameValue(entry.name);
        break;
      case 'delete':
        if (confirm(`Delete "${entry.name}"?`)) {
          await deleteFile(entry.path);
        }
        break;
    }
  }, [deleteFile, fetchTreeDir, treeCache]);

  const handleCreate = useCallback(async (name) => {
    if (!creating) return;
    const fullPath = creating.parentPath ? `${creating.parentPath}/${name}` : name;
    const ok = creating.type === 'file'
      ? await createFile(fullPath)
      : await createDir(fullPath);
    setCreating(null);
    if (ok && creating.type === 'file') openFile(fullPath);
  }, [creating, createFile, createDir, openFile]);

  const handleRenameSubmit = useCallback(async () => {
    if (!renamingPath || !renameValue.trim()) { setRenamingPath(null); return; }
    const parentDir = renamingPath.includes('/') ? renamingPath.split('/').slice(0, -1).join('/') : '';
    const newPath = parentDir ? `${parentDir}/${renameValue.trim()}` : renameValue.trim();
    if (newPath !== renamingPath) {
      await renameFile(renamingPath, newPath);
    }
    setRenamingPath(null);
  }, [renamingPath, renameValue, renameFile]);

  // Handle root-level context menu (right-click on empty space)
  const handleTreeContextMenu = useCallback((e) => {
    // Only if click is on the tree background, not a node
    if (e.target === e.currentTarget) {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, entry: { type: 'dir', path: '', name: 'root' } });
    }
  }, []);

  const rootEntries = treeCache[''] || [];

  // Client-side filter — search all cached entries recursively
  const filtered = filter
    ? rootEntries.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()))
    : rootEntries;

  // Calculate inline input depth based on parent
  const creatingDepth = creating
    ? (creating.parentPath === '' ? 0 : creating.parentPath.split('/').length)
    : 0;

  return (
    <div style={styles.container}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <span style={styles.toolbarTitle}>FILES</span>
        <div style={styles.toolbarActions}>
          <button
            onClick={() => setCreating({ type: 'file', parentPath: '' })}
            title="New File"
            style={styles.toolbarBtn}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M3 1.5h6l4 4V14a.5.5 0 01-.5.5h-9A.5.5 0 013 14V2a.5.5 0 01.5-.5z"/>
              <path d="M9 1.5V5.5h4"/>
              <path d="M8 8.5v4M6 10.5h4" strokeLinecap="round"/>
            </svg>
          </button>
          <button
            onClick={() => setCreating({ type: 'dir', parentPath: '' })}
            title="New Folder"
            style={styles.toolbarBtn}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M1.5 3.5h4l1.5 1.5H14a.5.5 0 01.5.5v8a.5.5 0 01-.5.5H2a.5.5 0 01-.5-.5V4z"/>
              <path d="M8 8v3M6.5 9.5h3" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={styles.searchWrap}>
        <input
          type="text"
          placeholder="Filter..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={styles.searchInput}
        />
      </div>

      {/* Tree */}
      <div style={styles.tree} onContextMenu={handleTreeContextMenu}>
        {filtered.length === 0 && !creating && (
          <div style={styles.empty}>
            {rootEntries.length === 0 ? 'Loading...' : 'No matches'}
          </div>
        )}

        {/* Inline creation at root level */}
        {creating && creating.parentPath === '' && (
          <InlineInput
            placeholder={creating.type === 'file' ? 'filename.ext' : 'folder-name'}
            onSubmit={handleCreate}
            onCancel={() => setCreating(null)}
            depth={0}
          />
        )}

        {filtered.map((entry) => (
          <React.Fragment key={entry.path}>
            <TreeNode
              entry={entry}
              depth={0}
              activeFile={activeFile}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              onFileClick={openFile}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRenameSubmit={handleRenameSubmit}
              onRenameCancel={() => setRenamingPath(null)}
            />
            {/* Inline creation inside this dir */}
            {creating && creating.parentPath === entry.path && expandedDirs.has(entry.path) && (
              <InlineInput
                placeholder={creating.type === 'file' ? 'filename.ext' : 'folder-name'}
                onSubmit={handleCreate}
                onCancel={() => setCreating(null)}
                depth={1}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entry={contextMenu.entry}
          onClose={() => setContextMenu(null)}
          onAction={handleContextAction}
        />
      )}
    </div>
  );
}

const styles = {
  container: {
    display: 'flex', flexDirection: 'column',
    height: '100%', background: 'var(--bg-chrome)',
    position: 'relative',
  },
  toolbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 10px',
    borderBottom: '1px solid var(--border)',
  },
  toolbarTitle: {
    fontSize: 10, fontWeight: 700, letterSpacing: 1,
    color: 'var(--text-dim)', textTransform: 'uppercase',
  },
  toolbarActions: {
    display: 'flex', gap: 2,
  },
  toolbarBtn: {
    background: 'none', border: 'none',
    color: 'var(--text-dim)', fontSize: 11, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'var(--font)',
    padding: '2px 5px', borderRadius: 3,
    lineHeight: 1,
  },
  searchWrap: {
    padding: '6px 8px',
    borderBottom: '1px solid var(--border)',
  },
  searchInput: {
    width: '100%', padding: '5px 8px',
    background: 'var(--bg-base)', border: '1px solid var(--border)',
    borderRadius: 3, color: 'var(--text-primary)',
    fontSize: 11, fontFamily: 'var(--font)',
    outline: 'none',
  },
  tree: {
    flex: 1, overflowY: 'auto', overflowX: 'hidden',
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 12px', cursor: 'pointer',
    transition: 'background 0.08s',
    whiteSpace: 'nowrap',
  },
  arrow: {
    fontSize: 10, color: 'var(--text-muted)',
    width: 10, flexShrink: 0, textAlign: 'center',
  },
  fileDot: {
    width: 6, height: 6, borderRadius: '50%',
    flexShrink: 0,
  },
  name: {
    fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis',
    flex: 1, minWidth: 0,
  },
  size: {
    fontSize: 9, color: 'var(--text-muted)', flexShrink: 0,
  },
  empty: {
    padding: 16, textAlign: 'center',
    fontSize: 11, color: 'var(--text-dim)',
  },
  renameInput: {
    flex: 1, padding: '2px 6px',
    background: 'var(--bg-base)', border: '1px solid var(--accent)',
    borderRadius: 2, color: 'var(--text-bright)',
    fontSize: 12, fontFamily: 'var(--font)',
    outline: 'none', minWidth: 0,
  },

  // Context menu
  contextMenu: {
    position: 'fixed', zIndex: 300,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 4, padding: '4px 0',
    minWidth: 160,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    fontFamily: 'var(--font)',
  },
  contextItem: {
    padding: '6px 14px', fontSize: 11,
    cursor: 'pointer',
    transition: 'background 0.08s',
  },
  contextSep: {
    height: 1, background: 'var(--border)',
    margin: '4px 0',
  },
};
