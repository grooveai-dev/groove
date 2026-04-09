// FSL-1.1-Apache-2.0 — see LICENSE
import { Badge } from '../ui/badge';
import { ExternalLink } from 'lucide-react';

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'avif'];
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogv'];

export function isMediaFile(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  return IMAGE_EXTS.includes(ext) || VIDEO_EXTS.includes(ext);
}

export function MediaViewer({ path }) {
  const ext = path.split('.').pop()?.toLowerCase();
  const url = `/api/files/raw?path=${encodeURIComponent(path)}`;
  const name = path.split('/').pop();
  const isVideo = VIDEO_EXTS.includes(ext);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-surface-0 p-8 gap-4">
      <div className="flex items-center gap-2 text-xs text-text-3 font-sans">
        <Badge>{ext?.toUpperCase()}</Badge>
        <span className="font-mono">{name}</span>
        <a href={url} target="_blank" rel="noopener" className="text-accent hover:text-accent/80 transition-colors">
          <ExternalLink size={12} />
        </a>
      </div>

      {isVideo ? (
        <video
          src={url}
          controls
          className="max-w-full max-h-[70vh] rounded-md border border-border"
        />
      ) : (
        <img
          src={url}
          alt={name}
          className="max-w-full max-h-[70vh] rounded-md border border-border object-contain"
        />
      )}
    </div>
  );
}
