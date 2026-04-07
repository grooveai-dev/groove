// GROOVE GUI — File Editor View
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useCallback } from 'react';
import { useGrooveStore } from '../stores/groove';
import FileTree from '../components/FileTree';
import EditorTabs from '../components/EditorTabs';
import CodeEditor from '../components/CodeEditor';
import MediaViewer, { isMediaFile } from '../components/MediaViewer';
import Terminal from '../components/Terminal';

export default function FileEditor() {
  const activeFile = useGrooveStore((s) => s.editorActiveFile);
  const files = useGrooveStore((s) => s.editorFiles);
  const changedFiles = useGrooveStore((s) => s.editorChangedFiles);
  const openTabs = useGrooveStore((s) => s.editorOpenTabs);
  const updateFileContent = useGrooveStore((s) => s.updateFileContent);
  const saveFile = useGrooveStore((s) => s.saveFile);
  const reloadFile = useGrooveStore((s) => s.reloadFile);
  const dismissFileChange = useGrooveStore((s) => s.dismissFileChange);

  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(220);

  const file = activeFile ? files[activeFile] : null;
  const isChanged = activeFile && changedFiles[activeFile];
  const isMedia = activeFile && isMediaFile(activeFile);
  const isMediaTab = activeFile && openTabs.includes(activeFile) && isMedia;

  const onContentChange = useCallback((content) => {
    if (activeFile) updateFileContent(activeFile, content);
  }, [activeFile, updateFileContent]);

  const onSave = useCallback(() => {
    if (activeFile) saveFile(activeFile);
  }, [activeFile, saveFile]);

  // Drag-to-resize terminal
  const onResizeStart = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = terminalHeight;
    const onMove = (ev) => {
      const delta = startY - ev.clientY;
      setTerminalHeight(Math.max(100, Math.min(600, startH + delta)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [terminalHeight]);

  return (
    <div style={styles.container}>
      {/* Tab bar */}
      <EditorTabs />

      {/* Main content row */}
      <div style={styles.contentRow}>
        {/* File tree sidebar */}
        <div style={styles.sidebar}>
          <FileTree />
        </div>

        {/* Editor + terminal column */}
        <div style={styles.editorColumn}>
          {/* Editor area */}
          <div style={styles.editorArea}>
            {/* External change banner */}
            {isChanged && !isMedia && (
              <div style={styles.changeBanner}>
                <span style={styles.bannerText}>File modified externally</span>
                <button onClick={() => reloadFile(activeFile)} style={styles.bannerBtn}>Reload</button>
                <button onClick={() => dismissFileChange(activeFile)} style={styles.bannerDismiss}>Dismiss</button>
              </div>
            )}

            {/* Media viewer / Code editor / Empty state */}
            {isMediaTab ? (
              <MediaViewer path={activeFile} />
            ) : file ? (
              <CodeEditor
                key={activeFile}
                content={file.content}
                language={file.language}
                onContentChange={onContentChange}
                onSave={onSave}
              />
            ) : (
              <div style={styles.emptyState}>
                <div style={styles.emptyIcon}>{'\u2190'}</div>
                <div style={styles.emptyText}>Select a file from the tree</div>
                <div style={styles.emptyHint}>Cmd+S to save  |  right-click for options</div>
              </div>
            )}
          </div>

          {/* Terminal pane */}
          {terminalOpen && (
            <>
              <div style={styles.resizeHandle} onMouseDown={onResizeStart} />
              <div style={{ ...styles.terminalPane, height: terminalHeight }}>
                <Terminal visible={terminalOpen} />
              </div>
            </>
          )}

          {/* Terminal toggle bar */}
          <div style={styles.terminalBar}>
            <button
              onClick={() => setTerminalOpen(!terminalOpen)}
              style={{
                ...styles.terminalToggle,
                color: terminalOpen ? 'var(--accent)' : 'var(--text-dim)',
              }}
            >
              {terminalOpen ? '\u25BE' : '\u25B4'} Terminal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex', flexDirection: 'column',
    height: '100%', width: '100%',
  },
  contentRow: {
    flex: 1, display: 'flex', overflow: 'hidden',
  },
  sidebar: {
    width: 240, flexShrink: 0,
    borderRight: '1px solid var(--border)',
    overflow: 'hidden',
  },
  editorColumn: {
    flex: 1, display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },
  editorArea: {
    flex: 1, display: 'flex', flexDirection: 'column',
    position: 'relative', overflow: 'hidden',
    background: 'var(--bg-base)',
  },
  changeBanner: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 12px',
    background: 'rgba(229, 192, 123, 0.15)',
    borderBottom: '1px solid var(--amber)',
  },
  bannerText: {
    fontSize: 11, color: 'var(--amber)', fontWeight: 500,
    fontFamily: 'var(--font)', flex: 1,
  },
  bannerBtn: {
    padding: '3px 10px',
    background: 'var(--amber)', border: 'none',
    borderRadius: 2, color: 'var(--bg-base)',
    fontSize: 10, fontWeight: 700,
    fontFamily: 'var(--font)', cursor: 'pointer',
  },
  bannerDismiss: {
    padding: '3px 10px',
    background: 'transparent', border: '1px solid var(--amber)',
    borderRadius: 2, color: 'var(--amber)',
    fontSize: 10, fontWeight: 500,
    fontFamily: 'var(--font)', cursor: 'pointer',
  },
  emptyState: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    gap: 8,
  },
  emptyIcon: {
    fontSize: 28, color: 'var(--text-muted)', opacity: 0.5,
  },
  emptyText: {
    fontSize: 13, color: 'var(--text-dim)', fontWeight: 500,
  },
  emptyHint: {
    fontSize: 10, color: 'var(--text-muted)',
  },
  resizeHandle: {
    height: 4, cursor: 'row-resize',
    background: 'var(--border)',
    flexShrink: 0,
  },
  terminalPane: {
    flexShrink: 0, overflow: 'hidden',
  },
  terminalBar: {
    height: 24, flexShrink: 0,
    display: 'flex', alignItems: 'center',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg-chrome)',
    padding: '0 8px',
  },
  terminalToggle: {
    background: 'none', border: 'none',
    fontSize: 11, fontWeight: 600,
    fontFamily: 'var(--font)',
    cursor: 'pointer', padding: '2px 6px',
  },
};
