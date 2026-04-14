// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useCallback } from 'react';
import {
  Search, GitBranch, Star, ExternalLink, Loader2, Check,
  FolderOpen, HardDrive, Package, PenLine, Users, ArrowLeft, Download,
} from 'lucide-react';
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

  // ── Step 1: URL Input ──────────────────────────────────
  if (step === 'input') {
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

  // ── Step 2: Preview ────────────────────────────────────
  if (step === 'preview' && preview) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border-subtle bg-surface-2 p-5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent/8 flex items-center justify-center flex-shrink-0">
              <GitBranch size={22} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-1">
                <span className="text-lg font-bold text-text-0 font-sans">{preview.name}</span>
                <span className="text-xs text-text-4 font-sans">{preview.owner}</span>
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
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button variant="primary" size="sm" onClick={() => setStep('configure')} className="h-8 text-xs gap-1.5 px-4">
                <FolderOpen size={13} />
                Clone & Setup
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  try {
                    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
                    const parsed = new URL(fullUrl);
                    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
                      window.open(fullUrl, '_blank');
                    }
                  } catch {}
                }}
                className="h-8 text-xs gap-1.5"
              >
                <ExternalLink size={12} />
                GitHub
              </Button>
              <button
                onClick={() => { setStep('input'); setPreview(null); }}
                className="text-2xs text-text-4 font-sans hover:text-text-2 cursor-pointer bg-transparent border-0 ml-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>

        {preview.description && (
          <div className="rounded-lg border border-border-subtle bg-surface-1 px-5 py-4">
            <h4 className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider mb-2">About</h4>
            <p className="text-sm text-text-1 font-sans leading-relaxed">{preview.description}</p>
          </div>
        )}

        {preview.readmePreview && (
          <div className="rounded-lg border border-border-subtle bg-surface-1 px-5 py-4">
            <h4 className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider mb-3">README</h4>
            <div className="text-sm text-text-2 font-sans leading-relaxed whitespace-pre-wrap">{preview.readmePreview}</div>
          </div>
        )}
      </div>
    );
  }

  // ── Step 3: Configure ──────────────────────────────────
  if (step === 'configure' && preview) {
    const pathOptions = [
      {
        id: 'standalone',
        icon: HardDrive,
        title: 'Standalone project',
        description: 'Clone to its own directory, separate from this workspace',
        path: `~/Projects/${preview.name}`,
      },
      {
        id: 'subdirectory',
        icon: Package,
        title: 'Workspace package',
        description: 'Add as a package inside this project\'s monorepo',
        path: `./packages/${preview.name}`,
      },
      {
        id: 'custom',
        icon: PenLine,
        title: 'Custom location',
        description: 'Choose your own path',
        path: null,
      },
    ];

    return (
      <div className="rounded-xl border border-border-subtle bg-surface-2 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border-subtle bg-surface-3/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
              <Download size={16} className="text-accent" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-0 font-sans">
                Clone {preview.name}
              </h3>
              <p className="text-2xs text-text-4 font-sans mt-0.5">
                {preview.owner}/{preview.name} — configure where to install
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Location picker */}
          <div>
            <label className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider mb-2.5 block">
              Install location
            </label>
            <div className="space-y-2">
              {pathOptions.map((opt) => {
                const Icon = opt.icon;
                const selected = pathOption === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setPathOption(opt.id)}
                    className={cn(
                      'w-full text-left rounded-lg border p-3.5 transition-all duration-150 cursor-pointer',
                      selected
                        ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
                        : 'border-border-subtle bg-surface-1 hover:border-border hover:bg-surface-1/80',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        'w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5',
                        selected ? 'bg-accent/15 text-accent' : 'bg-surface-3 text-text-4',
                      )}>
                        <Icon size={15} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            'text-xs font-semibold font-sans',
                            selected ? 'text-text-0' : 'text-text-2',
                          )}>
                            {opt.title}
                          </span>
                          {selected && (
                            <div className="w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                              <Check size={10} className="text-white" />
                            </div>
                          )}
                        </div>
                        <p className="text-2xs text-text-4 font-sans mt-0.5 leading-relaxed">
                          {opt.description}
                        </p>
                        {opt.path && selected && (
                          <code className="text-2xs text-accent/80 font-mono mt-1.5 block truncate">
                            {opt.path}
                          </code>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Custom path input */}
            {pathOption === 'custom' && (
              <div className="mt-2.5 ml-11">
                <input
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  placeholder="/path/to/clone"
                  autoFocus
                  className={cn(
                    'w-full h-9 px-3 text-xs font-mono rounded-md',
                    'bg-surface-0 border border-border text-text-0',
                    'placeholder:text-text-4',
                    'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
                    'transition-colors',
                  )}
                />
              </div>
            )}
          </div>

          {/* Team toggle */}
          <div className="border-t border-border-subtle pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-md bg-surface-3 flex items-center justify-center">
                  <Users size={14} className="text-text-4" />
                </div>
                <div>
                  <span className="text-xs font-semibold text-text-2 font-sans block">Create a team</span>
                  <span className="text-2xs text-text-4 font-sans">Organize agents working on this repo into their own team</span>
                </div>
              </div>
              <button
                onClick={() => setCreateTeam(!createTeam)}
                className={cn(
                  'w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0',
                  createTeam ? 'bg-accent' : 'bg-surface-5',
                )}
              >
                <div className={cn(
                  'w-4 h-4 rounded-full bg-white shadow-sm transition-transform',
                  createTeam ? 'translate-x-4' : 'translate-x-0',
                )} />
              </button>
            </div>
            {createTeam && (
              <div className="mt-2.5 ml-11">
                <input
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="Team name"
                  className={cn(
                    'w-full h-9 px-3 text-xs font-sans rounded-md',
                    'bg-surface-0 border border-border text-text-0',
                    'placeholder:text-text-4',
                    'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
                    'transition-colors',
                  )}
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-border-subtle bg-surface-3/30 flex items-center justify-between">
          <button
            onClick={() => setStep('preview')}
            className="flex items-center gap-1.5 text-2xs text-text-4 font-sans hover:text-text-2 cursor-pointer bg-transparent border-0 transition-colors"
          >
            <ArrowLeft size={11} />
            Back
          </button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleImport}
            disabled={importInProgress || (pathOption === 'custom' && !customPath.trim())}
            className="h-8 text-xs gap-1.5 px-5"
          >
            {importInProgress ? (
              <><Loader2 size={12} className="animate-spin" /> Importing...</>
            ) : (
              <><Download size={12} /> Clone & Setup</>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
