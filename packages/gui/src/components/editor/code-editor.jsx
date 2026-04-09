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
  '&': { backgroundColor: '#24282f', color: '#bcc2cd', fontFamily: 'var(--font-mono)', fontSize: '13px' },
  '.cm-content': { caretColor: '#33afbc' },
  '.cm-cursor': { borderLeftColor: '#33afbc' },
  '.cm-gutters': { backgroundColor: '#24282f', borderRight: '1px solid #2c313a', color: '#505862' },
  '.cm-activeLineGutter': { backgroundColor: '#2c313a' },
  '.cm-activeLine': { backgroundColor: 'rgba(44, 49, 58, 0.5)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(51, 175, 188, 0.15)' },
}, { dark: true });

export function CodeEditor({ content, language, onChange, onSave }) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const langCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

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
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => { view.destroy(); viewRef.current = null; };
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

  return <div ref={containerRef} className="w-full h-full" />;
}
