// FSL-1.1-Apache-2.0 — see LICENSE
import { UpgradeCard } from './upgrade-card';

export function ProGate({ feature, description, children }) {
  if (__GROOVE_EDITION__ === 'pro') {
    return children;
  }
  return <UpgradeCard feature={feature} description={description} />;
}
