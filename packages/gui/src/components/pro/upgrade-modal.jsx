// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '../ui/dialog';
import { useGrooveStore } from '../../stores/groove';
import { openExternal } from '../../lib/electron';
import { cn } from '../../lib/cn';
import { Sparkles, Check, Server, Cloud, LogIn } from 'lucide-react';

const PRO_FEATURES = [
  { icon: Server, label: 'Federation', desc: 'Multi-machine daemon pairing' },
  { icon: Cloud, label: 'Cloud Teams', desc: 'Coming soon' },
];

export function UpgradeModal() {
  const open = useGrooveStore(s => s.upgradeModalOpen);
  const setOpen = useGrooveStore(s => s.setUpgradeModalOpen);
  const authenticated = useGrooveStore(s => s.marketplaceAuthenticated);
  const marketplaceLogin = useGrooveStore(s => s.marketplaceLogin);
  const startCheckout = useGrooveStore(s => s.startCheckout);
  const addToast = useGrooveStore(s => s.addToast);

  const [plans, setPlans] = useState(null);
  const [billing, setBilling] = useState('monthly');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && !plans) {
      useGrooveStore.getState().fetchSubscriptionPlans()
        .then(p => setPlans(p))
        .catch(() => {});
    }
  }, [open, plans]);

  const price = plans?.pro?.[billing];
  const displayPrice = billing === 'annual'
    ? `$${Math.round((price?.price || 96) / 12)}/mo`
    : `$${price?.price || 10}/mo`;

  async function handleSubscribe() {
    if (!authenticated) {
      marketplaceLogin();
      return;
    }
    if (!price?.priceId) {
      openExternal('https://groovedev.ai/pro');
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      await startCheckout(price.priceId);
      setOpen(false);
    } catch (err) {
      if (err.status === 401 || err.message?.includes('Not authenticated')) {
        addToast('info', 'Please sign in first');
        marketplaceLogin();
      } else if (err.status === 409) {
        addToast('info', 'You already have a subscription');
        setOpen(false);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Upgrade to Pro" className="max-w-[440px]">
        <div className="px-6 py-5">
          <div className="text-center mb-6">
            <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
              <Sparkles size={22} className="text-accent" />
            </div>
            <h2 className="text-lg font-bold text-text-0">Upgrade to Groove Pro</h2>
            <p className="text-sm text-text-2 mt-1">Unlock powerful features for your AI workflow</p>
          </div>

          <div className="space-y-3 mb-6">
            {PRO_FEATURES.map(f => (
              <div key={f.label} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-md bg-surface-4 flex items-center justify-center flex-shrink-0">
                  <f.icon size={15} className="text-accent" />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-0">{f.label}</p>
                  <p className="text-2xs text-text-3">{f.desc}</p>
                </div>
                <Check size={14} className="text-success ml-auto flex-shrink-0" />
              </div>
            ))}
          </div>

          <div className="flex gap-1 mb-5 bg-surface-3 p-0.5 rounded-md">
            <button
              type="button"
              onClick={() => setBilling('monthly')}
              className={cn(
                'flex-1 h-8 rounded text-xs font-medium transition-colors cursor-pointer',
                billing === 'monthly' ? 'bg-surface-5 text-text-0' : 'text-text-3 hover:text-text-1',
              )}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBilling('annual')}
              className={cn(
                'flex-1 h-8 rounded text-xs font-medium transition-colors cursor-pointer',
                billing === 'annual' ? 'bg-surface-5 text-text-0' : 'text-text-3 hover:text-text-1',
              )}
            >
              Annual
              <span className="ml-1 text-success text-2xs">Save 20%</span>
            </button>
          </div>

          <div className="text-center mb-5">
            <span className="text-3xl font-bold text-text-0">{displayPrice}</span>
            {billing === 'annual' && (
              <p className="text-2xs text-text-3 mt-1">Billed ${price?.price || 96}/year</p>
            )}
          </div>

          <button
            type="button"
            onClick={handleSubscribe}
            disabled={loading}
            className="w-full h-10 rounded-lg bg-accent text-white font-semibold text-sm hover:bg-accent/90 transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
          >
            {loading ? (
              'Processing...'
            ) : !authenticated ? (
              <><LogIn size={15} /> Sign in to subscribe</>
            ) : (
              <><Sparkles size={15} /> Subscribe — {displayPrice}</>
            )}
          </button>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full mt-2 text-xs text-text-4 hover:text-text-2 transition-colors cursor-pointer py-1"
          >
            Maybe later
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
