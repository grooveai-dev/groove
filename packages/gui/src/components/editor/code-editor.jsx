// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
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

const grooveHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#b07fd5' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: '#d4d8e0' },
  { tag: [t.function(t.variableName), t.labelName], color: '#dcc9a0' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#d4a07a' },
  { tag: [t.definition(t.name), t.separator], color: '#bcc2cd' },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: '#e0c589' },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.special(t.string)], color: '#89b4c4' },
  { tag: [t.meta, t.comment], color: '#6e7681', fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#7ab0df', textDecoration: 'underline' },
  { tag: t.heading, fontWeight: '400', color: '#bcc2cd' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#d4a07a' },
  { tag: [t.processingInstruction, t.string, t.inserted], color: '#95b2b8' },
  { tag: t.invalid, color: '#d4736e' },
  { tag: t.propertyName, color: '#dcc9a0' },
  { tag: [t.tagName], color: '#d4736e' },
  { tag: t.attributeName, color: '#e0c589' },
  { tag: t.attributeValue, color: '#95b2b8' },
]);

// Custom theme overrides to match our design tokens
const grooveTheme = EditorView.theme({
  '&': { backgroundColor: '#13161b', color: '#d4d8e0', fontFamily: 'var(--font-mono)', fontSize: '12px', height: '100%', lineHeight: '1.6' },
  '.cm-scroller': { overflow: 'auto', padding: '4px 0' },
  '.cm-content': { caretColor: '#33afbc', fontWeight: '400' },
  '.cm-cursor': { borderLeftColor: '#33afbc', borderLeftWidth: '1.5px' },
  '.cm-gutters': { backgroundColor: '#13161b', borderRight: '1px solid #1e2229', color: '#404852', minWidth: '40px' },
  '.cm-activeLineGutter': { backgroundColor: '#1a1e25' },
  '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.03)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(51, 175, 188, 0.15)' },
  '.cm-line': { fontWeight: '400' },
  // Markdown heading overrides — prevent bold/large rendering
  '.cm-header-1, .cm-header-2, .cm-header-3, .cm-header-4, .cm-header-5, .cm-header-6': { fontWeight: '400', fontSize: '12px' },
  '.ͼ1 .cm-line .tok-heading': { fontWeight: '400', fontSize: '12px' },
  '.tok-heading': { fontWeight: '400' },
  '.tok-heading1, .tok-heading2, .tok-heading3': { fontWeight: '400', fontSize: '12px' },
  // Search panel styling
  '.cm-panels': { backgroundColor: '#13161b', borderBottom: '1px solid #1e2229' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid #1e2229' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid #1e2229' },
  '.cm-search': { padding: '6px 8px', gap: '4px', fontFamily: 'var(--font-sans)', fontSize: '11px', display: 'flex', flexWrap: 'wrap', alignItems: 'center' },
  '.cm-search label': { display: 'flex', alignItems: 'center', gap: '4px', color: '#6e7681', fontSize: '10px' },
  '.cm-search input, .cm-search .cm-textfield': {
    backgroundColor: '#1a1e25', border: '1px solid #2c313a', borderRadius: '4px', color: '#d4d8e0',
    padding: '2px 6px', fontSize: '11px', fontFamily: 'var(--font-mono)', outline: 'none',
  },
  '.cm-search input:focus, .cm-search .cm-textfield:focus': { borderColor: '#33afbc' },
  '.cm-search .cm-button, .cm-button': {
    backgroundColor: '#1e2229', border: '1px solid #2c313a', borderRadius: '4px', color: '#a0a8b4',
    padding: '2px 8px', fontSize: '10px', fontFamily: 'var(--font-sans)', cursor: 'pointer',
    backgroundImage: 'none',
  },
  '.cm-search .cm-button:hover, .cm-button:hover': { backgroundColor: '#2c313a', color: '#d4d8e0' },
  '.cm-search .cm-button:active': { backgroundColor: '#333842' },
  '.cm-search br': { display: 'none' },
  '.cm-panel.cm-search [name=close]': { color: '#505862', cursor: 'pointer', padding: '0 4px' },
  '.cm-panel.cm-search [name=close]:hover': { color: '#d4d8e0' },
  '.cm-searchMatch': { backgroundColor: 'rgba(51, 175, 188, 0.15)', outline: '1px solid rgba(51, 175, 188, 0.3)' },
  '.cm-searchMatch-selected': { backgroundColor: 'rgba(51, 175, 188, 0.3)' },
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
        syntaxHighlighting(grooveHighlightStyle),
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

  return <div ref={containerRef} className="w-full h-full overflow-hidden bg-surface-0" />;
}
