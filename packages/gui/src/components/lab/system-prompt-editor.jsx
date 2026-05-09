// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect, useState, useCallback } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { markdown } from '@codemirror/lang-markdown';

const editorTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--color-surface-1)', color: '#d4d8e0', fontFamily: 'var(--font-mono)', fontSize: '11px', height: '100%', lineHeight: '1.6' },
  '.cm-scroller': { overflow: 'auto', padding: '4px 0' },
  '.cm-content': { caretColor: '#33afbc', padding: '0 8px' },
  '.cm-cursor': { borderLeftColor: '#33afbc', borderLeftWidth: '1.5px' },
  '.cm-gutters': { backgroundColor: 'var(--color-surface-1)', borderRight: 'none', color: '#404852', minWidth: '28px' },
  '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.02)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(51, 175, 188, 0.15)' },
});

const promptHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#b07fd5' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: '#d4d8e0' },
  { tag: [t.function(t.variableName), t.labelName], color: '#dcc9a0' },
  { tag: [t.meta, t.comment], color: '#6e7681', fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: '#7ab0df', textDecoration: 'underline' },
  { tag: t.heading, fontWeight: '400', color: '#bcc2cd' },
  { tag: [t.processingInstruction, t.string, t.inserted], color: '#95b2b8' },
  { tag: [t.atom, t.bool], color: '#d4a07a' },
  { tag: t.invalid, color: '#d4736e' },
]);

export function SystemPromptEditor() {
  const systemPrompt = useGrooveStore((s) => s.labSystemPrompt);
  const setSystemPrompt = useGrooveStore((s) => s.setLabSystemPrompt);
  const [collapsed, setCollapsed] = useState(false);
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const externalUpdate = useRef(false);

  const charCount = systemPrompt.length;

  const handleChange = useCallback((text) => {
    if (!externalUpdate.current) setSystemPrompt(text);
  }, [setSystemPrompt]);

  useEffect(() => {
    if (!containerRef.current) return;

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
        syntaxHighlighting(promptHighlightStyle),
        markdown(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        editorTheme,
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
