// FSL-1.1-Apache-2.0 — see LICENSE
import { useGrooveStore } from '../../stores/groove';
import { UpgradeCard } from './upgrade-card';

export function ProGate({ feature, featureKey, description, children }) {
  const authenticated = useGrooveStore((s) => s.marketplaceAuthenticated);
  const subscription = useGrooveStore((s) => s.subscription);

  if (__GROOVE_EDITION__ !== 'pro') {
    return <UpgradeCard feature={feature} description={description} variant="community" />;
  }

  if (!authenticated) {
    return <UpgradeCard feature={feature} description={description} variant="sign-in" />;
  }

  if (!subscription?.active) {
    return <UpgradeCard feature={feature} description={description} variant="subscribe" />;
  }

  if (featureKey && !(subscription.features || []).includes(featureKey)) {
    return <UpgradeCard feature={feature} description={description} variant="subscribe" />;
  }

  return children;
}
