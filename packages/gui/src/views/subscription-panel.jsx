// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cn } from '../lib/cn';
import {
  Crown, Sparkles, Users, Check, CreditCard, AlertTriangle,
  Minus, Plus, Shield, Radio, Cloud, Server, Headphones,
} from 'lucide-react';

const FEATURE_LABELS = {
  'remote-access': { label: 'Remote Access', icon: Radio },
  'federation': { label: 'Federation', icon: Server },
  'cloud-teams': { label: 'Cloud Teams', icon: Cloud },
  'cloud-backup': { label: 'Cloud Backup', icon: Shield },
  'shared-workspace': { label: 'Shared Workspace', icon: Users },
  'admin-controls': { label: 'Admin Controls', icon: Shield },
  'priority-support': { label: 'Priority Support', icon: Headphones },
};

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function PlanBadge({ plan, status, cancelAtPeriodEnd }) {
  if (status === 'past_due') {
    return <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning text-2xs">Payment issue</Badge>;
  }
  if (cancelAtPeriodEnd) {
    return <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning text-2xs">Cancels at period end</Badge>;
  }
  if (status === 'active' || status === 'trialing') {
    return <Badge variant="outline" className="border-success/30 bg-success/10 text-success text-2xs">Active</Badge>;
  }
  return null;
}

function FeatureList({ features }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {features.map((key) => {
        const f = FEATURE_LABELS[key] || { label: key, icon: Check };
        const Icon = f.icon;
        return (
          <span key={key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-3 text-2xs text-text-2 font-sans">
            <Icon size={10} className="text-accent" />
            {f.label}
          </span>
        );
      })}
    </div>
  );
}

function SeatControl({ seats, onChange }) {
  const [value, setValue] = useState(seats);

  useEffect(() => { setValue(seats); }, [seats]);

  const dec = () => { if (value > 1) { setValue(value - 1); onChange(value - 1); } };
  const inc = () => { if (value < 999) { setValue(value + 1); onChange(value + 1); } };

  return (
    <div className="mt-4 flex items-center gap-3">
      <span className="text-xs text-text-2 font-sans">Seats</span>
      <div className="flex items-center gap-1 bg-surface-0 rounded-md border border-border-subtle p-0.5">
        <button onClick={dec} disabled={value <= 1} className="w-6 h-6 flex items-center justify-center rounded text-text-3 hover:text-text-0 hover:bg-surface-3 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
          <Minus size={12} />
        </button>
        <span className="w-8 text-center text-xs font-semibold text-text-0 font-mono">{value}</span>
        <button onClick={inc} disabled={value >= 999} className="w-6 h-6 flex items-center justify-center rounded text-text-3 hover:text-text-0 hover:bg-surface-3 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}

function ActivePlanCard({ subscription }) {
  const openPortal = useGrooveStore((s) => s.openPortal);
  const updateSeats = useGrooveStore((s) => s.updateSeats);
  const planLabel = subscription.plan === 'team' ? 'Team Plan' : 'Pro Plan';
  const PlanIcon = subscription.plan === 'team' ? Users : Crown;

  return (
    <div className="rounded-md border border-border-subtle bg-surface-1 p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-purple/15">
            <PlanIcon size={16} className="text-purple" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-text-0 font-sans">{planLabel}</h4>
            <div className="flex items-center gap-2 mt-0.5">
              <PlanBadge plan={subscription.plan} status={subscription.status} cancelAtPeriodEnd={subscription.cancelAtPeriodEnd} />
              {subscription.periodEnd && (
                <span className="text-2xs text-text-3 font-sans">
                  {subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'} {formatDate(subscription.periodEnd)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {subscription.features?.length > 0 && (
        <FeatureList features={subscription.features} />
      )}

      {subscription.plan === 'team' && (
        <SeatControl seats={subscription.seats || 1} onChange={updateSeats} />
      )}

      {subscription.status === 'past_due' && (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-warning/10 border border-warning/20 px-3 py-2">
          <AlertTriangle size={14} className="text-warning shrink-0" />
          <span className="text-2xs text-warning font-sans">There's an issue with your payment method.</span>
        </div>
      )}

      <div className="flex gap-2 mt-4">
        <Button size="sm" variant="ghost" onClick={openPortal} className="h-7 text-2xs gap-1.5 text-text-2 hover:text-accent">
          <CreditCard size={12} />
          Manage Subscription
        </Button>
      </div>
    </div>
  );
}

function PricingCard({ name, plan, price, interval, features, onUpgrade, highlighted }) {
  const PlanIcon = plan === 'team' ? Users : Sparkles;
  const perSeat = plan === 'team';

  return (
    <div className={cn(
      'rounded-md border bg-surface-1 p-4 flex flex-col',
      highlighted ? 'border-accent/40' : 'border-border-subtle',
    )}>
      <div className="flex items-center gap-2 mb-1">
        <div className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md',
          highlighted ? 'bg-accent/15' : 'bg-purple/15',
        )}>
          <PlanIcon size={14} className={highlighted ? 'text-accent' : 'text-purple'} />
        </div>
        <h4 className="text-sm font-semibold text-text-0 font-sans">{name}</h4>
      </div>

      <div className="mt-2 mb-3">
        <span className="text-lg font-bold text-text-0 font-sans">${price}</span>
        <span className="text-2xs text-text-3 font-sans">/{interval === 'year' ? 'yr' : 'mo'}{perSeat ? '/seat' : ''}</span>
      </div>

      <div className="flex-1 space-y-1.5 mb-4">
        {features.map((key) => {
          const f = FEATURE_LABELS[key] || { label: key };
          return (
            <div key={key} className="flex items-center gap-1.5 text-2xs text-text-2 font-sans">
              <Check size={11} className="text-success shrink-0" />
              {f.label}
            </div>
          );
        })}
      </div>

      <Button
        size="sm"
        onClick={onUpgrade}
        className={cn(
          'h-7 text-xs font-semibold w-full',
          highlighted
            ? 'bg-accent text-white hover:bg-accent/90'
            : 'bg-purple/15 text-purple hover:bg-purple/25',
        )}
      >
        Upgrade
      </Button>
    </div>
  );
}

export function SubscriptionPanel() {
  const subscription = useGrooveStore((s) => s.subscription);
  const authenticated = useGrooveStore((s) => s.marketplaceAuthenticated);
  const fetchSubscriptionPlans = useGrooveStore((s) => s.fetchSubscriptionPlans);
  const startCheckout = useGrooveStore((s) => s.startCheckout);
  const addToast = useGrooveStore((s) => s.addToast);

  const [plans, setPlans] = useState(null);
  const [billing, setBilling] = useState('monthly');
  const [loading, setLoading] = useState(false);
  const [planError, setPlanError] = useState(false);

  useEffect(() => {
    if (!subscription?.active && authenticated) {
      setLoading(true);
      setPlanError(false);
      fetchSubscriptionPlans()
        .then((data) => setPlans(data))
        .catch(() => setPlanError(true))
        .finally(() => setLoading(false));
    }
  }, [subscription?.active, authenticated, fetchSubscriptionPlans]);

  const handleUpgrade = async (priceId) => {
    try {
      await startCheckout(priceId);
    } catch (err) {
      if (err.status === 409) {
        addToast('info', 'Already subscribed', 'Use Manage Subscription to switch plans');
      }
    }
  };

  if (subscription?.active) {
    return <ActivePlanCard subscription={subscription} />;
  }

  if (!authenticated) {
    return (
      <div className="rounded-md border border-dashed border-border-subtle bg-surface-1/50 px-4 py-6 text-center">
        <Crown size={20} className="text-text-4 mx-auto mb-2" />
        <p className="text-xs text-text-3 font-sans">Sign in to manage your subscription.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-md border border-border-subtle bg-surface-1 p-4 h-52 animate-pulse" />
        ))}
      </div>
    );
  }

  if (planError || !plans) {
    return (
      <div className="rounded-md border border-dashed border-border-subtle bg-surface-1/50 px-4 py-6 text-center">
        <Sparkles size={20} className="text-text-4 mx-auto mb-2" />
        <p className="text-xs text-text-3 font-sans">Plans unavailable right now. Visit groovedev.ai/pro for details.</p>
      </div>
    );
  }

  const proPlan = plans.pro;
  const teamPlan = plans.team;
  const isAnnual = billing === 'annual';

  return (
    <div>
      <div className="flex justify-center mb-4">
        <div className="flex bg-surface-0 rounded-md p-0.5 border border-border-subtle">
          <button
            onClick={() => setBilling('monthly')}
            className={cn(
              'px-3 py-1.5 text-2xs font-semibold font-sans rounded transition-all cursor-pointer',
              billing === 'monthly' ? 'bg-accent/15 text-accent shadow-sm' : 'text-text-3 hover:text-text-1',
            )}
          >
            Monthly
          </button>
          <button
            onClick={() => setBilling('annual')}
            className={cn(
              'px-3 py-1.5 text-2xs font-semibold font-sans rounded transition-all cursor-pointer',
              billing === 'annual' ? 'bg-accent/15 text-accent shadow-sm' : 'text-text-3 hover:text-text-1',
            )}
          >
            Annual
            <span className="ml-1 text-success">-20%</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {proPlan && (
          <PricingCard
            name="Pro"
            plan="pro"
            price={isAnnual ? proPlan.annual.price : proPlan.monthly.price}
            interval={isAnnual ? 'year' : 'month'}
            features={proPlan.features}
            highlighted
            onUpgrade={() => handleUpgrade(isAnnual ? proPlan.annual.priceId : proPlan.monthly.priceId)}
          />
        )}
        {teamPlan && (
          <PricingCard
            name="Team"
            plan="team"
            price={isAnnual ? teamPlan.annual.price : teamPlan.monthly.price}
            interval={isAnnual ? 'year' : 'month'}
            features={teamPlan.features}
            onUpgrade={() => handleUpgrade(isAnnual ? teamPlan.annual.priceId : teamPlan.monthly.priceId)}
          />
        )}
      </div>
    </div>
  );
}
