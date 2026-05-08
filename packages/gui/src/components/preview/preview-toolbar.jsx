// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect } from 'react';
import { RefreshCw, Monitor, Tablet, Smartphone, Camera, X } from 'lucide-react';
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
  const stopPreview = useGrooveStore((s) => s.stopPreview);

  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  function handleClose() {
    if (confirming) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setConfirming(false);
      stopPreview();
    } else {
      setConfirming(true);
      timerRef.current = setTimeout(() => setConfirming(false), 2000);
    }
  }

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

      {/* Hide preview (first click) / Stop server (second click) */}
      <button
        onClick={confirming ? handleClose : closePreview}
        onContextMenu={(e) => { e.preventDefault(); setConfirming(true); timerRef.current = setTimeout(() => setConfirming(false), 3000); }}
        className={cn(
          'h-7 flex items-center justify-center rounded-md transition-all cursor-pointer',
          confirming
            ? 'px-2 gap-1.5 bg-danger/15 text-danger border border-danger/25'
            : 'w-7 text-text-3 hover:text-text-1 hover:bg-surface-4',
        )}
        title={confirming ? 'Click to stop server' : 'Hide preview'}
      >
        {confirming ? (
          <span className="text-2xs font-semibold font-sans whitespace-nowrap">Stop server?</span>
        ) : (
          <X size={14} />
        )}
      </button>
    </div>
  );
}
