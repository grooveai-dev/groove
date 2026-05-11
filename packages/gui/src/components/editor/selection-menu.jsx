// FSL-1.1-Apache-2.0 — see LICENSE
import { useEffect, useRef } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { Bot, BookOpen, Wrench, Bug, TestTube2 } from 'lucide-react';

const ACTIONS = [
  { id: 'ask',      label: 'Ask Agent',       icon: Bot,        instruction: 'Analyze this code and answer questions about it' },
  { id: 'explain',  label: 'Explain Code',     icon: BookOpen,   instruction: 'Explain what this code does in detail' },
  { id: 'refactor', label: 'Refactor',         icon: Wrench,     instruction: 'Refactor this code for better readability and maintainability' },
  { id: 'fix',      label: 'Fix Bug',          icon: Bug,        instruction: 'Find and fix any bugs in this code' },
  { id: 'test',     label: 'Generate Tests',   icon: TestTube2,  instruction: 'Generate comprehensive tests for this code' },
];

export function SelectionMenu({ x, y, filePath, lineStart, lineEnd, selectedCode, onClose }) {
  const ref = useRef(null);
  const agentId = useGrooveStore((s) => s.editorSelectedAgent);
  const sendCodeToAgent = useGrooveStore((s) => s.sendCodeToAgent);
  const toggleAiPanel = useGrooveStore((s) => s.toggleAiPanel);
  const aiPanelOpen = useGrooveStore((s) => s.editorAiPanelOpen);
  const selectAgent = useGrooveStore((s) => s.selectAgent);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Viewport boundary correction
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const el = ref.current;
    if (rect.right > window.innerWidth - 8) {
      el.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight - 8) {
      el.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  });

  function handleAction(action) {
    if (!agentId) return;
    sendCodeToAgent(agentId, action.instruction, filePath, lineStart, lineEnd, selectedCode);
    if (!aiPanelOpen) toggleAiPanel();
    selectAgent(agentId);
    onClose();
  }

  if (!agentId) {
    return (
      <div
        ref={ref}
        className="fixed z-50 py-2 px-3 bg-surface-2 border border-border rounded-lg shadow-xl"
        style={{ left: x, top: y }}
      >
        <p className="text-2xs text-text-4 font-sans">Select an agent in the toolbar to use AI features</p>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[180px] py-1 bg-surface-2 border border-border rounded-lg shadow-xl"
      style={{ left: x, top: y }}
    >
      <div className="px-3 py-1 text-2xs text-text-4 font-sans font-medium">AI Actions</div>
      {ACTIONS.map((action) => (
        <button
          key={action.id}
          onClick={() => handleAction(action)}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs font-sans text-text-1 hover:bg-surface-5 cursor-pointer transition-colors text-left"
        >
          <action.icon size={12} className="text-accent flex-shrink-0" />
          {action.label}
        </button>
      ))}
    </div>
  );
}
