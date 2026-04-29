// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { Dialog, DialogContent } from './dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useGrooveStore } from '../../stores/groove';
import { Sparkles, Shield, X } from 'lucide-react';

export function DataSharingModal() {
  const open = useGrooveStore((s) => s.dataSharingModalOpen);
  const setTrainingOptIn = useGrooveStore((s) => s.setTrainingOptIn);
  const dismissDataSharingModal = useGrooveStore((s) => s.dismissDataSharingModal);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-md"
        description="Help improve Groove by sharing usage data"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* Hero */}
        <div className="relative bg-gradient-to-br from-accent/5 to-transparent px-6 pt-8 pb-6 text-center">
          <div className="flex justify-center mb-3">
            <div className="w-14 h-14 rounded-xl bg-accent/10 flex items-center justify-center">
              <Sparkles size={32} className="text-accent" />
            </div>
          </div>
          <DialogPrimitive.Title className="text-xl font-bold text-text-0 font-sans">
            Help Build a Better Groove
          </DialogPrimitive.Title>
          <p className="text-sm text-text-2 font-sans mt-2 max-w-md mx-auto">
            We collect errors and usage reports to improve the quality of Groove for everyone.
          </p>
        </div>

        {/* What We Never Collect */}
        <div className="px-6 pt-4">
          <div className="rounded-lg border border-border-subtle bg-surface-2/30 p-4">
            <div className="flex items-center gap-2 mb-2.5">
              <Shield size={14} className="text-text-2" />
              <span className="text-xs font-semibold uppercase text-text-3 tracking-wider font-sans">What We Never Collect</span>
            </div>
            <div className="space-y-1.5">
              {[
                'Your source code or file contents',
                'API keys, passwords, or credentials',
                'Personal information — emails, names, file paths',
                'Anything that could identify you, your IP or projects',
              ].map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <X size={12} className="text-danger flex-shrink-0" />
                  <span className="text-xs text-text-1 font-sans">{item}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-text-0 font-sans font-medium mt-3">
              PII is automatically scrubbed before any data leaves your machine.
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="border-t border-border-subtle mt-5 pt-4 pb-1 px-6">
          <button
            type="button"
            onClick={() => setTrainingOptIn(true)}
            className="w-full h-10 rounded-lg bg-accent text-white font-semibold text-sm hover:bg-accent/90 transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <Sparkles size={15} />
            Turn On Sharing
          </button>
          <div className="text-center mt-2.5">
            <button
              type="button"
              onClick={() => dismissDataSharingModal(dontShowAgain)}
              className="text-xs text-text-3 hover:text-text-1 transition-colors font-sans cursor-pointer"
            >
              Maybe Later
            </button>
          </div>
          <div className="flex items-center justify-center gap-2 mt-3">
            <input
              type="checkbox"
              id="data-sharing-dismiss"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-border accent-accent cursor-pointer"
            />
            <label htmlFor="data-sharing-dismiss" className="text-2xs text-text-3 font-sans cursor-pointer select-none">
              Don&apos;t show this again
            </label>
          </div>
          <p className="text-center text-2xs text-text-4 font-sans mt-2 mb-1">
            You can always enable this later in Settings
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
