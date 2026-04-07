// GROOVE GUI — CodeMirror 6 Editor Wrapper
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useRef, useEffect, useCallback } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, indentOnInput, foldGutter, foldKeymap } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { oneDark } from '@codemirror/theme-one-dark';

import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';

const LANG_EXTENSIONS = {
  javascript: () => javascript({ jsx: true, typescript: false }),
  typescript: () => javascript({ jsx: true, typescript: true }),
  css: () => css(),
  html: () => html(),
  json: () => json(),
  markdown: () => markdown(),
  python: () => python(),
};

// Override One Dark bg to match GROOVE's --bg-base
const grooveTheme = EditorView.theme({
  '&': { background: '#24282f', fontSize: '12px', fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace" },
  '.cm-content': { caretColor: '#33afbc' },
  '.cm-cursor': { borderLeftColor: '#33afbc' },
  '.cm-gutters': { background: '#24282f', borderRight: '1px solid #4b5263', color: '#5c6370' },
  '.cm-activeLineGutter': { background: '#2c313a' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: 'rgba(51, 175, 188, 0.2) !important' },
  '.cm-activeLine': { background: 'rgba(44, 49, 58, 0.5)' },
}, { dark: true });

export default function CodeEditor({ content, language, onContentChange, onSave }) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const langCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onContentChange);
  const onSaveRef = useRef(onSave);

  // Keep callback refs current
  onChangeRef.current = onContentChange;
  onSaveRef.current = onSave;

  // Build language extension
  const getLangExtension = useCallback((lang) => {
    const factory = LANG_EXTENSIONS[lang];
    return factory ? factory() : [];
  }, []);

  // Create editor on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const saveKeymap = keymap.of([{
      key: 'Mod-s',
      run: () => { onSaveRef.current?.(); return true; },
    }]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current?.(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: content || '',
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        bracketMatching(),
        indentOnInput(),
        foldGutter(),
        history(),
        autocompletion(),
        highlightSelectionMatches(),
        langCompartment.current.of(getLangExtension(language)),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        saveKeymap,
        oneDark,
        grooveTheme,
        updateListener,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []); // Mount once — content updates handled via dispatch

  // Update content when file changes (file switch or external reload)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (content !== currentDoc) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content || '' },
      });
    }
  }, [content]);

  // Switch language
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: langCompartment.current.reconfigure(getLangExtension(language)),
    });
  }, [language, getLangExtension]);

  return (
    <div ref={containerRef} style={styles.container} />
  );
}

const styles = {
  container: {
    flex: 1, overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
  },
};
