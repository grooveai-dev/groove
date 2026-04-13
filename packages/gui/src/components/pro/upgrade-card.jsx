// FSL-1.1-Apache-2.0 — see LICENSE
import { Lock } from 'lucide-react';
import { openExternal } from '../../lib/electron';

export function UpgradeCard({ feature, description }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-1/50 px-5 py-6 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-purple/10">
        <Lock size={18} className="text-purple" />
      </div>
      <h3 className="text-sm font-semibold text-text-1 font-sans">{feature}</h3>
      <p className="mt-1 text-2xs text-text-3 font-sans max-w-xs mx-auto">{description}</p>
      <button
        onClick={() => openExternal('https://groovedev.ai/pro')}
        className="mt-4 inline-flex items-center gap-1.5 h-7 px-4 rounded-full bg-purple/15 text-purple text-xs font-semibold font-sans hover:bg-purple/25 transition-colors cursor-pointer"
      >
        Learn more
      </button>
    </div>
  );
}
