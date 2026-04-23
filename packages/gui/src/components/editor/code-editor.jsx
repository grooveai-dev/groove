// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion } from '@codemirror/autocomplete';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';

const LANGS = {
  javascript: () => javascript({ jsx: true, typescript: false }),
  typescript: () => javascript({ jsx: true, typescript: true }),
  css: () => css(),
  html: () => html(),
  json: () => json(),
  markdown: () => markdown(),
  python: () => python(),
};

// Custom theme overrides to match our design tokens
const grooveTheme = EditorView.theme({
  '&': { backgroundColor: '#1a1e25', color: '#bcc2cd', fontFamily: 'var(--font-mono)', fontSize: '13px', height: '100%' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-content': { caretColor: '#33afbc' },
  '.cm-cursor': { borderLeftColor: '#33afbc' },
  '.cm-gutters': { backgroundColor: '#1a1e25', borderRight: '1px solid #22272e', color: '#505862' },
  '.cm-activeLineGutter': { backgroundColor: '#22272e' },
  '.cm-activeLine': { backgroundColor: 'rgba(34, 39, 46, 0.5)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(51, 175, 188, 0.15)' },
  // Search panel styling
  '.cm-panels': { backgroundColor: '#1a1e25', borderBottom: '1px solid #3e4451' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid #3e4451' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid #3e4451' },
  '.cm-search': { padding: '6px 8px', gap: '4px', fontFamily: 'var(--font-sans)', fontSize: '12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center' },
  '.cm-search label': { display: 'flex', alignItems: 'center', gap: '4px', color: '#8b929e', fontSize: '11px' },
  '.cm-search input, .cm-search .cm-textfield': {
    backgroundColor: '#1a1e25', border: '1px solid #2c313a', borderRadius: '4px', color: '#e6e6e6',
    padding: '2px 6px', fontSize: '12px', fontFamily: 'var(--font-mono)', outline: 'none',
  },
  '.cm-search input:focus, .cm-search .cm-textfield:focus': { borderColor: '#33afbc' },
  '.cm-search .cm-button, .cm-button': {
    backgroundColor: '#2c313a', border: '1px solid #3e4451', borderRadius: '4px', color: '#bcc2cd',
    padding: '2px 8px', fontSize: '11px', fontFamily: 'var(--font-sans)', cursor: 'pointer',
    backgroundImage: 'none',
  },
  '.cm-search .cm-button:hover, .cm-button:hover': { backgroundColor: '#333842', color: '#e6e6e6' },
  '.cm-search .cm-button:active': { backgroundColor: '#3a3f4b' },
  '.cm-search br': { display: 'none' },
  '.cm-panel.cm-search [name=close]': { color: '#6e7681', cursor: 'pointer', padding: '0 4px' },
  '.cm-panel.cm-search [name=close]:hover': { color: '#e6e6e6' },
  '.cm-searchMatch': { backgroundColor: 'rgba(51, 175, 188, 0.2)', outline: '1px solid rgba(51, 175, 188, 0.4)' },
  '.cm-searchMatch-selected': { backgroundColor: 'rgba(51, 175, 188, 0.35)' },
}, { dark: true });

export function CodeEditor({ content, language, onChange, onSave, onCursorChange, viewRef: externalViewRef }) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const langCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCursorChangeRef = useRef(onCursorChange);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onCursorChangeRef.current = onCursorChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const langExt = LANGS[language] || LANGS.javascript;

    const saveKeymap = keymap.of([{
      key: 'Mod-s',
      run: () => { onSaveRef.current?.(); return true; },
    }]);

    const state = EditorState.create({
      doc: content || '',
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        bracketMatching(),
        highlightSelectionMatches(),
        history(),
        autocompletion(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        saveKeymap,
        oneDark,
        grooveTheme,
        langCompartment.current.of(langExt()),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current?.(update.state.doc.toString());
          }
          if (update.selectionSet || update.docChanged) {
            const pos = update.state.selection.main.head;
            const line = update.state.doc.lineAt(pos);
            onCursorChangeRef.current?.({ line: line.number, col: pos - line.from + 1 });
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    if (externalViewRef) externalViewRef.current = view;

    return () => { view.destroy(); viewRef.current = null; if (externalViewRef) externalViewRef.current = null; };
  }, []); // mount once

  // Update content when file changes externally
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (content !== current) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content || '' },
      });
    }
  }, [content]);

  // Update language
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const langExt = LANGS[language] || LANGS.javascript;
    view.dispatch({ effects: langCompartment.current.reconfigure(langExt()) });
  }, [language]);

  return <div ref={containerRef} className="w-full h-full overflow-hidden" />;
}
