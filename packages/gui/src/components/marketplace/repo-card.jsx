// FSL-1.1-Apache-2.0 — see LICENSE
import { FolderOpen, Trash2, Bomb } from 'lucide-react';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/cn';
import { timeAgo } from '../../lib/format';

export function RepoCard({ repo, onRemove, onNuke, onOpen }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-2 p-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-0 font-sans truncate">{repo.repoName || repo.name}</span>
          <span className="text-2xs text-text-3 font-sans">{repo.repoOwner || repo.owner}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {repo.language && <Badge variant="outline" className="text-2xs">{repo.language}</Badge>}
          <span className="text-2xs text-text-4 font-mono truncate max-w-[180px]">{repo.clonedTo || repo.path}</span>
        </div>
        <span className="text-2xs text-text-4 font-sans mt-0.5 block">
          {repo.clonedAt ? `Imported ${timeAgo(repo.clonedAt)}` : repo.status || ''}
        </span>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        {onOpen && (
          <button
            onClick={() => onOpen(repo)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-2xs font-sans cursor-pointer',
              'text-accent bg-accent/10 hover:bg-accent/20 border-0 transition-colors',
            )}
          >
            <FolderOpen size={11} />
            Open
          </button>
        )}
        {onRemove && (
          <button
            onClick={() => onRemove(repo)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-2xs font-sans cursor-pointer',
              'text-text-3 hover:text-text-1 hover:bg-surface-4 bg-transparent border-0 transition-colors',
            )}
          >
            <Trash2 size={11} />
            Remove
          </button>
        )}
        {onNuke && (
          <button
            onClick={() => onNuke(repo)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-2xs font-sans cursor-pointer',
              'text-danger bg-danger/10 hover:bg-danger/20 border-0 transition-colors',
            )}
          >
            <Bomb size={11} />
            Nuke
          </button>
        )}
      </div>
    </div>
  );
}
