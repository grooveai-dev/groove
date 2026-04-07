// GROOVE GUI — Media Viewer (images + video)
// FSL-1.1-Apache-2.0 — see LICENSE

import React from 'react';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogv']);

export function isMediaFile(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext);
}

export function isImageFile(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  return IMAGE_EXTS.has(ext);
}

export default function MediaViewer({ path }) {
  const ext = path.split('.').pop()?.toLowerCase();
  const rawUrl = `/api/files/raw?path=${encodeURIComponent(path)}`;
  const filename = path.split('/').pop();
  const isImage = IMAGE_EXTS.has(ext);
  const isVideo = VIDEO_EXTS.has(ext);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.filename}>{filename}</span>
        <span style={styles.badge}>{ext.toUpperCase()}</span>
      </div>

      <div style={styles.preview}>
        {isImage && (
          <img
            src={rawUrl}
            alt={filename}
            style={styles.image}
            draggable={false}
          />
        )}
        {isVideo && (
          <video
            src={rawUrl}
            controls
            style={styles.video}
          >
            Your browser does not support this video format.
          </video>
        )}
      </div>

      <div style={styles.footer}>
        <a href={rawUrl} target="_blank" rel="noopener noreferrer" style={styles.link}>
          Open in new tab
        </a>
      </div>
    </div>
  );
}

const styles = {
  container: {
    flex: 1, display: 'flex', flexDirection: 'column',
    background: 'var(--bg-base)', overflow: 'hidden',
  },
  header: {
    padding: '10px 16px',
    borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', gap: 8,
  },
  filename: {
    fontSize: 12, color: 'var(--text-bright)', fontWeight: 500,
  },
  badge: {
    fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
    color: 'var(--text-dim)', background: 'var(--bg-active)',
    padding: '2px 6px', borderRadius: 3,
  },
  preview: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'auto', padding: 24,
    background: 'repeating-conic-gradient(var(--bg-surface) 0% 25%, var(--bg-base) 0% 50%) 50% / 20px 20px',
  },
  image: {
    maxWidth: '100%', maxHeight: '100%',
    objectFit: 'contain', borderRadius: 4,
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  },
  video: {
    maxWidth: '100%', maxHeight: '100%',
    borderRadius: 4, outline: 'none',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  },
  footer: {
    padding: '8px 16px',
    borderTop: '1px solid var(--border)',
    display: 'flex', alignItems: 'center',
  },
  link: {
    fontSize: 11, color: 'var(--accent)',
    textDecoration: 'none', fontFamily: 'var(--font)',
  },
};
