// FSL-1.1-Apache-2.0 — see LICENSE

const LANG_LABELS = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  css: 'CSS',
  html: 'HTML',
  json: 'JSON',
  markdown: 'Markdown',
  python: 'Python',
};

export function EditorStatusBar({ cursorPos, language }) {
  return (
    <div className="flex items-center justify-between h-6 px-3 bg-surface-1 border-t border-border-subtle text-2xs font-sans text-text-3 flex-shrink-0 select-none">
      <div className="flex items-center gap-3">
        <span>Ln {cursorPos.line}, Col {cursorPos.col}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="cursor-default">{LANG_LABELS[language] || language || 'Plain Text'}</span>
        <span>Spaces: 2</span>
        <span>UTF-8</span>
      </div>
    </div>
  );
}
