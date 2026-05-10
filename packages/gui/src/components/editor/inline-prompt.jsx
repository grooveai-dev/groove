// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { Sparkles, Send, X } from 'lucide-react';

export function InlinePrompt({ line, coords, onClose, filePath }) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);
  const agentId = useGrooveStore((s) => s.editorSelectedAgent);
  const instructAgent = useGrooveStore((s) => s.instructAgent);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending || !agentId) return;
    setSending(true);
    const fileName = filePath?.split('/').pop() || 'file';
    const prompt = `[Inline prompt at ${fileName}:${line}] ${text}`;
    try {
      await instructAgent(agentId, prompt);
    } catch { /* toast handles */ }
    setSending(false);
    onClose();
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  const top = coords?.top ? Math.min(coords.top + 24, window.innerHeight - 60) : 200;

  return (
    <div
      className="absolute left-8 right-8 z-30 flex items-center gap-2 px-3 py-2 bg-surface-2 border border-accent/30 rounded-lg shadow-lg"
      style={{ top }}
    >
      <Sparkles size={14} className="text-accent flex-shrink-0" />
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={agentId ? 'Ask AI to edit at this line...' : 'Select an agent first'}
        disabled={!agentId}
        className="flex-1 bg-transparent text-xs text-text-0 font-sans placeholder:text-text-4 focus:outline-none disabled:opacity-50"
      />
      {input.trim() && (
        <button
          onClick={handleSend}
          disabled={sending || !agentId}
          className="p-1 text-accent hover:text-accent/80 cursor-pointer disabled:opacity-50"
        >
          <Send size={12} />
        </button>
      )}
      <button onClick={onClose} className="p-1 text-text-4 hover:text-text-1 cursor-pointer">
        <X size={12} />
      </button>
    </div>
  );
}
