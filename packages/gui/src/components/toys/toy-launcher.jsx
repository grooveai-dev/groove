// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { Sheet, SheetContent } from '../ui/sheet';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { api } from '../../lib/api';
import { useToast } from '../../lib/hooks/use-toast';
import { useGrooveStore } from '../../stores/groove';
import { ExternalLink, Eye, EyeOff, Rocket, Loader2 } from 'lucide-react';
import * as Icons from 'lucide-react';

function resolveIcon(name) {
  if (!name) return Icons.Box;
  const pascal = name.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
  return Icons[pascal] || Icons[name] || Icons.Box;
}

export function ToyLauncher({ toy, open, onClose }) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [launching, setLaunching] = useState(false);
  const toast = useToast();
  const setActiveView = useGrooveStore((s) => s.setActiveView);

  if (!toy) return null;
  const Icon = resolveIcon(toy.icon);
  const needsKey = toy.authType !== 'none';

  async function handleLaunch() {
    if (needsKey && !apiKey.trim()) {
      toast.warning('API key required', `${toy.name} needs an API key to work.`);
      return;
    }
    setLaunching(true);
    try {
      await api.post(`/toys/${toy.id}/launch`, {
        apiKey: needsKey ? apiKey.trim() : undefined,
        starterPrompt: selectedPrompt || undefined,
      });
      toast.success(`${toy.name} launched`, 'Team is spinning up — switching to agents view.');
      setActiveView('agents');
      onClose();
    } catch (err) {
      toast.error('Launch failed', err.message);
    }
    setLaunching(false);
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent title={toy.name} width={440}>
        <ScrollArea className="h-[calc(100%-65px)]">
          <div className="px-5 py-4 space-y-5">
            {/* Header */}
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 bg-accent/10 border border-accent/20 text-accent">
                <Icon size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant={toy.authType === 'none' ? 'success' : 'warning'}>
                    {toy.authType === 'none' ? 'Free' : 'Key Required'}
                  </Badge>
                  <Badge variant="default">{toy.category}</Badge>
                </div>
                <p className="text-xs text-text-2 font-sans leading-relaxed mt-2">{toy.description}</p>
              </div>
            </div>

            {/* Base URL */}
            {toy.baseUrl && (
              <div>
                <h4 className="text-xs font-semibold text-text-3 font-sans uppercase tracking-wider mb-1.5">Base URL</h4>
                <code className="text-xs text-accent font-mono bg-surface-3 px-2.5 py-1.5 rounded block truncate">
                  {toy.baseUrl}
                </code>
              </div>
            )}

            {/* Sample Endpoints */}
            {toy.sampleEndpoints?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-text-3 font-sans uppercase tracking-wider mb-1.5">Endpoints</h4>
                <div className="space-y-1">
                  {toy.sampleEndpoints.map((ep, i) => {
                    const str = typeof ep === 'string' ? ep : `${ep.method || 'GET'} ${ep.path || ''}`;
                    const spaceIdx = str.indexOf(' ');
                    const method = spaceIdx > 0 ? str.slice(0, spaceIdx) : 'GET';
                    const path = spaceIdx > 0 ? str.slice(spaceIdx + 1) : str;
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs font-mono text-text-2 bg-surface-3 px-2.5 py-1.5 rounded">
                        <Badge variant="accent" className="text-[9px] px-1 py-0">{method}</Badge>
                        <span className="truncate">{path}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Starter Ideas */}
            {toy.starterPrompts?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-text-3 font-sans uppercase tracking-wider mb-1.5">Starter Ideas</h4>
                <div className="flex flex-wrap gap-1.5">
                  {toy.starterPrompts.map((prompt, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedPrompt(selectedPrompt === prompt ? null : prompt)}
                      className={`px-3 py-1.5 text-xs font-sans rounded-full cursor-pointer select-none transition-colors border ${
                        selectedPrompt === prompt
                          ? 'bg-accent/15 text-accent border-accent/25'
                          : 'text-text-2 bg-surface-3 border-border-subtle hover:text-text-0 hover:border-border'
                      }`}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* API Key Input */}
            {needsKey && (
              <div>
                <h4 className="text-xs font-semibold text-text-3 font-sans uppercase tracking-wider mb-1.5">API Key</h4>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={`Enter your ${toy.name} API key`}
                    className="w-full bg-surface-3 border border-border-subtle rounded px-3 py-2 text-xs text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:border-accent/50 pr-9"
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-1 cursor-pointer bg-transparent border-0 p-0.5"
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            )}

            {/* Docs link */}
            {toy.docsUrl && (
              <a
                href={toy.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-accent font-sans hover:underline"
              >
                <ExternalLink size={12} />
                View Documentation
              </a>
            )}
          </div>
        </ScrollArea>

        {/* Footer — sticky launch button */}
        <div className="px-5 py-3 border-t border-border-subtle bg-surface-1">
          <Button
            variant="primary"
            size="lg"
            className="w-full gap-2"
            onClick={handleLaunch}
            disabled={launching || (needsKey && !apiKey.trim())}
          >
            {launching ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Launching...
              </>
            ) : (
              <>
                <Rocket size={14} />
                Launch Team
              </>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
