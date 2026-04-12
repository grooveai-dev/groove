// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef, useMemo } from 'react';
import { useGrooveStore } from '../../stores/groove';
import {
  Network, Code2, ChartSpline, Puzzle, Users, Plus,
  RotateCw, Skull, MessageSquare, Terminal, Newspaper,
  Search,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { AnimatePresence, motion } from 'framer-motion';

const STATIC_COMMANDS = [
  { id: 'nav:agents',      label: 'Go to Agents',      icon: Network,    category: 'Navigation', action: (s) => { s.setActiveView('agents'); } },
  { id: 'nav:editor',      label: 'Go to Editor',      icon: Code2,      category: 'Navigation', action: (s) => { s.setActiveView('editor'); } },
  { id: 'nav:dashboard',   label: 'Go to Dashboard',   icon: ChartSpline, category: 'Navigation', action: (s) => { s.setActiveView('dashboard'); } },
  { id: 'nav:marketplace', label: 'Go to Marketplace', icon: Puzzle,     category: 'Navigation', action: (s) => { s.setActiveView('marketplace'); } },
  { id: 'nav:teams',       label: 'Go to Teams',       icon: Users,      category: 'Navigation', action: (s) => { s.setActiveView('teams'); } },
  { id: 'action:spawn',    label: 'Spawn Agent',       icon: Plus,       category: 'Actions',    action: (s) => { s.openDetail({ type: 'spawn' }); } },
  { id: 'action:terminal', label: 'Toggle Terminal',   icon: Terminal,   category: 'Actions',    action: (s) => { s.setTerminalVisible(!s.terminalVisible); }, shortcut: 'Cmd+J' },
  { id: 'action:journalist', label: 'Toggle Journalist', icon: Newspaper, category: 'Actions',  action: (s) => {
    s.detailPanel?.type === 'journalist' ? s.closeDetail() : s.openDetail({ type: 'journalist' });
  }},
];

export function CommandPalette() {
  const open = useGrooveStore((s) => s.commandPaletteOpen);
  const toggle = useGrooveStore((s) => s.toggleCommandPalette);
  const agents = useGrooveStore((s) => s.agents);
  const store = useGrooveStore;

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  // Build dynamic commands from agents
  const commands = useMemo(() => {
    const agentCommands = agents.flatMap((a) => [
      { id: `chat:${a.id}`, label: `Chat with ${a.name}`, icon: MessageSquare, category: 'Agents', action: (s) => { s.selectAgent(a.id); } },
      ...(a.status === 'running' ? [
        { id: `rotate:${a.id}`, label: `Rotate ${a.name}`, icon: RotateCw, category: 'Agents', action: (s) => { s.rotateAgent(a.id); } },
        { id: `kill:${a.id}`, label: `Kill ${a.name}`, icon: Skull, category: 'Agents', action: (s) => { s.killAgent(a.id); } },
      ] : []),
    ]);
    return [...STATIC_COMMANDS, ...agentCommands];
  }, [agents]);

  // Filter
  const filtered = useMemo(() => {
    if (!query.trim()) return commands.slice(0, 12);
    const q = query.toLowerCase();
    return commands
      .filter((c) => c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q))
      .slice(0, 12);
  }, [commands, query]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Clamp selected index
  useEffect(() => {
    if (selectedIndex >= filtered.length) setSelectedIndex(Math.max(0, filtered.length - 1));
  }, [filtered.length, selectedIndex]);

  function execute(cmd) {
    cmd.action(store.getState());
    toggle();
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && filtered[selectedIndex]) { e.preventDefault(); execute(filtered[selectedIndex]); }
    else if (e.key === 'Escape') { toggle(); }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={toggle} />

      {/* Palette */}
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.98 }}
          transition={{ duration: 0.15 }}
          className="fixed top-[15%] left-1/2 -translate-x-1/2 z-50 w-[480px] max-h-[400px] bg-surface-1 border border-border rounded-lg shadow-2xl overflow-hidden"
          onKeyDown={onKeyDown}
        >
          {/* Search input */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
            <Search size={16} className="text-text-3 flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
              placeholder="Type a command..."
              className="flex-1 bg-transparent text-sm text-text-0 font-sans placeholder:text-text-4 focus:outline-none"
            />
          </div>

          {/* Results */}
          <div className="overflow-y-auto max-h-[320px] py-1">
            {filtered.length === 0 && (
              <div className="px-4 py-6 text-sm text-text-3 text-center font-sans">No results</div>
            )}
            {filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                onClick={() => execute(cmd)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-2 text-sm font-sans cursor-pointer',
                  i === selectedIndex ? 'bg-surface-5 text-text-0' : 'text-text-1 hover:bg-surface-4',
                )}
              >
                <cmd.icon size={16} className="text-text-3 flex-shrink-0" />
                <span className="flex-1 text-left">{cmd.label}</span>
                <span className="text-2xs text-text-4">{cmd.category}</span>
                {cmd.shortcut && (
                  <kbd className="text-2xs font-mono bg-surface-4 px-1 py-0.5 rounded text-text-3 ml-1">
                    {cmd.shortcut}
                  </kbd>
                )}
              </button>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>
    </>
  );
}
