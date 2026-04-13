// FSL-1.1-Apache-2.0 — see LICENSE
import { Lock, Download, LogIn, Sparkles, ExternalLink } from 'lucide-react';
import { isElectron, openExternal } from '../../lib/electron';
import { useGrooveStore } from '../../stores/groove';

const VARIANTS = {
  community: {
    heading: 'Get Groove Desktop',
    cta: 'Download',
    icon: Download,
    action: () => openExternal('https://groovedev.ai/download'),
  },
  'community-electron': {
    heading: 'Pro Feature',
    cta: 'Learn More',
    icon: ExternalLink,
    action: () => openExternal('https://groovedev.ai/pro'),
  },
  'sign-in': {
    heading: 'Sign in to unlock',
    cta: 'Sign in',
    icon: LogIn,
    action: () => useGrooveStore.getState().marketplaceLogin(),
  },
  subscribe: {
    heading: 'Upgrade to Pro',
    cta: 'Subscribe',
    icon: Sparkles,
    action: () => openExternal('https://groovedev.ai/pro'),
  },
};

export function UpgradeCard({ feature, description, variant = 'community' }) {
  const resolvedVariant = variant === 'community' && isElectron() ? 'community-electron' : variant;
  const v = VARIANTS[resolvedVariant] || VARIANTS.community;
  const CtaIcon = v.icon;

  return (
    <div className="rounded-lg border border-border-subtle bg-surface-1/50 px-5 py-6 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-purple/10">
        <Lock size={18} className="text-purple" />
      </div>
      <h3 className="text-sm font-semibold text-text-1 font-sans">{v.heading}</h3>
      <p className="mt-1.5 text-2xs text-text-3 font-sans">{feature}</p>
      <p className="mt-1 text-2xs text-text-4 font-sans max-w-xs mx-auto">{description}</p>
      <button
        onClick={v.action}
        className="mt-4 inline-flex items-center gap-1.5 h-7 px-4 rounded-full bg-purple/15 text-purple text-xs font-semibold font-sans hover:bg-purple/25 transition-colors cursor-pointer"
      >
        <CtaIcon size={13} />
        {v.cta}
      </button>
    </div>
  );
}
