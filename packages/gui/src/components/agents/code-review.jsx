// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { DiffViewer } from './diff-viewer';
import { api } from '../../lib/api';
import {
  Check, X, MessageSquare, ChevronLeft, CheckCircle2,
  XCircle, Send, FilePlus, FileMinus, FileEdit,
} from 'lucide-react';

export function CodeReview({ agentId: agentIdProp, onBack }) {
  const storeAgentId = useGrooveStore((s) => s.editorSelectedAgent);
  const agentId = agentIdProp || storeAgentId;
  const instructAgent = useGrooveStore((s) => s.instructAgent);
  const openFile = useGrooveStore((s) => s.openFile);
  const setViewMode = useGrooveStore((s) => s.setEditorViewMode);

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [comments, setComments] = useState({});
  const [statuses, setStatuses] = useState({});
  const [commentingPath, setCommentingPath] = useState(null);
  const [commentText, setCommentText] = useState('');

  useEffect(() => {
    loadChanges();
  }, []);

  async function loadChanges() {
    setLoading(true);
    try {
      const data = await api.get('/files/git-status');
      const changed = (data.entries || []).map((f) => ({
        path: f.path,
        status: f.status,
        additions: f.additions || 0,
        deletions: f.deletions || 0,
      }));
      setFiles(changed);
    } catch {
      setFiles([]);
    }
    setLoading(false);
  }

  function statusIcon(status) {
    if (status === 'added' || status === 'A' || status === '?') return <FilePlus size={12} className="text-success" />;
    if (status === 'deleted' || status === 'D') return <FileMinus size={12} className="text-danger" />;
    return <FileEdit size={12} className="text-warning" />;
  }

  function handleComment(path) {
    if (!commentText.trim()) return;
    setComments((prev) => ({ ...prev, [path]: commentText.trim() }));
    setCommentText('');
    setCommentingPath(null);
  }

  function approveFile(path) {
    setStatuses((prev) => ({ ...prev, [path]: prev[path] === 'approved' ? 'pending' : 'approved' }));
  }

  function rejectFile(path) {
    setStatuses((prev) => ({ ...prev, [path]: prev[path] === 'rejected' ? 'pending' : 'rejected' }));
  }

  function handleApproveAll() {
    const next = {};
    files.forEach((f) => { next[f.path] = 'approved'; });
    setStatuses(next);
  }

  async function handleRequestChanges() {
    if (!agentId) return;
    const reviewComments = files
      .filter((f) => comments[f.path] || statuses[f.path] === 'rejected')
      .map((f) => {
        const st = statuses[f.path] === 'rejected' ? '[REJECTED]' : '[COMMENT]';
        return `${st} ${f.path}: ${comments[f.path] || 'Changes needed'}`;
      });
    if (reviewComments.length > 0) {
      await instructAgent(agentId, `Code review feedback:\n${reviewComments.join('\n')}`);
    }
    if (onBack) onBack(); else setViewMode('code');
  }

  const approved = Object.values(statuses).filter((s) => s === 'approved').length;
  const rejected = Object.values(statuses).filter((s) => s === 'rejected').length;

  if (selectedFile) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-2 bg-surface-1 border-b border-border flex-shrink-0">
          <button
            onClick={() => setSelectedFile(null)}
            className="p-1 rounded hover:bg-surface-4 text-text-3 hover:text-text-1 cursor-pointer"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-mono text-text-1 truncate">{selectedFile}</span>
        </div>
        <div className="flex-1 min-h-0">
          <DiffViewer filePath={selectedFile} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 bg-surface-1 border-b border-border flex-shrink-0">
        <button onClick={() => onBack ? onBack() : setViewMode('code')} className="p-1 rounded hover:bg-surface-4 text-text-3 hover:text-text-1 cursor-pointer" title="Back to Editor">
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-text-0 font-sans flex-1">Review Changes</span>
        <span className="text-xs text-text-3 font-sans">
          {files.length} file{files.length !== 1 ? 's' : ''} changed
        </span>
        {approved > 0 && <span className="text-xs text-success font-sans">{approved} approved</span>}
        {rejected > 0 && <span className="text-xs text-danger font-sans">{rejected} rejected</span>}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {loading && (
            <div className="flex items-center justify-center py-12 text-text-4 text-xs font-sans">
              Loading git changes...
            </div>
          )}
          {!loading && files.length === 0 && (
            <div className="flex items-center justify-center py-12 text-text-4 text-xs font-sans">
              No modified files found
            </div>
          )}
          {files.map((file) => (
            <div key={file.path} className="rounded-md border border-border-subtle bg-surface-2">
              <div className="flex items-center gap-2 px-3 py-2">
                {statusIcon(file.status)}
                <button
                  onClick={() => { openFile(file.path); setSelectedFile(file.path); }}
                  className="flex-1 min-w-0 text-xs font-mono text-text-1 hover:text-accent truncate text-left cursor-pointer"
                >
                  {file.path}
                </button>
                <div className="flex items-center gap-2 flex-shrink-0 text-2xs font-sans">
                  {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
                  {file.deletions > 0 && <span className="text-danger">-{file.deletions}</span>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => approveFile(file.path)}
                    className={cn(
                      'p-1 rounded cursor-pointer transition-colors',
                      statuses[file.path] === 'approved'
                        ? 'bg-success/15 text-success'
                        : 'text-text-4 hover:text-success hover:bg-success/10',
                    )}
                    title="Approve"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={() => rejectFile(file.path)}
                    className={cn(
                      'p-1 rounded cursor-pointer transition-colors',
                      statuses[file.path] === 'rejected'
                        ? 'bg-danger/15 text-danger'
                        : 'text-text-4 hover:text-danger hover:bg-danger/10',
                    )}
                    title="Reject"
                  >
                    <X size={14} />
                  </button>
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
                    <MessageSquare size={14} />
                  </button>
                </div>
              </div>
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
                  <button
                    onClick={() => handleComment(file.path)}
                    className="p-1 text-accent hover:text-accent/80 cursor-pointer"
                  >
                    <Send size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="flex items-center gap-2 px-4 py-3 border-t border-border bg-surface-1 flex-shrink-0">
        <Button variant="ghost" size="sm" onClick={handleApproveAll} className="gap-1.5">
          <CheckCircle2 size={13} />
          Approve All
        </Button>
        {agentId && (
          <Button variant="ghost" size="sm" onClick={handleRequestChanges} className="gap-1.5 text-warning">
            <XCircle size={13} />
            Send Review to Agent
          </Button>
        )}
      </div>
    </div>
  );
}
