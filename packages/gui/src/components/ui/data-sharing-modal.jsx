// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { Dialog, DialogContent } from './dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useGrooveStore } from '../../stores/groove';
import { Sparkles, Share2, Cpu, Gift, Shield, Check, X } from 'lucide-react';

export function DataSharingModal() {
  const open = useGrooveStore((s) => s.dataSharingModalOpen);
  const setTrainingOptIn = useGrooveStore((s) => s.setTrainingOptIn);
  const dismissDataSharingModal = useGrooveStore((s) => s.dismissDataSharingModal);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-2xl"
        description="Review how your data helps build open source AI"
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
            Help Build Open Source Intelligence
          </DialogPrimitive.Title>
          <p className="text-sm text-text-2 font-sans mt-2 max-w-md mx-auto">
            Your usage data trains a free, local MoE model that every Groove user gets to use — including you.
          </p>
        </div>

        {/* Value Proposition */}
        <div className="px-6 pt-5 pb-1">
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: Share2, title: 'You Share', desc: 'Anonymized agent session data: tool calls, error patterns, task flows' },
              { icon: Cpu, title: 'We Train', desc: 'A Groove-specific Mixture of Experts model built on real multi-agent workflows' },
              { icon: Gift, title: 'Everyone Wins', desc: 'Free, local, open source model for all Groove users. More data = smarter agents' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-lg border border-border-subtle bg-surface-2/50 p-3 text-center">
                <div className="flex justify-center mb-2">
                  <Icon size={18} className="text-accent" />
                </div>
                <div className="text-xs font-semibold text-text-0 font-sans mb-1">{title}</div>
                <div className="text-2xs text-text-2 font-sans leading-relaxed">{desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* What We Collect */}
        <div className="px-6 pt-4">
          <div className="text-xs font-semibold uppercase text-text-3 tracking-wider font-sans mb-2.5">What We Collect</div>
          <div className="space-y-1.5">
            {[
              'Agent tool calling patterns',
              'Error and recovery sequences',
              'Task complexity and coordination events',
              'Model and provider usage metadata',
              'Session duration and outcomes',
            ].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <Check size={12} className="text-accent flex-shrink-0" />
                <span className="text-xs text-text-1 font-sans">{item}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-text-0 font-sans font-medium mt-3">
            That&apos;s it. Groove orchestration data only.
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
                'Anything that could identify your IP or projects',
              ].map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <X size={12} className="text-danger flex-shrink-0" />
                  <span className="text-xs text-text-1 font-sans">{item}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-text-0 font-sans font-medium mt-3">
              13 categories of PII are automatically scrubbed before any data leaves your machine.
            </p>
          </div>
        </div>

        {/* Mission Statement */}
        <div className="px-6 pt-4">
          <div className="border-l-2 border-accent/30 pl-3">
            <p className="text-xs text-text-3 italic leading-relaxed font-sans">
              We believe in open source, decentralized intelligence. Not walled gardens. Not data hoarding. Every contribution makes the model better for everyone. We need your help to get there.
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
