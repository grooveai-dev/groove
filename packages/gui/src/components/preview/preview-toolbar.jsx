// FSL-1.1-Apache-2.0 — see LICENSE
import { RefreshCw, Monitor, Tablet, Smartphone, Camera, Square } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useGrooveStore } from '../../stores/groove';

const DEVICE_SIZES = [
  { id: 'desktop', icon: Monitor, label: 'Desktop', width: '100%' },
  { id: 'tablet', icon: Tablet, label: 'Tablet (768px)', width: '768px' },
  { id: 'mobile', icon: Smartphone, label: 'Mobile (375px)', width: '375px' },
];

export function PreviewToolbar({ onRefresh }) {
  const previewState = useGrooveStore((s) => s.previewState);
  const setPreviewDevice = useGrooveStore((s) => s.setPreviewDevice);
  const toggleScreenshotMode = useGrooveStore((s) => s.toggleScreenshotMode);
  const closePreview = useGrooveStore((s) => s.closePreview);

  const proxyUrl = previewState.teamId
    ? `${window.location.origin}/api/preview/${previewState.teamId}/proxy/`
    : previewState.url;

  return (
    <div className="h-10 flex items-center gap-2 px-3 bg-surface-3 border-b border-border flex-shrink-0">
      {/* URL display */}
      <div className="flex-1 min-w-0 h-7 flex items-center px-3 rounded-md bg-surface-1 border border-border-subtle">
        <span className="text-2xs font-mono text-text-3 truncate">{proxyUrl || 'No URL'}</span>
      </div>

      {/* Refresh */}
      <button
        onClick={onRefresh}
        className="w-7 h-7 flex items-center justify-center rounded-md text-text-3 hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
        title="Refresh"
      >
        <RefreshCw size={14} />
      </button>

      {/* Device size toggles */}
      <div className="flex items-center gap-0.5 px-1 py-0.5 rounded-md bg-surface-1 border border-border-subtle">
        {DEVICE_SIZES.map((device) => (
          <button
            key={device.id}
            onClick={() => setPreviewDevice(device.id)}
            className={cn(
              'w-7 h-6 flex items-center justify-center rounded transition-colors cursor-pointer',
              previewState.deviceSize === device.id
                ? 'text-accent bg-accent/10'
                : 'text-text-3 hover:text-text-1',
            )}
            title={device.label}
          >
            <device.icon size={13} />
          </button>
        ))}
      </div>

      {/* Screenshot */}
      <button
        onClick={toggleScreenshotMode}
        className={cn(
          'w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer',
          previewState.screenshotMode
            ? 'text-accent bg-accent/10'
            : 'text-text-3 hover:text-accent hover:bg-accent/10',
        )}
        title="Screenshot"
      >
        <Camera size={14} />
      </button>

      {/* Stop preview */}
      <button
        onClick={closePreview}
        className="w-7 h-7 flex items-center justify-center rounded-md text-text-3 hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
        title="Stop preview"
      >
        <Square size={13} />
      </button>
    </div>
  );
}
