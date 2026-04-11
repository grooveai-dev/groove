// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';
import { FileTree } from '../components/editor/file-tree';
import { EditorTabs } from '../components/editor/editor-tabs';
import { CodeEditor } from '../components/editor/code-editor';
import { MediaViewer, isMediaFile } from '../components/editor/media-viewer';
import { Code2, AlertTriangle, RefreshCw, X, Eye, FileCode } from 'lucide-react';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { cn } from '../lib/cn';

function isHtmlFile(path) {
  const ext = path?.split('.').pop()?.toLowerCase();
  return ext === 'html' || ext === 'htm';
}

export default function EditorView() {
  const activeFile = useGrooveStore((s) => s.editorActiveFile);
  const files = useGrooveStore((s) => s.editorFiles);
  const changedFiles = useGrooveStore((s) => s.editorChangedFiles);
  const updateFileContent = useGrooveStore((s) => s.updateFileContent);
  const saveFile = useGrooveStore((s) => s.saveFile);
  const reloadFile = useGrooveStore((s) => s.reloadFile);
  const dismissFileChange = useGrooveStore((s) => s.dismissFileChange);

  const [rootDir, setRootDir] = useState('');
  const [previewMode, setPreviewMode] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  // Fetch root dir
  useEffect(() => {
    api.get('/files/root').then((d) => setRootDir(d.root || '')).catch(() => {});
  }, []);

  // Reset preview mode when switching files
  useEffect(() => { setPreviewMode(false); }, [activeFile]);

  const file = activeFile ? files[activeFile] : null;
  const isMedia = activeFile && isMediaFile(activeFile);
  const isHtml = activeFile && isHtmlFile(activeFile);
  const hasExternalChange = activeFile && changedFiles[activeFile];

  return (
    <div className="flex h-full">
      {/* File tree sidebar */}
      <div className="w-60 flex-shrink-0 border-r border-border">
        <FileTree rootDir={rootDir} />
      </div>

      {/* Editor area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tab bar */}
        <EditorTabs />

        {/* Content */}
        <div className="flex-1 relative min-h-0">
          {/* External change banner */}
          {hasExternalChange && (
            <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 px-4 py-2 bg-warning/10 border-b border-warning/20">
              <AlertTriangle size={14} className="text-warning" />
              <span className="text-xs text-warning font-sans flex-1">File modified externally</span>
              <Button variant="ghost" size="sm" onClick={() => reloadFile(activeFile)}>
                <RefreshCw size={12} /> Reload
              </Button>
              <Button variant="ghost" size="sm" onClick={() => dismissFileChange(activeFile)}>
                <X size={12} /> Dismiss
              </Button>
            </div>
          )}

          {/* Editor / Media / Empty */}
          {!activeFile && (
            <div className="w-full h-full flex items-center justify-center text-text-4 font-sans">
              <div className="text-center space-y-2">
                <Code2 size={32} className="mx-auto" />
                <p className="text-sm">Open a file from the tree</p>
              </div>
            </div>
          )}

          {activeFile && isMedia && <MediaViewer path={activeFile} />}

          {activeFile && !isMedia && isHtml && (
            <>
              {/* Code / Preview toggle for HTML files */}
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
                  <CodeEditor
                    content={file.content}
                    language={file.language}
                    onChange={(content) => updateFileContent(activeFile, content)}
                    onSave={() => saveFile(activeFile)}
                  />
                )
              )}
            </>
          )}

          {activeFile && !isMedia && !isHtml && file && (
            <CodeEditor
              content={file.content}
              language={file.language}
              onChange={(content) => updateFileContent(activeFile, content)}
              onSave={() => saveFile(activeFile)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
