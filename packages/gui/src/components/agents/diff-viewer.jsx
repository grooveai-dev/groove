// FSL-1.1-Apache-2.0 — see LICENSE
import { useMemo, useState, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { ScrollArea } from '../ui/scroll-area';
import { api } from '../../lib/api';
import { Columns2, AlignJustify } from 'lucide-react';

export function computeDiff(original, modified) {
  const origLines = (original || '').split('\n');
  const modLines = (modified || '').split('\n');
  const result = [];
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
      oi++; mi++;
    } else {
      let foundOrig = -1, foundMod = -1;
      const lookAhead = Math.min(10, Math.max(origLines.length - oi, modLines.length - mi));
      for (let k = 1; k <= lookAhead; k++) {
        if (mi + k < modLines.length && origLines[oi] === modLines[mi + k]) { foundMod = mi + k; break; }
      }
      for (let k = 1; k <= lookAhead; k++) {
        if (oi + k < origLines.length && origLines[oi + k] === modLines[mi]) { foundOrig = oi + k; break; }
      }
      if (foundMod >= 0 && (foundOrig < 0 || foundMod - mi <= foundOrig - oi)) {
        while (mi < foundMod) { result.push({ type: 'add', lineNum: mi + 1, text: modLines[mi] }); mi++; }
      } else if (foundOrig >= 0) {
        while (oi < foundOrig) { result.push({ type: 'del', lineNum: oi + 1, text: origLines[oi] }); oi++; }
      } else {
        result.push({ type: 'del', lineNum: oi + 1, text: origLines[oi] });
        result.push({ type: 'add', lineNum: mi + 1, text: modLines[mi] });
        oi++; mi++;
      }
    }
  }
  return result;
}

function buildSideBySide(diffLines) {
  const pairs = [];
  let i = 0;
  while (i < diffLines.length) {
    const line = diffLines[i];
    if (line.type === 'same') {
      pairs.push({ left: { num: line.origLineNum, text: line.text, type: 'same' }, right: { num: line.lineNum, text: line.text, type: 'same' } });
      i++;
    } else if (line.type === 'del') {
      if (i + 1 < diffLines.length && diffLines[i + 1].type === 'add') {
        pairs.push({ left: { num: line.lineNum, text: line.text, type: 'mod' }, right: { num: diffLines[i + 1].lineNum, text: diffLines[i + 1].text, type: 'mod' } });
        i += 2;
      } else {
        pairs.push({ left: { num: line.lineNum, text: line.text, type: 'del' }, right: { num: '', text: '', type: 'empty' } });
        i++;
      }
    } else {
      pairs.push({ left: { num: '', text: '', type: 'empty' }, right: { num: line.lineNum, text: line.text, type: 'add' } });
      i++;
    }
  }
  return pairs;
}

function UnifiedView({ diffLines }) {
  return (
    <div className="font-mono text-xs leading-5 overflow-x-auto">
      {diffLines.map((line, i) => (
        <div
          key={i}
          className={cn(
            'flex',
            line.type === 'add' && 'bg-success/15',
            line.type === 'del' && 'bg-danger/15',
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
            'whitespace-pre px-2 flex-1',
            line.type === 'add' ? 'text-success' : line.type === 'del' ? 'text-danger' : 'text-text-1',
          )}>
            {line.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function SideBySideView({ pairs }) {
  return (
    <div className="font-mono text-xs leading-5 overflow-x-auto">
      {pairs.map((pair, i) => (
        <div key={i} className="flex">
          {/* Left (original) */}
          <div className={cn(
            'flex flex-1 min-w-0 border-r border-border-subtle',
            pair.left.type === 'del' && 'bg-danger/15',
            pair.left.type === 'mod' && 'bg-warning/10',
            pair.left.type === 'empty' && 'bg-surface-2/50',
          )}>
            <span className={cn(
              'w-10 flex-shrink-0 text-right pr-2 select-none',
              pair.left.type === 'del' || pair.left.type === 'mod' ? 'text-danger/60' : 'text-text-4',
            )}>
              {pair.left.num}
            </span>
            <span className={cn(
              'whitespace-pre px-1',
              pair.left.type === 'del' ? 'text-danger' :
              pair.left.type === 'mod' ? 'text-warning' :
              pair.left.type === 'empty' ? '' : 'text-text-1',
            )}>
              {pair.left.text}
            </span>
          </div>
          {/* Right (modified) */}
          <div className={cn(
            'flex flex-1 min-w-0',
            pair.right.type === 'add' && 'bg-success/15',
            pair.right.type === 'mod' && 'bg-success/10',
            pair.right.type === 'empty' && 'bg-surface-2/50',
          )}>
            <span className={cn(
              'w-10 flex-shrink-0 text-right pr-2 select-none',
              pair.right.type === 'add' || pair.right.type === 'mod' ? 'text-success/60' : 'text-text-4',
            )}>
              {pair.right.num}
            </span>
            <span className={cn(
              'whitespace-pre px-1',
              pair.right.type === 'add' ? 'text-success' :
              pair.right.type === 'mod' ? 'text-success' :
              pair.right.type === 'empty' ? '' : 'text-text-1',
            )}>
              {pair.right.text}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function DiffViewer({ filePath, gitDiffData, originalContent, modifiedContent }) {
  const file = useGrooveStore((s) => s.editorFiles[filePath]);
  const snapshot = useGrooveStore((s) => s.workspaceSnapshots[filePath]);
  const [viewMode, setViewMode] = useState('side-by-side');
  const [gitOriginal, setGitOriginal] = useState(null);

  useEffect(() => {
    if (gitDiffData?.original !== undefined) {
      setGitOriginal(gitDiffData.original);
    } else if (originalContent === undefined && !snapshot && !file?.originalContent) {
      api.get(`/files/git-diff?path=${encodeURIComponent(filePath)}`).then((data) => {
        if (data?.original !== undefined) setGitOriginal(data.original);
      }).catch(() => {});
    }
  }, [filePath, gitDiffData, snapshot, file?.originalContent, originalContent]);

  const original = originalContent ?? gitOriginal ?? snapshot ?? file?.originalContent ?? '';
  const modified = modifiedContent ?? file?.content ?? '';

  const diffLines = useMemo(() => computeDiff(original, modified), [original, modified]);
  const sidePairs = useMemo(() => buildSideBySide(diffLines), [diffLines]);

  const stats = useMemo(() => {
    let adds = 0, dels = 0;
    for (const line of diffLines) {
      if (line.type === 'add') adds++;
      if (line.type === 'del') dels++;
    }
    return { adds, dels };
  }, [diffLines]);

  if (!original && !modified) {
    return (
      <div className="flex items-center justify-center h-full text-text-4 text-xs font-sans">
        No file loaded
      </div>
    );
  }

  if (original === modified && !gitDiffData) {
    return (
      <div className="flex items-center justify-center h-full text-text-4 text-xs font-sans">
        No changes detected
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 bg-surface-1 border-b border-border-subtle text-xs font-sans flex-shrink-0">
        <span className="text-text-2 flex-1">{filePath.split('/').pop()}</span>
        <span className="text-success">+{stats.adds}</span>
        <span className="text-danger">-{stats.dels}</span>
        <div className="w-px h-4 bg-border-subtle" />
        <div className="flex items-center gap-0.5 bg-surface-2 rounded-md p-0.5">
          <button
            onClick={() => setViewMode('side-by-side')}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 text-2xs rounded cursor-pointer transition-colors',
              viewMode === 'side-by-side' ? 'bg-surface-4 text-text-0' : 'text-text-3 hover:text-text-1',
            )}
          >
            <Columns2 size={10} /> Split
          </button>
          <button
            onClick={() => setViewMode('unified')}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 text-2xs rounded cursor-pointer transition-colors',
              viewMode === 'unified' ? 'bg-surface-4 text-text-0' : 'text-text-3 hover:text-text-1',
            )}
          >
            <AlignJustify size={10} /> Unified
          </button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        {viewMode === 'side-by-side'
          ? <SideBySideView pairs={sidePairs} />
          : <UnifiedView diffLines={diffLines} />
        }
      </ScrollArea>
    </div>
  );
}
