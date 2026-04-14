// FSL-1.1-Apache-2.0 — see LICENSE
import { useGrooveStore } from '../../stores/groove';
import { UpgradeCard } from './upgrade-card';
import { isElectron } from '../../lib/electron';

export function ProGate({ feature, featureKey, description, children }) {
  const authenticated = useGrooveStore((s) => s.marketplaceAuthenticated);
  const subscription = useGrooveStore((s) => s.subscription);
  const edition = useGrooveStore((s) => s.edition);

  if (edition !== 'pro') {
    const variant = isElectron() ? 'community-electron' : 'community';
    return <UpgradeCard feature={feature} description={description} variant={variant} />;
  }

  if (!authenticated) {
    return <UpgradeCard feature={feature} description={description} variant="sign-in" />;
  }

  if (!subscription?.active) {
    return <UpgradeCard feature={feature} description={description} variant="subscribe" />;
  }

  if (featureKey && subscription?.plan !== 'pro' && !(subscription.features || []).includes(featureKey)) {
    return <UpgradeCard feature={feature} description={description} variant="subscribe" />;
  }

  return children;
}
