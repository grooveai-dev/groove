// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef, useCallback } from 'react';
import { useGrooveStore } from '../stores/groove';
import { FileTree } from '../components/editor/file-tree';
import { EditorTabs } from '../components/editor/editor-tabs';
import { CodeEditor } from '../components/editor/code-editor';
import { MediaViewer, isMediaFile } from '../components/editor/media-viewer';
import { EditorStatusBar } from '../components/editor/editor-status-bar';
import { GotoLine } from '../components/editor/goto-line';
import { EditorToolbar } from '../components/editor/editor-toolbar';
import { AiPanel } from '../components/editor/ai-panel';
import { QuickSearch } from '../components/editor/quick-search';
import { SelectionMenu } from '../components/editor/selection-menu';
import { DiffViewer } from '../components/agents/diff-viewer';
import { CodeReview } from '../components/agents/code-review';
import { Code2, Eye, FileCode, PanelLeftOpen } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';

function isHtmlFile(path) {
  const ext = path?.split('.').pop()?.toLowerCase();
  return ext === 'html' || ext === 'htm';
}

const SIDEBAR_DEFAULT = 240;
const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 400;

export default function EditorView() {
  const activeFile = useGrooveStore((s) => s.editorActiveFile);
  const files = useGrooveStore((s) => s.editorFiles);
  const updateFileContent = useGrooveStore((s) => s.updateFileContent);
  const saveFile = useGrooveStore((s) => s.saveFile);
  const sidebarWidth = useGrooveStore((s) => s.editorSidebarWidth);
  const setSidebarWidth = useGrooveStore((s) => s.setEditorSidebarWidth);
  const viewMode = useGrooveStore((s) => s.editorViewMode);
  const aiPanelOpen = useGrooveStore((s) => s.editorAiPanelOpen);
  const aiPanelWidth = useGrooveStore((s) => s.editorAiPanelWidth);
  const setAiPanelWidth = useGrooveStore((s) => s.setEditorAiPanelWidth);
  const setQuickSearchOpen = useGrooveStore((s) => s.setEditorQuickSearchOpen);

  const projectDir = useGrooveStore((s) => s.projectDir);
  const [rootDir, setRootDir] = useState('');
  const [previewMode, setPreviewMode] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [showGotoLine, setShowGotoLine] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selection, setSelection] = useState(null);

  const editorViewRef = useRef(null);
  const editorContainerRef = useRef(null);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);
  const aiDragging = useRef(false);
  const aiStartX = useRef(0);
  const aiStartW = useRef(0);

  // Fetch root dir on mount and when project directory changes
  useEffect(() => {
    api.get('/files/root').then((d) => setRootDir(d.root || '')).catch(() => {});
  }, [projectDir]);

  // Reset preview mode when switching files
  useEffect(() => { setPreviewMode(false); }, [activeFile]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
        e.preventDefault();
        setShowGotoLine(true);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // AI panel resize handler
  const onAiPanelMouseDown = useCallback((e) => {
    e.preventDefault();
    aiDragging.current = true;
    aiStartX.current = e.clientX;
    aiStartW.current = aiPanelWidth;

    function onMouseMove(e) {
      if (!aiDragging.current) return;
      const delta = aiStartX.current - e.clientX;
      const newW = Math.min(Math.max(aiStartW.current + delta, 280), 600);
      setAiPanelWidth(newW);
    }

    function onMouseUp() {
      aiDragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [aiPanelWidth, setAiPanelWidth]);

  // Track text selection in the code editor
  const handleEditorMouseUp = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    if (sel.empty) { setSelection(null); return; }
    const text = view.state.sliceDoc(sel.from, sel.to);
    if (!text.trim()) { setSelection(null); return; }
    const fromLine = view.state.doc.lineAt(sel.from);
    const toLine = view.state.doc.lineAt(sel.to);
    const coords = view.coordsAtPos(sel.to);
    if (coords) {
      setSelection({
        x: Math.min(coords.left + 10, window.innerWidth - 220),
        y: coords.bottom + 4,
        lineStart: fromLine.number,
        lineEnd: toLine.number,
        selectedCode: text,
      });
    }
  }, []);

  // Sidebar resize handlers
  const onSidebarMouseDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = sidebarWidth;

    function onMouseMove(e) {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      const newW = Math.min(Math.max(startW.current + delta, SIDEBAR_MIN), SIDEBAR_MAX);
      setSidebarWidth(newW);
    }

    function onMouseUp() {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth, setSidebarWidth]);

  function handleGoto(line) {
    const view = editorViewRef.current;
    if (!view) return;
    const docLine = view.state.doc.line(Math.min(line, view.state.doc.lines));
    view.dispatch({
      selection: { anchor: docLine.from },
      scrollIntoView: true,
    });
    view.focus();
  }

  const file = activeFile ? files[activeFile] : null;
  const isMedia = activeFile && isMediaFile(activeFile);
  const isHtml = activeFile && isHtmlFile(activeFile);

  const renderCodeContent = () => {
    if (!activeFile) {
      return (
        <div className="w-full h-full flex items-center justify-center text-text-4 font-sans">
          <div className="text-center space-y-2">
            <Code2 size={32} className="mx-auto" />
            <p className="text-sm">Open a file from the tree</p>
          </div>
        </div>
      );
    }

    if (isMedia) return <MediaViewer path={activeFile} />;

    if (isHtml) {
      return (
        <>
          <div className="absolute top-0 right-4 z-10 flex items-center gap-0.5 mt-2 bg-surface-2 border border-border-subtle rounded-md p-0.5">
            <button
              onClick={() => setPreviewMode(false)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 text-xs font-sans rounded cursor-pointer transition-colors',
                !previewMode ? 'bg-surface-4 text-text-0 font-medium' : 'text-text-3 hover:text-text-1',
              )}
            >
              <FileCode size={12} /> Code
            </button>
            <button
              onClick={() => { setPreviewMode(true); setPreviewKey((k) => k + 1); }}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 text-xs font-sans rounded cursor-pointer transition-colors',
                previewMode ? 'bg-surface-4 text-text-0 font-medium' : 'text-text-3 hover:text-text-1',
              )}
            >
              <Eye size={12} /> Preview
            </button>
          </div>

          {previewMode ? (
            <iframe
              key={previewKey}
              src={`/api/files/raw?path=${encodeURIComponent(activeFile)}`}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin"
              title="HTML Preview"
            />
          ) : (
            file && (
              <div className="w-full h-full" onMouseUp={handleEditorMouseUp}>
                <CodeEditor
                  content={file.content}
                  language={file.language}
                  onChange={(content) => updateFileContent(activeFile, content)}
                  onSave={() => saveFile(activeFile)}
                  onCursorChange={setCursorPos}
                  viewRef={editorViewRef}
                />
              </div>
            )
          )}
        </>
      );
    }

    if (file) {
      return (
        <div className="w-full h-full" onMouseUp={handleEditorMouseUp}>
          <CodeEditor
            content={file.content}
            language={file.language}
            onChange={(content) => updateFileContent(activeFile, content)}
            onSave={() => saveFile(activeFile)}
            onCursorChange={setCursorPos}
            viewRef={editorViewRef}
          />
        </div>
      );
    }

    return null;
  };

  return (
    <div className="flex h-full">
      {/* File tree sidebar */}
      <div className={cn(
        'relative flex-shrink-0 border-r border-border transition-all duration-200 overflow-hidden',
        sidebarCollapsed && 'w-0 border-r-0',
      )} style={sidebarCollapsed ? undefined : { width: sidebarWidth }}>
        <FileTree rootDir={rootDir} onCollapse={() => setSidebarCollapsed(true)} />
        {/* Drag handle */}
        <div
          className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/30 transition-colors z-10"
          onMouseDown={onSidebarMouseDown}
          onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT)}
        />
      </div>

      {/* Sidebar expand rail */}
      {sidebarCollapsed && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          className="flex-shrink-0 w-6 flex items-start justify-center pt-2 border-r border-border bg-surface-2 text-text-4 hover:text-text-0 hover:bg-surface-3 transition-colors cursor-pointer"
          title="Show sidebar"
        >
          <PanelLeftOpen size={14} />
        </button>
      )}

      {/* Editor area */}
      <div className="flex-1 flex flex-col min-w-0 bg-surface-1">

        {/* Tab bar */}
        <EditorTabs />

        {/* Toolbar (replaces breadcrumbs) */}
        <EditorToolbar
          onCmdP={() => setQuickSearchOpen(true)}
          onCmdK={() => {}}
        />

        {/* Content */}
        <div className="flex-1 relative min-h-0" ref={editorContainerRef}>
          {/* Go to line dialog */}
          {showGotoLine && (
            <GotoLine
              currentLine={cursorPos.line}
              onGoto={handleGoto}
              onClose={() => setShowGotoLine(false)}
            />
          )}

          {/* View mode content */}
          {viewMode === 'code' && renderCodeContent()}
          {viewMode === 'diff' && activeFile && (
            <DiffViewer filePath={activeFile} />
          )}
          {viewMode === 'diff' && !activeFile && (
            <div className="w-full h-full flex items-center justify-center text-text-4 font-sans text-sm">
              Open a file to see diff
            </div>
          )}
          {viewMode === 'review' && <CodeReview />}

          {/* Selection menu */}
          {selection && viewMode === 'code' && (
            <SelectionMenu
              x={selection.x}
              y={selection.y}
              filePath={activeFile}
              lineStart={selection.lineStart}
              lineEnd={selection.lineEnd}
              selectedCode={selection.selectedCode}
              onClose={() => setSelection(null)}
            />
          )}
        </div>

        {/* Status bar */}
        {activeFile && !isMedia && viewMode === 'code' && (
          <EditorStatusBar cursorPos={cursorPos} language={file?.language} />
        )}
      </div>

      {/* AI Panel */}
      {aiPanelOpen && (
        <div className="relative flex-shrink-0" style={{ width: aiPanelWidth }}>
          {/* Resize handle */}
          <div
            className="absolute top-0 left-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/30 transition-colors z-10"
            onMouseDown={onAiPanelMouseDown}
          />
          <AiPanel />
        </div>
      )}

      {/* Quick Search modal */}
      <QuickSearch />
    </div>
  );
}
