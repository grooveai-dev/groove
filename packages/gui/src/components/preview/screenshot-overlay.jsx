// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, X } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';

export function ScreenshotOverlay({ iframeRef }) {
  const toggleScreenshotMode = useGrooveStore((s) => s.toggleScreenshotMode);
  const iteratePreview = useGrooveStore((s) => s.iteratePreview);

  const overlayRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [captured, setCaptured] = useState(null); // { base64, rect }
  const [comment, setComment] = useState('');

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

    try {
      const iframe = iframeRef.current;
      if (!iframe) { setStart(null); setEnd(null); return; }

      const canvas = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      canvas.width = selRect.w * dpr;
      canvas.height = selRect.h * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      // Same-origin proxy iframe — serialize DOM to SVG foreignObject for capture
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        const serializer = new XMLSerializer();
        const html = serializer.serializeToString(iframeDoc.documentElement);
        const iframeRect = iframe.getBoundingClientRect();
        const overlayRect = overlayRef.current.getBoundingClientRect();
        const offsetX = selRect.x - (iframeRect.left - overlayRect.left);
        const offsetY = selRect.y - (iframeRect.top - overlayRect.top);

        const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${selRect.w}" height="${selRect.h}">
          <foreignObject x="${-offsetX}" y="${-offsetY}" width="${iframeRect.width}" height="${iframeRect.height}">
            ${html}
          </foreignObject>
        </svg>`;
        const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, selRect.w, selRect.h);
          URL.revokeObjectURL(url);
          setCaptured({ base64: canvas.toDataURL('image/png'), rect: selRect });
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          // Fallback: region placeholder
          ctx.fillStyle = '#1e2127';
          ctx.fillRect(0, 0, selRect.w, selRect.h);
          ctx.fillStyle = '#6e7681';
          ctx.font = '12px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`Region ${Math.round(selRect.w)}×${Math.round(selRect.h)}`, selRect.w / 2, selRect.h / 2);
          setCaptured({ base64: canvas.toDataURL('image/png'), rect: selRect });
        };
        img.src = url;
      } else {
        ctx.fillStyle = '#1e2127';
        ctx.fillRect(0, 0, selRect.w, selRect.h);
        ctx.fillStyle = '#6e7681';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`Region ${Math.round(selRect.w)}×${Math.round(selRect.h)}`, selRect.w / 2, selRect.h / 2);
        setCaptured({ base64: canvas.toDataURL('image/png'), rect: selRect });
      }
    } catch {
      setStart(null);
      setEnd(null);
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
    if (!captured) return;
    iteratePreview(comment || 'See screenshot', captured.base64);
    toggleScreenshotMode();
  }

  const selBox = start && end ? {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  } : null;

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

      {/* Capture popover */}
      {captured && (
        <div
          className="absolute z-40 w-72 bg-surface-2 border border-border rounded-lg shadow-2xl animate-chat-fade-in"
          style={{
            left: Math.min(captured.rect.x, overlayRef.current?.clientWidth - 300 || 0),
            top: captured.rect.y + captured.rect.h + 8,
          }}
        >
          <div className="p-3 border-b border-border-subtle">
            <img
              src={captured.base64}
              alt="Screenshot"
              className="w-full h-auto rounded border border-border-subtle max-h-32 object-contain bg-surface-0"
            />
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
              className="w-8 h-8 flex items-center justify-center rounded-md bg-accent/15 text-accent hover:bg-accent/25 transition-colors cursor-pointer"
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
