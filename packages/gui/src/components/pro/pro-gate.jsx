// FSL-1.1-Apache-2.0 — see LICENSE
import { useGrooveStore } from '../../stores/groove';
import { UpgradeCard } from './upgrade-card';

export function ProGate({ feature, description, children }) {
  const authenticated = useGrooveStore((s) => s.marketplaceAuthenticated);
  const user = useGrooveStore((s) => s.marketplaceUser);

  if (__GROOVE_EDITION__ !== 'pro') {
    return <UpgradeCard feature={feature} description={description} variant="community" />;
  }

  if (!authenticated) {
    return <UpgradeCard feature={feature} description={description} variant="sign-in" />;
  }

  if (!user?.subscription?.active) {
    return <UpgradeCard feature={feature} description={description} variant="subscribe" />;
  }

  return children;
}
