// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { DiffViewer } from './diff-viewer';
import { Check, X, MessageSquare, ChevronLeft, CheckCircle2, XCircle, Send, Users } from 'lucide-react';

export function CodeReview({ agentId }) {
  const reviewFiles = useGrooveStore((s) => s.workspaceReviewFiles);
  const approveFile = useGrooveStore((s) => s.approveFile);
  const rejectFile = useGrooveStore((s) => s.rejectFile);
  const commentFile = useGrooveStore((s) => s.commentFile);
  const instructAgent = useGrooveStore((s) => s.instructAgent);
  const toggleReviewMode = useGrooveStore((s) => s.toggleReviewMode);
  const openFile = useGrooveStore((s) => s.openFile);
  const setWorkspaceMode = useGrooveStore((s) => s.setWorkspaceMode);

  const [selectedFile, setSelectedFile] = useState(null);
  const [commentingPath, setCommentingPath] = useState(null);
  const [commentText, setCommentText] = useState('');

  const approved = reviewFiles.filter((f) => f.status === 'approved').length;
  const rejected = reviewFiles.filter((f) => f.status === 'rejected').length;

  function handleComment(path) {
    if (!commentText.trim()) return;
    commentFile(path, commentText.trim());
    setCommentText('');
    setCommentingPath(null);
  }

  function handleApproveAll() {
    for (const f of reviewFiles) {
      approveFile(f.path);
    }
  }

  async function handleRequestChanges() {
    const comments = reviewFiles
      .filter((f) => f.comment || f.status === 'rejected')
      .map((f) => {
        const status = f.status === 'rejected' ? '[REJECTED]' : '[COMMENT]';
        return `${status} ${f.path}: ${f.comment || 'Changes needed'}`;
      });
    if (comments.length > 0) {
      await instructAgent(agentId, `Code review feedback:\n${comments.join('\n')}`);
    }
    toggleReviewMode();
  }

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
        <button onClick={toggleReviewMode} className="p-1 rounded hover:bg-surface-4 text-text-3 hover:text-text-1 cursor-pointer" title="Back to Files">
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-text-0 font-sans flex-1">Review Changes</span>
        <span className="text-xs text-text-3 font-sans">
          {reviewFiles.length} file{reviewFiles.length !== 1 ? 's' : ''} changed
        </span>
        {approved > 0 && <span className="text-xs text-success font-sans">{approved} approved</span>}
        {rejected > 0 && <span className="text-xs text-danger font-sans">{rejected} rejected</span>}
        <button onClick={() => { toggleReviewMode(); setWorkspaceMode(false); }} className="p-1.5 rounded bg-surface-3 hover:bg-surface-4 text-text-2 hover:text-text-0 cursor-pointer flex items-center gap-1.5" title="Back to Team">
          <Users size={14} />
          <span className="text-xs font-sans">Team</span>
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {reviewFiles.length === 0 && (
            <div className="flex items-center justify-center py-12 text-text-4 text-xs font-sans">
              No modified files found
            </div>
          )}
          {reviewFiles.map((file) => (
            <div key={file.path} className="rounded-md border border-border-subtle bg-surface-2">
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  onClick={() => { openFile(file.path); setSelectedFile(file.path); }}
                  className="flex-1 min-w-0 text-xs font-mono text-text-1 hover:text-accent truncate text-left cursor-pointer"
                >
                  {file.path}
                </button>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => approveFile(file.path)}
                    className={cn(
                      'p-1 rounded cursor-pointer transition-colors',
                      file.status === 'approved'
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
                      file.status === 'rejected'
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
                      file.comment
                        ? 'bg-accent/15 text-accent'
                        : 'text-text-4 hover:text-accent hover:bg-accent/10',
                    )}
                    title="Comment"
                  >
                    <MessageSquare size={14} />
                  </button>
                </div>
              </div>
              {file.comment && commentingPath !== file.path && (
                <div className="px-3 pb-2 text-2xs text-text-2 font-sans italic">
                  {file.comment}
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
        <Button variant="ghost" size="sm" onClick={handleRequestChanges} className="gap-1.5 text-warning">
          <XCircle size={13} />
          Request Changes
        </Button>
      </div>
    </div>
  );
}
