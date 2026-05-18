// FSL-1.1-Apache-2.0 — see LICENSE
import { FleetSidebar } from '../components/fleet/fleet-sidebar';
import { FleetContent } from '../components/fleet/fleet-content';
import { useGrooveStore } from '../stores/groove';

export default function FleetView() {
  const sidebarWidth = useGrooveStore((s) => s.fleetSidebarWidth);

  return (
    <div className="flex h-full min-h-0">
      <FleetSidebar width={sidebarWidth} />
      <FleetContent />
    </div>
  );
}
