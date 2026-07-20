// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect, useCallback } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Sheet, SheetContent } from '../ui/sheet';
import { cn } from '../../lib/cn';
import { api } from '../../lib/api';
import {
  Bot, Send, ArrowRight, Sparkles, Clock, Shield, FileText,
  ChevronDown, ChevronUp, Edit3, Check, X,
} from 'lucide-react';

const CADENCE_PRESETS = [
  { label: 'Every 15 min', value: '*/15 * * * *' },
  { label: 'Every 30 min', value: '*/30 * * * *' },
  { label: 'Every hour',   value: '0 * * * *' },
  { label: 'Every 2 hours', value: '0 */2 * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily 9 AM',   value: '0 9 * * *' },
  { label: 'Weekdays 9 AM', value: '0 9 * * 1-5' },
];

const SETUP_SYSTEM_PROMPT = `You are a setup assistant for creating autonomous AI agents in Groove.
Your job is to interview the user about what they want their auto agent to do, then generate a complete configuration.

Ask 3-5 focused questions to understand:
1. What is the agent's goal/objective?
2. What tools, APIs, or commands will it need?
3. What should it never do? (guardrails)
4. How often should it check in? (cadence)
5. What does success look like? (milestones/roadmap)

After gathering enough info, generate a JSON config block wrapped in \`\`\`json ... \`\`\` with this exact shape:
{
  "ready": true,
  "name": "short-kebab-name",
  "description": "One-line description",
  "cadence": "0 * * * *",
  "role": "fullstack",
  "prompt": "Full system prompt for the agent...",
  "roadmap": "## Stage 1: ...\\n## Stage 2: ...",
  "guardrails": ["Never do X", "Always do Y"],
  "maxIterations": null
}

Make the prompt comprehensive — include identity, philosophy, available tools, failure handling, and the never-park directive.
Make the roadmap have 2-4 stages with clear graduation criteria.
Keep the conversation friendly and efficient. Ask one question at a time.`;

function ChatMessage({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={cn('flex gap-2', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Sparkles size={12} className="text-accent" />
        </div>
      )}
      <div className={cn(
        'max-w-[85%] rounded-lg px-3 py-2 text-xs font-sans',
        isUser
          ? 'bg-accent text-surface-0 rounded-br-sm'
          : 'bg-surface-2 text-text-1 rounded-bl-sm',
      )}>
        <p className="whitespace-pre-wrap">{msg.content}</p>
      </div>
    </div>
  );
}

function ConfigPreview({ config, onDeploy, onEdit, deploying }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Bot size={16} className="text-accent" />
        <span className="text-sm font-semibold text-text-0 font-sans">Ready to Deploy</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs font-sans">
        <div>
          <span className="text-text-4 text-2xs">Name</span>
          <p className="text-text-0">{config.name}</p>
        </div>
        <div>
          <span className="text-text-4 text-2xs">Cadence</span>
          <p className="text-text-0">{CADENCE_PRESETS.find(p => p.value === config.cadence)?.label || config.cadence}</p>
        </div>
      </div>

      {config.description && (
        <p className="text-xs text-text-2 font-sans">{config.description}</p>
      )}

      {config.guardrails?.length > 0 && (
        <div>
          <span className="text-2xs text-text-4 font-sans flex items-center gap-1">
            <Shield size={10} /> Guardrails
          </span>
          <ul className="text-2xs text-text-2 font-sans mt-1 space-y-0.5">
            {config.guardrails.map((g, i) => <li key={i}>• {g}</li>)}
          </ul>
        </div>
      )}

      <button
        onClick={() => setExpanded(!expanded)}
        className="text-2xs text-accent font-sans flex items-center gap-1 cursor-pointer hover:underline"
      >
        {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        {expanded ? 'Hide' : 'Show'} full config
      </button>

      {expanded && (
        <pre className="text-2xs font-mono text-text-3 bg-surface-0 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto border border-border-subtle">
          {JSON.stringify(config, null, 2)}
        </pre>
      )}

      <div className="flex gap-2 pt-1">
        <Button variant="primary" size="sm" onClick={onDeploy} disabled={deploying} className="flex-1 gap-1.5">
          {deploying ? 'Deploying...' : <><Check size={12} /> Deploy Agent</>}
        </Button>
        <Button variant="outline" size="sm" onClick={onEdit} className="gap-1.5">
          <Edit3 size={12} /> Edit
        </Button>
      </div>
    </div>
  );
}

export function AutoAgentSetupWizard() {
  const open = useGrooveStore((s) => s.autoAgentWizardOpen);
  const closeWizard = useGrooveStore((s) => s.closeAutoAgentWizard);
  const createAutoAgent = useGrooveStore((s) => s.createAutoAgent);
  const setActiveView = useGrooveStore((s) => s.setActiveView);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState(null);
  const [deploying, setDeploying] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: "Hey! I'll help you set up an autonomous agent. What task do you want it to handle? Tell me what you're trying to accomplish and I'll help configure everything.",
      }]);
      setConfig(null);
    }
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const chatHistory = newMessages.map(m => ({ role: m.role, content: m.content }));
      const result = await api.post('/auto-agents/setup-chat', {
        messages: chatHistory,
        systemPrompt: SETUP_SYSTEM_PROMPT,
      });

      const assistantMsg = { role: 'assistant', content: result.response };
      setMessages(prev => [...prev, assistantMsg]);

      if (result.config) {
        setConfig(result.config);
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I hit an error: ${err.message}. Let me try again — could you rephrase that?`,
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, messages, loading]);

  const handleDeploy = useCallback(async () => {
    if (!config) return;
    setDeploying(true);
    try {
      const result = await createAutoAgent(config);
      if (result) {
        setActiveView('auto-agents');
      }
    } finally {
      setDeploying(false);
    }
  }, [config]);

  const handleClose = () => {
    closeWizard();
    setMessages([]);
    setConfig(null);
    setInput('');
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <SheetContent title="New Auto Agent" width={520} onClose={handleClose}>
        <div className="flex flex-col h-full">
          {/* Chat area */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((msg, i) => <ChatMessage key={i} msg={msg} />)}

            {loading && (
              <div className="flex gap-2">
                <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                  <Sparkles size={12} className="text-accent animate-pulse" />
                </div>
                <div className="bg-surface-2 rounded-lg px-3 py-2 rounded-bl-sm">
                  <span className="text-xs text-text-3 font-sans animate-pulse">Thinking...</span>
                </div>
              </div>
            )}

            {config && (
              <ConfigPreview
                config={config}
                onDeploy={handleDeploy}
                onEdit={() => setConfig(null)}
                deploying={deploying}
              />
            )}
          </div>

          {/* Input area */}
          <div className="border-t border-border-subtle px-4 py-3">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder={config ? 'Ask to adjust the config...' : 'Describe what you want the agent to do...'}
                className="flex-1 bg-surface-0 border border-border-subtle rounded-md px-3 py-2 text-xs text-text-0 font-sans placeholder:text-text-4 focus:outline-none focus:border-accent"
                disabled={loading}
              />
              <Button
                variant="primary"
                size="icon-sm"
                onClick={sendMessage}
                disabled={!input.trim() || loading}
              >
                <Send size={14} />
              </Button>
            </div>
            {!config && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {['ML training pipeline', 'Content generation', 'Data monitoring', 'Code review'].map(s => (
                  <button
                    key={s}
                    onClick={() => { setInput(s); inputRef.current?.focus(); }}
                    className="px-2 py-0.5 text-2xs font-sans text-text-3 bg-surface-2 rounded-full hover:bg-surface-3 cursor-pointer transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
