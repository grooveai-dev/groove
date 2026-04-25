// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef, useCallback } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { api } from '../../lib/api';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, FileEdit, Eye, FilePlus, FolderPlus, RefreshCw, ChevronsDownUp } from 'lucide-react';
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

function TreeEntry({ entry, depth, onOpen, expandedDirs, onToggleDir }) {
  const isDir = entry.type === 'directory';
  const isExpanded = expandedDirs.has(entry.path);
  const fileColor = isDir ? 'text-accent' : getFileColor(entry.name);

  return (
    <>
      <button
        onClick={() => isDir ? onToggleDir(entry.path) : onOpen(entry.path)}
        className={cn(
          'w-full flex items-center gap-1.5 py-1 text-xs font-sans cursor-pointer',
          'hover:bg-surface-4/50 transition-colors text-left',
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
        />
      ))}
    </>
  );
}

export function AgentFileTree({ agentId }) {
  const agents = useGrooveStore((s) => s.agents);
  const openFile = useGrooveStore((s) => s.openFile);
  const editorActiveFile = useGrooveStore((s) => s.editorActiveFile);
  const createFile = useGrooveStore((s) => s.createFile);
  const addToast = useGrooveStore((s) => s.addToast);

  const agent = agents.find((a) => a.id === agentId);
  const scope = agent?.scope || [];
  const isRunning = agent?.status === 'running' || agent?.status === 'starting';

  const [treeData, setTreeData] = useState([]);
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [touchedFiles, setTouchedFiles] = useState([]);
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
          results.push({ name: dir.split('/').pop(), path: dir, type: 'directory', children: entries });
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

  async function handleNewFile() {
    const name = prompt('File name:');
    if (!name?.trim()) return;
    await createFile?.(name.trim());
  }

  async function handleNewFolder() {
    const name = prompt('Folder name:');
    if (!name?.trim()) return;
    try {
      await api.post('/files/mkdir', { path: name.trim() });
      addToast('success', `Created ${name.trim()}/`);
      handleRefresh();
    } catch (err) {
      addToast('error', 'Create folder failed', err.message);
    }
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
      </div>
      <ScrollArea className="flex-1 min-h-0">
      <div className="py-2">
        {touchedFiles.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-2xs font-semibold text-text-3 uppercase tracking-wider">
              <FileEdit size={10} />
              Agent Files
            </div>
            {touchedFiles.slice(0, 15).map((f) => {
              const name = f.path.split('/').pop();
              const hasWrites = f.writes > 0;
              return (
                <button
                  key={f.path}
                  onClick={() => openFile(f.path)}
                  className={cn(
                    'w-full flex items-center gap-1.5 px-3 py-1 text-xs font-sans cursor-pointer',
                    'hover:bg-surface-4/50 transition-colors text-left',
                    editorActiveFile === f.path && 'bg-accent/8 text-accent',
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
          <div className="px-1">
            <div className="flex items-center gap-1.5 px-2 py-1.5 text-2xs font-semibold text-text-3 uppercase tracking-wider">
              <Folder size={10} />
              Scope
            </div>
            {treeData.map((entry) => (
              <TreeEntry
                key={entry.path}
                entry={entry}
                depth={0}
                onOpen={handleOpen}
                expandedDirs={expandedDirs}
                onToggleDir={handleToggleDir}
              />
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
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
