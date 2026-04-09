// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, Plus, FolderPlus, Search, RefreshCw } from 'lucide-react';
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

function TreeNode({ entry, depth = 0, activePath, onFileClick, onDirToggle, expanded }) {
  const isDir = entry.type === 'dir';
  const isActive = activePath === entry.path;
  const isOpen = expanded.has(entry.path);
  const indent = depth * 16 + 8;

  return (
    <button
      onClick={() => isDir ? onDirToggle(entry.path) : onFileClick(entry.path)}
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

function TreeDir({ dirPath, depth, activePath, onFileClick, expanded, onDirToggle, treeCache, fetchTreeDir }) {
  const entries = treeCache[dirPath] || [];

  useEffect(() => {
    if (expanded.has(dirPath) && !treeCache[dirPath]) {
      fetchTreeDir(dirPath);
    }
  }, [expanded, dirPath, treeCache, fetchTreeDir]);

  if (!expanded.has(dirPath)) return null;

  return (
    <>
      {entries.map((entry) => (
        <div key={entry.path}>
          <TreeNode
            entry={entry}
            depth={depth}
            activePath={activePath}
            onFileClick={onFileClick}
            onDirToggle={onDirToggle}
            expanded={expanded}
          />
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
            />
          )}
        </div>
      ))}
    </>
  );
}

export function FileTree({ rootDir }) {
  const treeCache = useGrooveStore((s) => s.editorTreeCache);
  const activeFile = useGrooveStore((s) => s.editorActiveFile);
  const openFile = useGrooveStore((s) => s.openFile);
  const fetchTreeDir = useGrooveStore((s) => s.fetchTreeDir);

  const [expanded, setExpanded] = useState(new Set(['']));
  const [filter, setFilter] = useState('');

  // Load root on mount
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

  const rootEntries = treeCache[''] || [];

  return (
    <div className="flex flex-col h-full bg-surface-1">
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
          onClick={() => fetchTreeDir('')}
          className="p-1 text-text-4 hover:text-text-1 transition-colors cursor-pointer"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Tree */}
      <ScrollArea className="flex-1">
        <div className="py-1">
          {rootEntries
            .filter((e) => !filter || e.name.toLowerCase().includes(filter.toLowerCase()))
            .map((entry) => (
              <div key={entry.path}>
                <TreeNode
                  entry={entry}
                  depth={0}
                  activePath={activeFile}
                  onFileClick={openFile}
                  onDirToggle={onDirToggle}
                  expanded={expanded}
                />
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
                  />
                )}
              </div>
            ))}
        </div>
      </ScrollArea>
    </div>
  );
}
