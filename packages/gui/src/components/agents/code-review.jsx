// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useCallback } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { DiffViewer } from './diff-viewer';
import { api } from '../../lib/api';
import {
  ChevronLeft, ChevronRight, Send, FilePlus, FileMinus, FileEdit,
  RotateCcw, MessageSquare, Eye,
} from 'lucide-react';

function statusIcon(status) {
  if (status === 'added') return <FilePlus size={12} className="text-success" />;
  if (status === 'deleted') return <FileMinus size={12} className="text-danger" />;
  return <FileEdit size={12} className="text-warning" />;
}

export function CodeReview({ agentId: agentIdProp, onBack }) {
  const storeAgentId = useGrooveStore((s) => s.workspaceAgentId);
  const agentId = agentIdProp || storeAgentId;
  const agents = useGrooveStore((s) => s.agents);
  const instructAgent = useGrooveStore((s) => s.instructAgent);
  const setEditorViewMode = useGrooveStore((s) => s.setEditorViewMode);

  const agent = agents.find((a) => a.id === agentId);
  const agentRunning = agent?.status === 'running' || agent?.status === 'starting';

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedFile, setExpandedFile] = useState(null);
  const [fileContents, setFileContents] = useState({});
  const [reverting, setReverting] = useState({});
  const [comments, setComments] = useState({});
  const [commentingPath, setCommentingPath] = useState(null);
  const [commentText, setCommentText] = useState('');

  const loadChanges = useCallback(async () => {
    setLoading(true);
    try {
      const url = agentId ? `/files/git-diff?agentId=${encodeURIComponent(agentId)}` : '/files/git-diff';
      const data = await api.get(url);
      const diffs = (data.diffs || []).filter((d) => !d.path.endsWith('/'));
      setFiles(diffs);
    } catch {
      setFiles([]);
    }
    setLoading(false);
  }, [agentId]);

  useEffect(() => { loadChanges(); }, [loadChanges]);

  async function loadFileContent(filePath) {
    if (fileContents[filePath]) return;
    try {
      const [origRes, currRes] = await Promise.all([
        api.get(`/files/git-show?path=${encodeURIComponent(filePath)}`),
        api.get(`/files/read?path=${encodeURIComponent(filePath)}`).catch(() => null),
      ]);
      setFileContents((prev) => ({
        ...prev,
        [filePath]: {
          original: origRes.content ?? '',
          modified: currRes?.content ?? '',
        },
      }));
    } catch {
      setFileContents((prev) => ({
        ...prev,
        [filePath]: { original: '', modified: '', error: true },
      }));
    }
  }

  function toggleExpand(filePath) {
    if (expandedFile === filePath) {
      setExpandedFile(null);
    } else {
      setExpandedFile(filePath);
      loadFileContent(filePath);
    }
  }

  async function revertFile(filePath) {
    setReverting((prev) => ({ ...prev, [filePath]: true }));
    try {
      await api.post('/files/revert', { path: filePath });
      setFiles((prev) => prev.filter((f) => f.path !== filePath));
      setFileContents((prev) => { const next = { ...prev }; delete next[filePath]; return next; });
      if (expandedFile === filePath) setExpandedFile(null);
    } catch (err) {
      useGrooveStore.getState().addToast('error', 'Failed to revert', err.message);
    }
    setReverting((prev) => ({ ...prev, [filePath]: false }));
  }

  async function revertAll() {
    for (const file of files) {
      await revertFile(file.path);
    }
  }

  function handleComment(path) {
    if (!commentText.trim()) return;
    setComments((prev) => ({ ...prev, [path]: commentText.trim() }));
    setCommentText('');
    setCommentingPath(null);
  }

  async function handleSendFeedback() {
    if (!agentId) return;
    const feedbackLines = files
      .filter((f) => comments[f.path])
      .map((f) => `${f.path}: ${comments[f.path]}`);
    if (feedbackLines.length === 0) return;
    await instructAgent(agentId, `Code review feedback:\n${feedbackLines.join('\n')}`);
    setComments({});
    if (onBack) onBack(); else setEditorViewMode('code');
  }

  const totalAdds = files.reduce((s, f) => s + (f.additions || 0), 0);
  const totalDels = files.reduce((s, f) => s + (f.deletions || 0), 0);
  const hasComments = Object.keys(comments).length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-surface-1 border-b border-border flex-shrink-0">
        <button onClick={() => onBack ? onBack() : setEditorViewMode('code')} className="p-1 rounded hover:bg-surface-4 text-text-3 hover:text-text-1 cursor-pointer" title="Back">
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-text-0 font-sans flex-1">Review Changes</span>
        <span className="text-xs text-text-3 font-sans">
          {files.length} file{files.length !== 1 ? 's' : ''}
        </span>
        {totalAdds > 0 && <span className="text-xs text-success font-sans">+{totalAdds}</span>}
        {totalDels > 0 && <span className="text-xs text-danger font-sans">-{totalDels}</span>}
      </div>

      {/* File list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {loading && (
            <div className="flex items-center justify-center py-12 text-text-4 text-xs font-sans">
              Loading changes...
            </div>
          )}
          {!loading && files.length === 0 && (
            <div className="flex items-center justify-center py-12 text-text-4 text-xs font-sans">
              No changes found
            </div>
          )}
          {files.map((file) => (
            <div key={file.path} className="rounded-md border border-border-subtle bg-surface-2 overflow-hidden">
              {/* File row */}
              <div className="flex items-center gap-2 px-3 py-2">
                {statusIcon(file.status)}
                <button
                  onClick={() => toggleExpand(file.path)}
                  className="flex-1 min-w-0 flex items-center gap-1 text-xs font-mono text-text-1 hover:text-accent text-left cursor-pointer"
                >
                  <ChevronRight size={10} className={cn('text-text-4 transition-transform flex-shrink-0', expandedFile === file.path && 'rotate-90')} />
                  <span className="truncate">{file.path}</span>
                </button>
                <div className="flex items-center gap-2 flex-shrink-0 text-2xs font-sans">
                  {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
                  {file.deletions > 0 && <span className="text-danger">-{file.deletions}</span>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => toggleExpand(file.path)}
                    className="p-1 rounded text-text-4 hover:text-accent hover:bg-accent/10 cursor-pointer transition-colors"
                    title="View diff"
                  >
                    <Eye size={13} />
                  </button>
                  {agentRunning && (
                    <button
                      onClick={() => setCommentingPath(commentingPath === file.path ? null : file.path)}
                      className={cn(
                        'p-1 rounded cursor-pointer transition-colors',
                        comments[file.path]
                          ? 'bg-accent/15 text-accent'
                          : 'text-text-4 hover:text-accent hover:bg-accent/10',
                      )}
                      title="Comment"
                    >
                      <MessageSquare size={13} />
                    </button>
                  )}
                  <button
                    onClick={() => revertFile(file.path)}
                    disabled={reverting[file.path]}
                    className={cn(
                      'p-1 rounded cursor-pointer transition-colors',
                      reverting[file.path]
                        ? 'text-text-4 opacity-50'
                        : 'text-text-4 hover:text-danger hover:bg-danger/10',
                    )}
                    title="Revert file"
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              </div>

              {/* Comment input */}
              {comments[file.path] && commentingPath !== file.path && (
                <div className="px-3 pb-2 text-2xs text-text-2 font-sans italic">
                  {comments[file.path]}
                </div>
              )}
              {commentingPath === file.path && (
                <div className="flex items-center gap-1.5 px-3 pb-2">
                  <input
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleComment(file.path); if (e.key === 'Escape') setCommentingPath(null); }}
                    placeholder="Add review comment..."
                    className="flex-1 h-7 px-2 text-xs bg-surface-0 border border-border-subtle rounded text-text-0 font-sans focus:outline-none focus:border-accent"
                    autoFocus
                  />
                  <button onClick={() => handleComment(file.path)} className="p-1 text-accent hover:text-accent/80 cursor-pointer">
                    <Send size={12} />
                  </button>
                </div>
              )}

              {/* Inline diff */}
              {expandedFile === file.path && (
                <div className="border-t border-border-subtle max-h-[400px] overflow-auto">
                  {fileContents[file.path] ? (
                    fileContents[file.path].error ? (
                      <div className="p-4 text-xs text-text-4 font-sans text-center">Could not load file contents</div>
                    ) : (
                      <DiffViewer
                        filePath={file.path}
                        originalContent={fileContents[file.path].original}
                        modifiedContent={fileContents[file.path].modified}
                      />
                    )
                  ) : (
                    <div className="p-4 text-xs text-text-4 font-sans text-center">Loading diff...</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Footer actions */}
      {files.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border bg-surface-1 flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={revertAll} className="gap-1.5 text-danger">
            <RotateCcw size={13} />
            Revert All
          </Button>
          <div className="flex-1" />
          {agentRunning && hasComments && (
            <Button variant="ghost" size="sm" onClick={handleSendFeedback} className="gap-1.5 text-accent">
              <Send size={13} />
              Send Feedback
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
