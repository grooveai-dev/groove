// GROOVE GUI — Directory Picker
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect, useRef } from 'react';

export default function DirPicker({ onSelect, onClose, initial }) {
  const [currentPath, setCurrentPath] = useState(initial || '');
  const [dirs, setDirs] = useState([]);
  const [parent, setParent] = useState(null);
  const [fileCount, setFileCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hovered, setHovered] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    browse(currentPath);
  }, [currentPath]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [dirs]);

  async function browse(path) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Failed to browse');
        setDirs([]);
        return;
      }
      const data = await res.json();
      setDirs(data.dirs);
      setParent(data.parent);
      setFileCount(data.fileCount || 0);
    } catch {
      setError('Failed to connect');
    } finally {
      setLoading(false);
    }
  }

  const breadcrumbs = currentPath
    ? [{ label: 'root', path: '' }, ...currentPath.split('/').map((part, i, arr) => ({
        label: part,
        path: arr.slice(0, i + 1).join('/'),
      }))]
    : [{ label: 'root', path: '' }];

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div style={styles.header}>
          <div>
            <div style={styles.title}>SELECT DIRECTORY</div>
            <div style={styles.subtitle}>Choose where this agent will work</div>
          </div>
          <button onClick={onClose} style={styles.closeBtn}>x</button>
        </div>

        {/* Breadcrumb */}
        <div style={styles.breadcrumb}>
          {breadcrumbs.map((crumb, i) => (
            <span key={i}>
              {i > 0 && <span style={styles.breadSep}>/</span>}
              <button
                onClick={() => setCurrentPath(crumb.path)}
                style={{
                  ...styles.breadPart,
                  color: i === breadcrumbs.length - 1 ? 'var(--text-bright)' : 'var(--accent)',
                }}
              >
                {crumb.label}
              </button>
            </span>
          ))}
          {!loading && (
            <span style={styles.breadMeta}>
              {dirs.length} folder{dirs.length !== 1 ? 's' : ''}, {fileCount} file{fileCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Directory list */}
        <div style={styles.list} ref={listRef}>
          {parent !== null && (
            <div
              onClick={() => setCurrentPath(parent)}
              onMouseEnter={() => setHovered('__parent')}
              onMouseLeave={() => setHovered(null)}
              style={{
                ...styles.dirRow,
                background: hovered === '__parent' ? 'var(--bg-hover)' : 'transparent',
              }}
            >
              <div style={styles.dirIconWrap}>
                <span style={styles.dirArrow}>{'<'}</span>
              </div>
              <div style={styles.dirInfo}>
                <div style={styles.dirNameText}>..</div>
              </div>
            </div>
          )}

          {loading && (
            <div style={styles.emptyState}>
              <div style={styles.emptyText}>Loading...</div>
            </div>
          )}

          {error && (
            <div style={styles.emptyState}>
              <div style={{ ...styles.emptyText, color: 'var(--red)' }}>{error}</div>
            </div>
          )}

          {!loading && !error && dirs.length === 0 && (
            <div style={styles.emptyState}>
              <div style={styles.emptyText}>No subdirectories</div>
              <div style={styles.emptyHint}>This directory has {fileCount} file{fileCount !== 1 ? 's' : ''}</div>
            </div>
          )}

          {dirs.map((dir) => (
            <div
              key={dir.path}
              onClick={() => setCurrentPath(dir.path)}
              onMouseEnter={() => setHovered(dir.path)}
              onMouseLeave={() => setHovered(null)}
              style={{
                ...styles.dirRow,
                background: hovered === dir.path ? 'var(--bg-hover)' : 'transparent',
              }}
            >
              <div style={styles.dirIconWrap}>
                <span style={styles.dirArrow}>{dir.hasChildren ? '>' : ''}</span>
              </div>
              <div style={styles.dirInfo}>
                <div style={styles.dirNameText}>{dir.name}</div>
                <div style={styles.dirMeta}>
                  {dir.childCount > 0 && `${dir.childCount} folder${dir.childCount !== 1 ? 's' : ''}`}
                  {dir.childCount > 0 && dir.fileCount > 0 && ', '}
                  {dir.fileCount > 0 && `${dir.fileCount} file${dir.fileCount !== 1 ? 's' : ''}`}
                  {dir.childCount === 0 && dir.fileCount === 0 && 'empty'}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <div style={styles.footerLeft}>
            <div style={styles.selectedLabel}>Selected</div>
            <div style={styles.selectedPath}>
              /{currentPath || '(project root)'}
            </div>
          </div>
          <div style={styles.footerActions}>
            <button onClick={onClose} style={styles.cancelBtn}>Cancel</button>
            <button
              onClick={() => { onSelect(currentPath); onClose(); }}
              style={styles.selectBtn}
            >
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 200,
    background: 'rgba(0, 0, 0, 0.65)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    backdropFilter: 'blur(2px)',
  },
  modal: {
    width: 480, maxHeight: '80vh',
    background: 'var(--bg-chrome)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    display: 'flex', flexDirection: 'column',
    fontFamily: 'var(--font)',
    boxShadow: '0 16px 48px rgba(0, 0, 0, 0.4)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '14px 16px 12px',
    borderBottom: '1px solid var(--border)',
  },
  title: {
    fontSize: 12, fontWeight: 700, color: 'var(--text-bright)',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 10, color: 'var(--text-dim)', marginTop: 2,
  },
  closeBtn: {
    background: 'none', border: 'none', color: 'var(--text-dim)',
    fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font)',
    padding: '0 4px', lineHeight: 1,
  },
  breadcrumb: {
    padding: '8px 16px',
    borderBottom: '1px solid var(--border)',
    fontSize: 11,
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0,
    background: 'var(--bg-base)',
  },
  breadSep: {
    color: 'var(--text-muted)', margin: '0 3px',
  },
  breadPart: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontFamily: 'var(--font)', fontSize: 11,
    padding: 0,
  },
  breadMeta: {
    marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)',
  },
  list: {
    flex: 1, overflowY: 'auto',
    minHeight: 200, maxHeight: 400,
  },
  dirRow: {
    display: 'flex', alignItems: 'center', gap: 0,
    padding: '8px 16px',
    cursor: 'pointer',
    transition: 'background 0.08s',
    borderBottom: '1px solid rgba(75, 82, 99, 0.2)',
  },
  dirIconWrap: {
    width: 28, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  dirArrow: {
    fontSize: 10, color: 'var(--text-muted)', fontWeight: 600,
  },
  dirInfo: {
    flex: 1, minWidth: 0,
  },
  dirNameText: {
    fontSize: 12, color: 'var(--text-bright)', fontWeight: 500,
  },
  dirMeta: {
    fontSize: 10, color: 'var(--text-muted)', marginTop: 1,
  },
  emptyState: {
    padding: '32px 16px', textAlign: 'center',
  },
  emptyText: {
    fontSize: 12, color: 'var(--text-dim)',
  },
  emptyHint: {
    fontSize: 10, color: 'var(--text-muted)', marginTop: 4,
  },
  footer: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg-base)',
  },
  footerLeft: {
    flex: 1, minWidth: 0, marginRight: 12,
  },
  selectedLabel: {
    fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase',
    letterSpacing: 1, fontWeight: 600,
  },
  selectedPath: {
    fontSize: 11, color: 'var(--accent)', marginTop: 2,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  footerActions: {
    display: 'flex', gap: 6, flexShrink: 0,
  },
  cancelBtn: {
    padding: '6px 14px',
    background: 'transparent', border: '1px solid var(--border)',
    borderRadius: 3, color: 'var(--text-dim)', fontSize: 11, fontWeight: 500,
    fontFamily: 'var(--font)', cursor: 'pointer',
  },
  selectBtn: {
    padding: '6px 18px',
    background: 'var(--accent)', border: '1px solid var(--accent)',
    borderRadius: 3, color: 'var(--bg-base)', fontSize: 11, fontWeight: 700,
    fontFamily: 'var(--font)', cursor: 'pointer',
  },
};
