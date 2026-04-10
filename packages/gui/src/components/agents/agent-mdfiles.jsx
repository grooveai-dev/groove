// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { FileText, Save, X, RefreshCw, ChevronLeft } from 'lucide-react';

export function AgentMdFiles({ agent }) {
  const addToast = useGrooveStore((s) => s.addToast);
  const [files, setFiles] = useState([]);
  const [workingDir, setWorkingDir] = useState('');
  const [activeFile, setActiveFile] = useState(null);
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [saving, setSaving] = useState(false);

  async function fetchFiles() {
    try {
      const data = await api.get(`/agents/${agent.id}/mdfiles`);
      setFiles(data.files || []);
      setWorkingDir(data.workingDir || '');
    } catch { /* ignore */ }
  }

  useEffect(() => { fetchFiles(); }, [agent.id]);

  async function openFile(path) {
    try {
      const data = await api.get(`/agents/${agent.id}/mdfiles/read?path=${encodeURIComponent(path)}`);
      setContent(data.content || '');
      setOriginal(data.content || '');
      setActiveFile(path);
    } catch (err) {
      addToast('error', 'Failed to read file', err.message);
    }
  }

  async function saveFile() {
    if (!activeFile) return;
    setSaving(true);
    try {
      await api.put(`/agents/${agent.id}/mdfiles/write`, { path: activeFile, content });
      setOriginal(content);
      addToast('success', `Saved ${activeFile}`);
    } catch (err) {
      addToast('error', 'Save failed', err.message);
    }
    setSaving(false);
  }

  const isDirty = content !== original;

  // File list view
  if (!activeFile) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border-subtle">
          <FileText size={12} className="text-text-3" />
          <span className="text-2xs font-semibold text-text-2 font-sans uppercase tracking-wider flex-1">Markdown Files</span>
          <button onClick={fetchFiles} className="p-1 text-text-4 hover:text-text-1 cursor-pointer">
            <RefreshCw size={11} />
          </button>
        </div>

        {workingDir && (
          <div className="px-4 py-1.5 text-[10px] text-text-4 font-mono truncate border-b border-border-subtle/50">
            {workingDir}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {files.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <FileText size={20} className="text-text-4 mb-2" />
              <p className="text-xs text-text-3 font-sans">No markdown files found</p>
              <p className="text-[10px] text-text-4 font-sans mt-1">MD files in the agent's working directory will appear here</p>
            </div>
          ) : (
            <div className="py-1">
              {files.map((f) => (
                <button
                  key={f.path}
                  onClick={() => openFile(f.path)}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-surface-5 transition-colors cursor-pointer"
                >
                  <FileText size={13} className="text-accent flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-text-0 font-sans block truncate">{f.name}</span>
                    <span className="text-[10px] text-text-4 font-mono">{f.path}</span>
                  </div>
                  <span className="text-[10px] text-text-4 font-mono flex-shrink-0">
                    {f.size > 1024 ? `${(f.size / 1024).toFixed(1)}K` : `${f.size}B`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Editor view
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
        <button
          onClick={() => { setActiveFile(null); setContent(''); setOriginal(''); }}
          className="p-1 text-text-3 hover:text-text-0 cursor-pointer"
        >
          <ChevronLeft size={14} />
        </button>
        <FileText size={12} className="text-accent" />
        <span className="text-xs text-text-0 font-sans font-medium flex-1 truncate">{activeFile}</span>
        {isDirty && <span className="text-[10px] text-warning font-sans">unsaved</span>}
        <button
          onClick={saveFile}
          disabled={!isDirty || saving}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1 rounded text-2xs font-sans font-medium cursor-pointer transition-colors',
            isDirty
              ? 'bg-accent/15 text-accent hover:bg-accent/25'
              : 'text-text-4 opacity-50 cursor-not-allowed',
          )}
        >
          <Save size={10} />
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="flex-1 w-full px-4 py-3 bg-surface-0 text-[12px] font-mono text-text-1 leading-relaxed resize-none focus:outline-none"
        spellCheck={false}
      />
    </div>
  );
}
