// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect, useState, useCallback } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EDITOR_THEMES } from '../editor/code-editor';

const promptChrome = EditorView.theme({
  '&': { fontFamily: 'var(--font-mono)', fontSize: '11px', height: '100%', lineHeight: '1.6' },
  '.cm-scroller': { overflow: 'auto', padding: '4px 0' },
  '.cm-content': { padding: '0 8px' },
  '.cm-gutters': { borderRight: 'none', minWidth: '28px' },
  '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.02)' },
});

function getThemeExt(key) {
  return EDITOR_THEMES[key]?.ext || EDITOR_THEMES.vscodeDark.ext;
}

export function SystemPromptEditor() {
  const systemPrompt = useGrooveStore((s) => s.labSystemPrompt);
  const setSystemPrompt = useGrooveStore((s) => s.setLabSystemPrompt);
  const themeKey = useGrooveStore((s) => s.editorTheme);
  const [collapsed, setCollapsed] = useState(false);
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const themeCompartment = useRef(new Compartment());
  const externalUpdate = useRef(false);

  const charCount = systemPrompt.length;

  const handleChange = useCallback((text) => {
    if (!externalUpdate.current) setSystemPrompt(text);
  }, [setSystemPrompt]);

  useEffect(() => {
    if (!containerRef.current) return;

    const initialTheme = getThemeExt(useGrooveStore.getState().editorTheme);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        handleChange(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: systemPrompt,
      extensions: [
        lineNumbers(),
        history(),
        themeCompartment.current.of(initialTheme),
        promptChrome,
        markdown(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        updateListener,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => view.destroy();
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: themeCompartment.current.reconfigure(getThemeExt(themeKey)) });
  }, [themeKey]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== systemPrompt) {
      externalUpdate.current = true;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: systemPrompt },
      });
      externalUpdate.current = false;
    }
  }, [systemPrompt]);

  return (
    <div className="space-y-1.5">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 w-full cursor-pointer group"
      >
        {collapsed ? (
          <ChevronRight size={11} className="text-text-4 group-hover:text-text-2 transition-colors" />
        ) : (
          <ChevronDown size={11} className="text-text-4 group-hover:text-text-2 transition-colors" />
        )}
        <span className="text-2xs font-semibold font-sans text-text-3 uppercase tracking-wider group-hover:text-text-2 transition-colors">
          System Prompt
        </span>
        <span className="text-2xs font-mono text-text-4 ml-auto">{charCount > 0 ? `${charCount}` : ''}</span>
      </button>

      <div className={cn(
        'overflow-hidden transition-all duration-200',
        collapsed ? 'h-0' : 'h-36',
      )}>
        <div
          ref={containerRef}
          className="h-full border border-border-subtle rounded-sm overflow-hidden"
        />
      </div>
    </div>
  );
}
