// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useCallback } from 'react';
import { Search, GitBranch, Star, ExternalLink, Loader2, FolderOpen, Check } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/cn';
import { fmtNum } from '../../lib/format';
import { useGrooveStore } from '../../stores/groove';
import { useToast } from '../../lib/hooks/use-toast';

const GITHUB_RE = /github\.com\/([^/]+)\/([^/\s#?]+)/;

export function RepoImport() {
  const [step, setStep] = useState('input');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [pathOption, setPathOption] = useState('standalone');
  const [customPath, setCustomPath] = useState('');
  const [createTeam, setCreateTeam] = useState(true);
  const [teamName, setTeamName] = useState('');

  const previewRepo = useGrooveStore((s) => s.previewRepo);
  const importRepo = useGrooveStore((s) => s.importRepo);
  const importInProgress = useGrooveStore((s) => s.importInProgress);
  const toast = useToast();

  const doPreview = useCallback(async (repoUrl) => {
    const match = repoUrl.match(GITHUB_RE);
    if (!match) return;
    setLoading(true);
    try {
      const data = await previewRepo(repoUrl);
      setPreview(data);
      setTeamName(data.name || match[2]);
      setStep('preview');
    } catch (err) {
      toast.error('Preview failed', err.message);
    } finally {
      setLoading(false);
    }
  }, [previewRepo, toast]);

  const handleUrlChange = useCallback((e) => {
    const val = e.target.value;
    setUrl(val);
    if (GITHUB_RE.test(val) && step === 'input') {
      doPreview(val);
    }
  }, [step, doPreview]);

  const handleImport = useCallback(async () => {
    if (!preview) return;
    let targetPath;
    if (pathOption === 'standalone') targetPath = `~/Projects/${preview.name}`;
    else if (pathOption === 'subdirectory') targetPath = `./packages/${preview.name}`;
    else targetPath = customPath;
    try {
      await importRepo(url, targetPath, createTeam, teamName);
      toast.success(`Importing ${preview.name}`, 'Setup agent will handle the rest');
      setStep('input');
      setUrl('');
      setPreview(null);
    } catch (err) {
      toast.error('Import failed', err.message);
    }
  }, [preview, pathOption, customPath, url, createTeam, teamName, importRepo, toast]);

  if (step === 'preview' && preview) {
    return (
      <div className="rounded-lg border border-border-subtle bg-surface-2 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-surface-4 flex items-center justify-center flex-shrink-0">
            <GitBranch size={18} className="text-text-2" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-text-0 font-sans">{preview.name}</span>
              <span className="text-2xs text-text-3 font-sans">{preview.owner}</span>
            </div>
            {preview.description && (
              <p className="text-xs text-text-2 font-sans mt-0.5 line-clamp-2">{preview.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 text-2xs text-text-3 font-sans">
          {preview.language && <Badge variant="outline" className="text-2xs">{preview.language}</Badge>}
          {preview.stars != null && (
            <span className="flex items-center gap-1">
              <Star size={10} className="text-warning" fill="currentColor" />
              {fmtNum(preview.stars)}
            </span>
          )}
          {preview.license && <span>{preview.license}</span>}
        </div>

        {preview.detectedFiles?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {preview.detectedFiles.map((f) => (
              <span key={f} className="text-2xs font-mono text-text-3 px-1.5 py-0.5 rounded bg-surface-4">{f}</span>
            ))}
          </div>
        )}

        {preview.readmePreview && (
          <div className="max-h-32 overflow-y-auto rounded bg-surface-1 border border-border-subtle p-3">
            <p className="text-xs text-text-2 font-sans whitespace-pre-wrap">{preview.readmePreview}</p>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button variant="primary" size="sm" onClick={() => setStep('configure')}>
            <FolderOpen size={12} />
            Clone & Setup
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open(url.startsWith('http') ? url : `https://${url}`, '_blank')}
          >
            <ExternalLink size={12} />
            View on GitHub
          </Button>
          <div className="flex-1" />
          <button
            onClick={() => { setStep('input'); setPreview(null); }}
            className="text-2xs text-text-4 font-sans hover:text-text-2 cursor-pointer bg-transparent border-0"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (step === 'configure' && preview) {
    return (
      <div className="rounded-lg border border-border-subtle bg-surface-2 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <GitBranch size={14} className="text-accent" />
          <span className="text-sm font-semibold text-text-0 font-sans">Clone {preview.name}</span>
        </div>

        <div className="space-y-2">
          <span className="text-xs font-medium text-text-2 font-sans">Where to clone?</span>
          {[
            { id: 'standalone', label: `Standalone: ~/Projects/${preview.name}` },
            { id: 'subdirectory', label: `Project subdirectory: ./packages/${preview.name}` },
            { id: 'custom', label: 'Custom path:' },
          ].map((opt) => (
            <label key={opt.id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="path-option"
                checked={pathOption === opt.id}
                onChange={() => setPathOption(opt.id)}
                className="accent-[var(--color-accent)]"
              />
              <span className="text-xs text-text-1 font-sans">{opt.label}</span>
            </label>
          ))}
          {pathOption === 'custom' && (
            <Input
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder="/path/to/directory"
              mono
              className="ml-5 text-xs"
            />
          )}
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={createTeam}
              onChange={(e) => setCreateTeam(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            <span className="text-xs text-text-1 font-sans">Create team for this repo</span>
          </label>
          {createTeam && (
            <Input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Team name"
              className="ml-5 text-xs"
            />
          )}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="primary"
            size="sm"
            onClick={handleImport}
            disabled={importInProgress || (pathOption === 'custom' && !customPath)}
          >
            {importInProgress ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            {importInProgress ? 'Importing...' : 'Start Import'}
          </Button>
          <button
            onClick={() => setStep('preview')}
            className="text-2xs text-text-4 font-sans hover:text-text-2 cursor-pointer bg-transparent border-0"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-4 pointer-events-none" />
      <input
        type="text"
        value={url}
        onChange={handleUrlChange}
        placeholder="Paste a GitHub URL..."
        className={cn(
          'w-full h-9 rounded-lg pl-9 pr-20 text-sm font-sans',
          'bg-surface-1 border border-border text-text-0',
          'placeholder:text-text-4',
          'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
          'transition-colors duration-100',
        )}
      />
      <Button
        variant="primary"
        size="sm"
        className="absolute right-1.5 top-1/2 -translate-y-1/2"
        onClick={() => doPreview(url)}
        disabled={!GITHUB_RE.test(url) || loading}
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : 'Preview'}
      </Button>
    </div>
  );
}
