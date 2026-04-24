// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, X, Loader2 } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';

export function ScreenshotOverlay({ iframeRef }) {
  const toggleScreenshotMode = useGrooveStore((s) => s.toggleScreenshotMode);
  const iteratePreview = useGrooveStore((s) => s.iteratePreview);

  const overlayRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [captured, setCaptured] = useState(null); // { base64, rect, loading }
  const [comment, setComment] = useState('');
  const [flashRect, setFlashRect] = useState(null);

  const handleMouseDown = useCallback((e) => {
    if (captured) return;
    const rect = overlayRef.current.getBoundingClientRect();
    setStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setEnd(null);
    setDragging(true);
  }, [captured]);

  const handleMouseMove = useCallback((e) => {
    if (!dragging || captured) return;
    const rect = overlayRef.current.getBoundingClientRect();
    setEnd({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, [dragging, captured]);

  const handleMouseUp = useCallback(() => {
    if (!dragging || !start || !end) {
      setDragging(false);
      return;
    }
    setDragging(false);

    const selRect = {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      w: Math.abs(end.x - start.x),
      h: Math.abs(end.y - start.y),
    };

    if (selRect.w < 10 || selRect.h < 10) {
      setStart(null);
      setEnd(null);
      return;
    }

    setCaptured({ base64: null, rect: selRect, loading: true });

    function finishCapture(base64) {
      setCaptured({ base64, rect: selRect, loading: false });
      setFlashRect(selRect);
      setTimeout(() => setFlashRect(null), 600);
    }

    function drawPlaceholder() {
      const canvas = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      canvas.width = selRect.w * dpr;
      canvas.height = selRect.h * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#1e2127';
      ctx.fillRect(0, 0, selRect.w, selRect.h);
      ctx.strokeStyle = '#3e4451';
      ctx.lineWidth = 1;
      ctx.strokeRect(4, 4, selRect.w - 8, selRect.h - 8);
      ctx.fillStyle = '#6e7681';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(selRect.w)} × ${Math.round(selRect.h)}`, selRect.w / 2, selRect.h / 2);
      return canvas.toDataURL('image/png');
    }

    try {
      const iframe = iframeRef.current;
      if (!iframe) { finishCapture(drawPlaceholder()); return; }

      const canvas = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      canvas.width = selRect.w * dpr;
      canvas.height = selRect.h * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const iframeRect = iframe.getBoundingClientRect();
      const overlayRect = overlayRef.current.getBoundingClientRect();
      const offsetX = selRect.x - (iframeRect.left - overlayRect.left);
      const offsetY = selRect.y - (iframeRect.top - overlayRect.top);

      try {
        ctx.drawImage(iframe, -offsetX * dpr, -offsetY * dpr, iframeRect.width * dpr, iframeRect.height * dpr, 0, 0, selRect.w, selRect.h);
        const testPixel = ctx.getImageData(0, 0, 1, 1).data;
        if (testPixel[0] === 0 && testPixel[1] === 0 && testPixel[2] === 0 && testPixel[3] === 0) {
          throw new Error('blank');
        }
        finishCapture(canvas.toDataURL('image/png'));
      } catch {
        finishCapture(drawPlaceholder());
      }
    } catch {
      setStart(null);
      setEnd(null);
      setCaptured(null);
    }
  }, [dragging, start, end, iframeRef]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') toggleScreenshotMode();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleScreenshotMode]);

  function handleSubmit() {
    if (!captured || captured.loading) return;
    iteratePreview(comment || 'See screenshot', captured.base64);
    toggleScreenshotMode();
  }

  const selBox = start && end ? {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  } : null;

  const popoverPosition = useCallback((rect) => {
    if (!rect || !overlayRef.current) return {};
    const overlayH = overlayRef.current.clientHeight;
    const overlayW = overlayRef.current.clientWidth;
    const spaceBelow = overlayH - (rect.y + rect.h + 8);
    const popoverH = 200;
    const placeAbove = spaceBelow < popoverH && rect.y > popoverH;
    return {
      left: Math.max(8, Math.min(rect.x, overlayW - 300)),
      top: placeAbove ? rect.y - popoverH - 8 : rect.y + rect.h + 8,
    };
  }, []);

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-30"
      style={{ cursor: captured ? 'default' : 'crosshair' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Tinted overlay */}
      <div className="absolute inset-0 bg-info/10 pointer-events-none" />

      {/* Selection rectangle */}
      {selBox && !captured && (
        <div
          className="absolute border-2 border-dashed border-accent bg-accent/5 pointer-events-none"
          style={selBox}
        />
      )}

      {/* Capture flash */}
      {flashRect && (
        <div
          className="absolute pointer-events-none animate-capture-flash rounded"
          style={{ left: flashRect.x, top: flashRect.y, width: flashRect.w, height: flashRect.h }}
        />
      )}

      {/* Captured selection outline */}
      {captured && (
        <div
          className="absolute border-2 border-accent rounded pointer-events-none"
          style={{ left: captured.rect.x, top: captured.rect.y, width: captured.rect.w, height: captured.rect.h }}
        />
      )}

      {/* Capture popover */}
      {captured && (
        <div
          className="absolute z-40 w-72 bg-surface-2 border border-border rounded-lg shadow-2xl animate-chat-fade-in"
          style={popoverPosition(captured.rect)}
        >
          <div className="p-3 border-b border-border-subtle">
            {captured.loading ? (
              <div className="w-full h-24 rounded border border-border-subtle bg-surface-0 flex items-center justify-center">
                <Loader2 size={20} className="text-accent animate-spin" />
              </div>
            ) : (
              <img
                src={captured.base64}
                alt="Screenshot"
                className="w-full h-auto rounded border border-border-subtle max-h-32 object-contain bg-surface-0"
              />
            )}
          </div>
          <div className="p-3 flex items-center gap-2">
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              placeholder="Describe what to change..."
              className="flex-1 h-8 px-3 rounded-md bg-surface-1 border border-border-subtle text-sm text-text-0 font-sans placeholder:text-text-4 focus:outline-none focus:border-accent/40"
              autoFocus
            />
            <button
              onClick={handleSubmit}
              disabled={captured.loading}
              className="w-8 h-8 flex items-center justify-center rounded-md bg-accent/15 text-accent hover:bg-accent/25 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Send size={14} />
            </button>
            <button
              onClick={() => toggleScreenshotMode()}
              className="w-8 h-8 flex items-center justify-center rounded-md text-text-3 hover:text-text-1 hover:bg-surface-4 transition-colors cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Instructions hint */}
      {!captured && !dragging && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-surface-0/90 border border-border-subtle text-2xs text-text-2 font-sans pointer-events-none">
          Click and drag to select a region &middot; Esc to cancel
        </div>
      )}
    </div>
  );
}
