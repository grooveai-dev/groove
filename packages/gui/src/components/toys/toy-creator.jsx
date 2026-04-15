// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { Sheet, SheetContent } from '../ui/sheet';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { api } from '../../lib/api';
import { useToast } from '../../lib/hooks/use-toast';
import { Globe, Loader2, Sparkles, Link2 } from 'lucide-react';

const STEPS = {
  input: 'input',
  researching: 'researching',
};

export function ToyCreator({ open, onClose, onCreated }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [step, setStep] = useState(STEPS.input);
  const toast = useToast();

  function reset() {
    setUrl('');
    setName('');
    setStep(STEPS.input);
  }

  function handleClose() {
    if (step === STEPS.researching) return;
    reset();
    onClose();
  }

  async function handleCreate() {
    const trimmed = url.trim();
    if (!trimmed) {
      toast.warning('URL required', 'Paste an API documentation or reference URL.');
      return;
    }

    setStep(STEPS.researching);
    try {
      const toy = await api.post('/toys', {
        docsUrl: trimmed,
        name: name.trim() || undefined,
      });
      toast.success('Toy created', `${toy.name || 'New toy'} is ready to launch.`);
      onCreated?.(toy);
      reset();
      onClose();
    } catch (err) {
      toast.error('Research failed', err.message);
      setStep(STEPS.input);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && handleClose()}>
      <SheetContent title="New Toy" width={440}>
        <ScrollArea className="h-[calc(100%-65px)]">
          <div className="px-5 py-4 space-y-5">
            {step === STEPS.input && (
              <>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-accent/5 border border-accent/10">
                  <Sparkles size={16} className="text-accent mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-text-2 font-sans leading-relaxed">
                    Paste a docs URL and Groove's AI will research the API — endpoints, auth, data structures, rate limits — and build a reusable toy card you can launch anytime.
                  </p>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-text-3 font-sans uppercase tracking-wider mb-1.5">
                    API Docs URL
                  </h4>
                  <div className="relative">
                    <Link2 size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-4" />
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://api.example.com/docs"
                      className="w-full bg-surface-3 border border-border-subtle rounded pl-8 pr-3 py-2 text-xs text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:border-accent/50"
                      onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                      autoFocus
                    />
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-text-3 font-sans uppercase tracking-wider mb-1.5">
                    Name <span className="text-text-4 normal-case tracking-normal">(optional)</span>
                  </h4>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Auto-detected from docs"
                    className="w-full bg-surface-3 border border-border-subtle rounded px-3 py-2 text-xs text-text-0 font-sans placeholder:text-text-4 focus:outline-none focus:border-accent/50"
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  />
                </div>
              </>
            )}

            {step === STEPS.researching && (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <div className="w-14 h-14 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                  <Globe size={24} className="text-accent animate-pulse" />
                </div>
                <div className="text-center space-y-1.5">
                  <p className="text-sm font-semibold text-text-0 font-sans">Researching API...</p>
                  <p className="text-xs text-text-3 font-sans max-w-[260px]">
                    Reading documentation, mapping endpoints, and building your toy card. This takes 15–30 seconds.
                  </p>
                </div>
                <Loader2 size={16} className="text-accent animate-spin" />
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="px-5 py-3 border-t border-border-subtle bg-surface-1">
          {step === STEPS.input && (
            <Button
              variant="primary"
              size="lg"
              className="w-full gap-2"
              onClick={handleCreate}
              disabled={!url.trim()}
            >
              <Sparkles size={14} />
              Research & Create
            </Button>
          )}
          {step === STEPS.researching && (
            <Button variant="ghost" size="lg" className="w-full" disabled>
              <Loader2 size={14} className="animate-spin mr-2" />
              AI is analyzing...
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
