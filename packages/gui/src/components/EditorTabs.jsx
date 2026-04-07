// GROOVE GUI — Editor Tabs
// FSL-1.1-Apache-2.0 — see LICENSE

import React from 'react';
import { useGrooveStore } from '../stores/groove';

export default function EditorTabs() {
  const tabs = useGrooveStore((s) => s.editorOpenTabs);
  const activeFile = useGrooveStore((s) => s.editorActiveFile);
  const files = useGrooveStore((s) => s.editorFiles);
  const setActiveFile = useGrooveStore((s) => s.setActiveFile);
  const closeFile = useGrooveStore((s) => s.closeFile);

  if (tabs.length === 0) return null;

  return (
    <div style={styles.container}>
      {tabs.map((path) => {
        const file = files[path];
        const isActive = path === activeFile;
        const isDirty = file && file.content !== file.originalContent;
        const filename = path.split('/').pop();

        return (
          <div
            key={path}
            onClick={() => setActiveFile(path)}
            title={path}
            style={{
              ...styles.tab,
              color: isActive ? 'var(--text-bright)' : 'var(--text-primary)',
              borderBottom: isActive ? '1px solid var(--accent)' : '1px solid transparent',
              background: isActive ? 'var(--bg-base)' : 'transparent',
            }}
          >
            {isDirty && <span style={styles.dirtyDot} />}
            <span style={styles.tabName}>{filename}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeFile(path); }}
              style={styles.closeBtn}
            >
              x
            </button>
          </div>
        );
      })}
    </div>
  );
}

const styles = {
  container: {
    display: 'flex', alignItems: 'center',
    height: 32, flexShrink: 0,
    background: 'var(--bg-chrome)',
    borderBottom: '1px solid var(--border)',
    overflowX: 'auto', overflowY: 'hidden',
  },
  tab: {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '0 12px', height: '100%',
    cursor: 'pointer', whiteSpace: 'nowrap',
    fontSize: 11, fontFamily: 'var(--font)',
    transition: 'background 0.08s',
    borderRight: '1px solid rgba(75, 82, 99, 0.4)',
    flexShrink: 0,
  },
  tabName: {
    overflow: 'hidden', textOverflow: 'ellipsis',
    maxWidth: 140,
  },
  dirtyDot: {
    width: 6, height: 6, borderRadius: '50%',
    background: 'var(--amber)', flexShrink: 0,
  },
  closeBtn: {
    background: 'none', border: 'none',
    color: 'var(--text-muted)', fontSize: 10,
    cursor: 'pointer', fontFamily: 'var(--font)',
    padding: '0 2px', lineHeight: 1,
    opacity: 0.6,
  },
};
