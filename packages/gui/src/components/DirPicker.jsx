// GROOVE GUI — Directory Picker
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect } from 'react';

export default function DirPicker({ onSelect, onClose, initial }) {
  const [currentPath, setCurrentPath] = useState(initial || '');
  const [dirs, setDirs] = useState([]);
  const [parent, setParent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    browse(currentPath);
  }, [currentPath]);

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
    } catch {
      setError('Failed to connect');
    } finally {
      setLoading(false);
    }
  }

  const breadcrumbs = currentPath
    ? ['root', ...currentPath.split('/')]
    : ['root'];

  function handleBreadcrumbClick(index) {
    if (index === 0) {
      setCurrentPath('');
    } else {
      const parts = currentPath.split('/');
      setCurrentPath(parts.slice(0, index).join('/'));
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>SELECT DIRECTORY</span>
          <button onClick={onClose} style={styles.closeBtn}>x</button>
        </div>

        {/* Breadcrumb */}
        <div style={styles.breadcrumb}>
          {breadcrumbs.map((part, i) => (
            <span key={i}>
              {i > 0 && <span style={styles.breadSep}>/</span>}
              <button
                onClick={() => handleBreadcrumbClick(i)}
                style={{
                  ...styles.breadPart,
                  color: i === breadcrumbs.length - 1 ? 'var(--text-bright)' : 'var(--text-dim)',
                }}
              >
                {part}
              </button>
            </span>
          ))}
        </div>

        {/* Directory list */}
        <div style={styles.list}>
          {parent !== null && (
            <button
              onClick={() => setCurrentPath(parent)}
              style={styles.dirRow}
            >
              <span style={styles.dirIcon}>..</span>
              <span style={styles.dirName}>parent directory</span>
            </button>
          )}

          {loading && <div style={styles.empty}>loading...</div>}
          {error && <div style={styles.errorText}>{error}</div>}

          {!loading && !error && dirs.length === 0 && (
            <div style={styles.empty}>no subdirectories</div>
          )}

          {dirs.map((dir) => (
            <button
              key={dir.path}
              onClick={() => setCurrentPath(dir.path)}
              style={styles.dirRow}
            >
              <span style={styles.dirIcon}>{dir.hasChildren ? '+' : ' '}</span>
              <span style={styles.dirName}>{dir.name}</span>
            </button>
          ))}
        </div>

        {/* Footer — select current */}
        <div style={styles.footer}>
          <div style={styles.selectedPath}>
            {currentPath || '(project root)'}
          </div>
          <button
            onClick={() => { onSelect(currentPath); onClose(); }}
            style={styles.selectBtn}
          >
            Select
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 200,
    background: 'rgba(0, 0, 0, 0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    width: 360, maxHeight: '70vh',
    background: 'var(--bg-chrome)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    display: 'flex', flexDirection: 'column',
    fontFamily: 'var(--font)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 12px',
    borderBottom: '1px solid var(--border)',
  },
  title: {
    fontSize: 11, fontWeight: 600, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1.5,
  },
  closeBtn: {
    background: 'none', border: 'none', color: 'var(--text-dim)',
    fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font)',
    padding: '0 4px',
  },
  breadcrumb: {
    padding: '8px 12px',
    borderBottom: '1px solid var(--border)',
    fontSize: 11,
  },
  breadSep: {
    color: 'var(--text-muted)', margin: '0 2px',
  },
  breadPart: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontFamily: 'var(--font)', fontSize: 11,
    padding: 0,
  },
  list: {
    flex: 1, overflowY: 'auto',
    padding: '4px 0',
    minHeight: 120, maxHeight: 300,
  },
  dirRow: {
    display: 'flex', alignItems: 'center', gap: 6,
    width: '100%', padding: '6px 12px',
    background: 'none', border: 'none',
    color: 'var(--text-primary)', fontSize: 12,
    fontFamily: 'var(--font)', cursor: 'pointer',
    textAlign: 'left',
  },
  dirIcon: {
    color: 'var(--accent)', fontSize: 11, width: 12, textAlign: 'center',
    flexShrink: 0,
  },
  dirName: {
    flex: 1,
  },
  empty: {
    padding: '16px 12px', color: 'var(--text-dim)', fontSize: 11,
    textAlign: 'center',
  },
  errorText: {
    padding: '16px 12px', color: 'var(--red)', fontSize: 11,
    textAlign: 'center',
  },
  footer: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 12px',
    borderTop: '1px solid var(--border)',
  },
  selectedPath: {
    flex: 1, fontSize: 11, color: 'var(--text-dim)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  selectBtn: {
    padding: '5px 14px',
    background: 'transparent', border: '1px solid var(--accent)',
    borderRadius: 2, color: 'var(--accent)', fontSize: 11, fontWeight: 600,
    fontFamily: 'var(--font)', cursor: 'pointer', flexShrink: 0,
  },
};
