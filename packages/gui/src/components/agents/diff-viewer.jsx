// FSL-1.1-Apache-2.0 — see LICENSE
import { useMemo } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { ScrollArea } from '../ui/scroll-area';

function computeDiff(original, modified) {
  const origLines = (original || '').split('\n');
  const modLines = (modified || '').split('\n');
  const result = [];

  const maxLen = Math.max(origLines.length, modLines.length);
  let oi = 0, mi = 0;

  while (oi < origLines.length || mi < modLines.length) {
    if (oi >= origLines.length) {
      result.push({ type: 'add', lineNum: mi + 1, text: modLines[mi] });
      mi++;
    } else if (mi >= modLines.length) {
      result.push({ type: 'del', lineNum: oi + 1, text: origLines[oi] });
      oi++;
    } else if (origLines[oi] === modLines[mi]) {
      result.push({ type: 'same', lineNum: mi + 1, origLineNum: oi + 1, text: modLines[mi] });
      oi++;
      mi++;
    } else {
      let foundOrig = -1;
      let foundMod = -1;
      const lookAhead = Math.min(10, maxLen);

      for (let k = 1; k <= lookAhead; k++) {
        if (mi + k < modLines.length && origLines[oi] === modLines[mi + k]) {
          foundMod = mi + k;
          break;
        }
      }
      for (let k = 1; k <= lookAhead; k++) {
        if (oi + k < origLines.length && origLines[oi + k] === modLines[mi]) {
          foundOrig = oi + k;
          break;
        }
      }

      if (foundMod >= 0 && (foundOrig < 0 || foundMod - mi <= foundOrig - oi)) {
        while (mi < foundMod) {
          result.push({ type: 'add', lineNum: mi + 1, text: modLines[mi] });
          mi++;
        }
      } else if (foundOrig >= 0) {
        while (oi < foundOrig) {
          result.push({ type: 'del', lineNum: oi + 1, text: origLines[oi] });
          oi++;
        }
      } else {
        result.push({ type: 'del', lineNum: oi + 1, text: origLines[oi] });
        result.push({ type: 'add', lineNum: mi + 1, text: modLines[mi] });
        oi++;
        mi++;
      }
    }
  }

  return result;
}

export function DiffViewer({ filePath }) {
  const file = useGrooveStore((s) => s.editorFiles[filePath]);
  const snapshot = useGrooveStore((s) => s.workspaceSnapshots[filePath]);

  const original = snapshot || file?.originalContent || '';
  const modified = file?.content || '';

  const diffLines = useMemo(() => computeDiff(original, modified), [original, modified]);

  const stats = useMemo(() => {
    let adds = 0, dels = 0;
    for (const line of diffLines) {
      if (line.type === 'add') adds++;
      if (line.type === 'del') dels++;
    }
    return { adds, dels };
  }, [diffLines]);

  if (!file) {
    return (
      <div className="flex items-center justify-center h-full text-text-4 text-xs font-sans">
        No file loaded
      </div>
    );
  }

  if (original === modified) {
    return (
      <div className="flex items-center justify-center h-full text-text-4 text-xs font-sans">
        No changes detected
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 bg-surface-1 border-b border-border-subtle text-xs font-sans flex-shrink-0">
        <span className="text-text-2">{filePath.split('/').pop()}</span>
        <span className="text-success">+{stats.adds}</span>
        <span className="text-danger">-{stats.dels}</span>
      </div>
      <ScrollArea className="flex-1">
        <div className="font-mono text-xs leading-5">
          {diffLines.map((line, i) => (
            <div
              key={i}
              className={cn(
                'flex',
                line.type === 'add' && 'bg-success/8',
                line.type === 'del' && 'bg-danger/8',
              )}
            >
              <span className={cn(
                'w-12 flex-shrink-0 text-right pr-3 select-none',
                line.type === 'add' ? 'text-success/60' : line.type === 'del' ? 'text-danger/60' : 'text-text-4',
              )}>
                {line.type === 'add' ? '' : (line.origLineNum || line.lineNum)}
              </span>
              <span className={cn(
                'w-12 flex-shrink-0 text-right pr-3 select-none',
                line.type === 'add' ? 'text-success/60' : line.type === 'del' ? 'text-danger/60' : 'text-text-4',
              )}>
                {line.type === 'del' ? '' : line.lineNum}
              </span>
              <span className={cn(
                'w-5 flex-shrink-0 text-center select-none font-bold',
                line.type === 'add' ? 'text-success' : line.type === 'del' ? 'text-danger' : 'text-text-4',
              )}>
                {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
              </span>
              <span className={cn(
                'flex-1 whitespace-pre px-2',
                line.type === 'add' ? 'text-success/90' : line.type === 'del' ? 'text-danger/90' : 'text-text-1',
              )}>
                {line.text}
              </span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
