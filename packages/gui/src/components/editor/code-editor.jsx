// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion } from '@codemirror/autocomplete';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import {
  abyss, andromeda, atomone, aura,
  basicDark, bespin, copilot, darcula, dracula,
  duotoneDark, githubDark, gruvboxDark,
  kimbie, materialDark, monokai, monokaiDimmed,
  noctisLilac, nord, okaidia, solarizedDark,
  sublime, tokyoNight, tokyoNightStorm,
  tomorrowNightBlue, vscodeDark, xcodeDark,
  basicLight, bbedit, duotoneLight, eclipse,
  githubLight, gruvboxLight, materialLight,
  quietlight, solarizedLight, tokyoNightDay,
  vscodeLight, xcodeLight,
} from '@uiw/codemirror-themes-all';
import { useGrooveStore } from '../../stores/groove';

const LANGS = {
  javascript: () => javascript({ jsx: true, typescript: false }),
  typescript: () => javascript({ jsx: true, typescript: true }),
  css: () => css(),
  html: () => html(),
  json: () => json(),
  markdown: () => markdown(),
  python: () => python(),
};

export const EDITOR_THEMES = {
  vscodeDark:       { label: 'VS Code Dark',       ext: vscodeDark },
  githubDark:       { label: 'GitHub Dark',         ext: githubDark },
  dracula:          { label: 'Dracula',             ext: dracula },
  monokai:          { label: 'Monokai',             ext: monokai },
  monokaiDimmed:    { label: 'Monokai Dimmed',      ext: monokaiDimmed },
  nord:             { label: 'Nord',                ext: nord },
  tokyoNight:       { label: 'Tokyo Night',         ext: tokyoNight },
  tokyoNightStorm:  { label: 'Tokyo Night Storm',   ext: tokyoNightStorm },
  sublime:          { label: 'Sublime',             ext: sublime },
  atomone:          { label: 'Atom One',            ext: atomone },
  aura:             { label: 'Aura',                ext: aura },
  abyss:            { label: 'Abyss',               ext: abyss },
  andromeda:        { label: 'Andromeda',            ext: andromeda },
  copilot:          { label: 'Copilot',             ext: copilot },
  darcula:          { label: 'Darcula',             ext: darcula },
  materialDark:     { label: 'Material Dark',       ext: materialDark },
  gruvboxDark:      { label: 'Gruvbox Dark',        ext: gruvboxDark },
  solarizedDark:    { label: 'Solarized Dark',      ext: solarizedDark },
  duotoneDark:      { label: 'Duotone Dark',        ext: duotoneDark },
  bespin:           { label: 'Bespin',              ext: bespin },
  kimbie:           { label: 'Kimbie',              ext: kimbie },
  okaidia:          { label: 'Okaidia',             ext: okaidia },
  noctisLilac:      { label: 'Noctis Lilac',        ext: noctisLilac },
  tomorrowNightBlue:{ label: 'Tomorrow Night Blue', ext: tomorrowNightBlue },
  xcodeDark:        { label: 'Xcode Dark',          ext: xcodeDark },
  basicDark:        { label: 'Basic Dark',          ext: basicDark },
  githubLight:      { label: 'GitHub Light',        ext: githubLight },
  vscodeLight:      { label: 'VS Code Light',       ext: vscodeLight },
  eclipse:          { label: 'Eclipse',             ext: eclipse },
  xcodeLight:       { label: 'Xcode Light',         ext: xcodeLight },
  solarizedLight:   { label: 'Solarized Light',     ext: solarizedLight },
  gruvboxLight:     { label: 'Gruvbox Light',       ext: gruvboxLight },
  materialLight:    { label: 'Material Light',      ext: materialLight },
  duotoneLight:     { label: 'Duotone Light',       ext: duotoneLight },
  quietlight:       { label: 'Quiet Light',         ext: quietlight },
  bbedit:           { label: 'BBEdit',              ext: bbedit },
  tokyoNightDay:    { label: 'Tokyo Night Day',     ext: tokyoNightDay },
  basicLight:       { label: 'Basic Light',         ext: basicLight },
};

const editorChrome = EditorView.theme({
  '&': { fontFamily: 'var(--font-mono)', fontSize: '12px', height: '100%', lineHeight: '1.6' },
  '.cm-scroller': { overflow: 'auto', padding: '4px 0' },
  '.cm-line': { fontWeight: '400' },
  '.cm-header-1, .cm-header-2, .cm-header-3, .cm-header-4, .cm-header-5, .cm-header-6': { fontWeight: '400', fontSize: '12px' },
  '.tok-heading': { fontWeight: '400' },
  '.tok-heading1, .tok-heading2, .tok-heading3': { fontWeight: '400', fontSize: '12px' },
  '.cm-panels': { borderBottom: '1px solid var(--color-border)' },
  '.cm-search': { padding: '6px 8px', gap: '4px', fontFamily: 'var(--font-sans)', fontSize: '11px', display: 'flex', flexWrap: 'wrap', alignItems: 'center' },
  '.cm-search label': { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px' },
  '.cm-search input, .cm-search .cm-textfield': { borderRadius: '4px', padding: '2px 6px', fontSize: '11px', fontFamily: 'var(--font-mono)', outline: 'none' },
  '.cm-search .cm-button, .cm-button': { borderRadius: '4px', padding: '2px 8px', fontSize: '10px', fontFamily: 'var(--font-sans)', cursor: 'pointer', backgroundImage: 'none' },
  '.cm-search br': { display: 'none' },
  '.cm-panel.cm-search [name=close]': { cursor: 'pointer', padding: '0 4px' },
});

function getThemeExt(key) {
  return EDITOR_THEMES[key]?.ext || EDITOR_THEMES.vscodeDark.ext;
}

export function CodeEditor({ content, language, onChange, onSave, onCursorChange, viewRef: externalViewRef }) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const langCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCursorChangeRef = useRef(onCursorChange);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onCursorChangeRef.current = onCursorChange;

  const themeKey = useGrooveStore((s) => s.editorTheme);

  useEffect(() => {
    if (!containerRef.current) return;

    const langExt = LANGS[language] || LANGS.javascript;
    const initialTheme = getThemeExt(useGrooveStore.getState().editorTheme);

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
        themeCompartment.current.of(initialTheme),
        editorChrome,
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
    if (content !== current) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content || '' },
      });
    }
  }, [content]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const langExt = LANGS[language] || LANGS.javascript;
    view.dispatch({ effects: langCompartment.current.reconfigure(langExt()) });
  }, [language]);

  return <div ref={containerRef} className="w-full h-full overflow-hidden bg-surface-0" />;
}
