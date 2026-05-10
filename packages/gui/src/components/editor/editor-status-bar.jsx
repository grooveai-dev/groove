// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect } from 'react';
import { Palette } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { EDITOR_THEMES } from './code-editor';
import { cn } from '../../lib/cn';

const LANG_LABELS = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  css: 'CSS',
  html: 'HTML',
  json: 'JSON',
  markdown: 'Markdown',
  python: 'Python',
};

const themeKeys = Object.keys(EDITOR_THEMES);
const darkThemes = themeKeys.filter((k) => !['githubLight', 'vscodeLight', 'eclipse', 'xcodeLight', 'solarizedLight', 'gruvboxLight', 'materialLight', 'duotoneLight', 'quietlight', 'bbedit', 'tokyoNightDay', 'basicLight'].includes(k));
const lightThemes = themeKeys.filter((k) => !darkThemes.includes(k));

export function EditorStatusBar({ cursorPos, language }) {
  const editorTheme = useGrooveStore((s) => s.editorTheme);
  const setEditorTheme = useGrooveStore((s) => s.setEditorTheme);
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="flex items-center justify-between h-6 px-3 bg-surface-1 border-t border-border-subtle text-2xs font-sans text-text-3 flex-shrink-0 select-none">
      <div className="flex items-center gap-3">
        <span>Ln {cursorPos.line}, Col {cursorPos.col}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1.5 hover:text-text-0 transition-colors cursor-pointer"
          >
            <Palette size={10} />
            <span>{EDITOR_THEMES[editorTheme]?.label || editorTheme}</span>
          </button>
          {open && (
            <div className="absolute bottom-6 right-0 w-48 max-h-72 overflow-y-auto rounded-md border border-border bg-surface-2 shadow-xl z-50 py-1 scrollbar-thin">
              <div className="px-2 py-1 text-2xs text-text-4 font-semibold uppercase tracking-wider">Dark</div>
              {darkThemes.map((key) => (
                <button
                  key={key}
                  onClick={() => { setEditorTheme(key); setOpen(false); }}
                  className={cn(
                    'w-full text-left px-3 py-1 text-2xs font-sans cursor-pointer transition-colors',
                    key === editorTheme
                      ? 'text-accent bg-accent/10'
                      : 'text-text-1 hover:bg-surface-4',
                  )}
                >
                  {EDITOR_THEMES[key].label}
                </button>
              ))}
              <div className="px-2 py-1 mt-1 text-2xs text-text-4 font-semibold uppercase tracking-wider border-t border-border-subtle">Light</div>
              {lightThemes.map((key) => (
                <button
                  key={key}
                  onClick={() => { setEditorTheme(key); setOpen(false); }}
                  className={cn(
                    'w-full text-left px-3 py-1 text-2xs font-sans cursor-pointer transition-colors',
                    key === editorTheme
                      ? 'text-accent bg-accent/10'
                      : 'text-text-1 hover:bg-surface-4',
                  )}
                >
                  {EDITOR_THEMES[key].label}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="cursor-default">{LANG_LABELS[language] || language || 'Plain Text'}</span>
        <span>Spaces: 2</span>
        <span>UTF-8</span>
      </div>
    </div>
  );
}
