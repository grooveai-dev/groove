// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef, useCallback } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Tooltip } from '../ui/tooltip';
import { cn } from '../../lib/cn';
import { statusColor } from '../../lib/status';
import {
  Mic, MicOff, Phone, PhoneOff, Settings, MessageSquare,
  X, Send, User,
} from 'lucide-react';

const STATUS_LABELS = {
  ready: 'Ready',
  listening: 'Listening...',
  thinking: 'Thinking...',
  speaking: 'Speaking...',
  error: 'Error',
};

const STATUS_COLORS = {
  ready: 'bg-success/15 text-success border-success/25',
  listening: 'bg-info/15 text-info border-info/25',
  thinking: 'bg-warning/15 text-warning border-warning/25',
  speaking: 'bg-accent/15 text-accent border-accent/25',
  error: 'bg-danger/15 text-danger border-danger/25',
};

export function AvatarPanel() {
  const detailPanel = useGrooveStore((s) => s.detailPanel);
  const agents = useGrooveStore((s) => s.agents);
  const agent = agents.find((a) => a.id === detailPanel?.agentId);

  const [chatOpen, setChatOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [inCall, setInCall] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voiceState, setVoiceState] = useState({ status: 'ready', messages: [] });
  const containerRef = useRef(null);
  const chatEndRef = useRef(null);
  const voiceChatRef = useRef(null);

  // Load voice chat hook dynamically (optional — module may not exist yet)
  useEffect(() => {
    if (!agent?.id) return;
    const voiceChatPath = '../../hooks/useVoiceChat';
    import(/* @vite-ignore */ voiceChatPath)
      .then((mod) => { if (mod.useVoiceChat) voiceChatRef.current = mod.useVoiceChat; })
      .catch(() => {});
  }, [agent?.id]);

  // Load avatar manager dynamically (optional — module may not exist yet)
  useEffect(() => {
    if (!containerRef.current || !agent) return;
    let cleanup;
    const avatarMgrPath = '../../lib/avatar-manager';
    import(/* @vite-ignore */ avatarMgrPath)
      .then((mod) => {
        if (mod.initAvatar && containerRef.current) {
          cleanup = mod.initAvatar(containerRef.current, agent.metadata?.avatarUrl);
        }
      })
      .catch(() => {});
    return () => { if (typeof cleanup === 'function') cleanup(); };
  }, [agent?.id, agent?.metadata?.avatarUrl]);

  const { status, messages } = voiceState;
  const isSpeaking = status === 'speaking';
  const isListening = status === 'listening';

  const startListening = useCallback(() => setVoiceState((s) => ({ ...s, status: 'listening' })), []);
  const stopListening = useCallback(() => setVoiceState((s) => ({ ...s, status: 'ready' })), []);
  const sendText = useCallback((text) => {
    setVoiceState((s) => ({
      ...s,
      messages: [...s.messages, { role: 'user', text }],
      status: 'thinking',
    }));
    // Simulated response — real implementation comes from useVoiceChat hook
    setTimeout(() => {
      setVoiceState((s) => ({
        ...s,
        messages: [...s.messages, { role: 'assistant', text: 'Voice chat backend not yet connected.' }],
        status: 'ready',
      }));
    }, 1000);
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    sendText(text);
    setInputText('');
  }, [inputText, sendText]);

  const toggleMic = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  if (!agent) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-0">
        <p className="text-sm text-text-3 font-sans">No avatar selected</p>
      </div>
    );
  }

  const sColor = statusColor(agent.status);
  const isAlive = agent.status === 'running' || agent.status === 'starting';

  return (
    <div className="flex flex-col h-full bg-surface-0 relative">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle bg-surface-1/80">
        <span className="relative flex-shrink-0 w-2 h-2">
          <span className="absolute inset-0 rounded-full" style={{ background: sColor }} />
          {isAlive && (
            <span
              className="absolute inset-[-3px] rounded-full animate-pulse"
              style={{ background: sColor, opacity: 0.2 }}
            />
          )}
        </span>
        <span className="text-sm font-semibold text-text-0 font-sans truncate flex-1">
          {agent.name}
        </span>
        {agent.model && (
          <Badge variant="accent" className="text-2xs">{agent.model}</Badge>
        )}
        <Tooltip content="Settings">
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="p-1.5 rounded-md text-text-3 hover:text-text-0 hover:bg-surface-3 transition-colors cursor-pointer"
          >
            <Settings size={14} />
          </button>
        </Tooltip>
      </div>

      {/* Avatar canvas */}
      <div className="flex-1 relative min-h-0">
        <div
          ref={containerRef}
          id="avatar-container"
          className={cn(
            'absolute inset-3 rounded-xl overflow-hidden transition-shadow duration-300',
            'bg-[#0a0a0a] border border-border-subtle',
            isSpeaking && 'shadow-[0_0_30px_rgba(51,175,188,0.25)] border-accent/40',
          )}
        >
          {/* Fallback when avatar manager isn't loaded */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div
              className={cn(
                'w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300',
                isSpeaking
                  ? 'bg-accent/15 border-2 border-accent/40'
                  : 'bg-surface-3/50 border-2 border-border-subtle',
              )}
            >
              <User size={40} className={isSpeaking ? 'text-accent' : 'text-text-3'} />
            </div>
            {!isAlive && (
              <p className="text-xs text-text-4 font-sans">Agent is {agent.status}</p>
            )}
          </div>
        </div>

        {/* Status pill */}
        <div className="absolute top-5 left-5 z-10">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-2xs font-semibold font-sans',
              STATUS_COLORS[status] || STATUS_COLORS.ready,
            )}
          >
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full',
                status === 'listening' && 'animate-pulse',
              )}
              style={{
                background: status === 'ready' ? 'var(--color-success)'
                  : status === 'listening' ? 'var(--color-info)'
                  : status === 'thinking' ? 'var(--color-warning)'
                  : status === 'speaking' ? 'var(--color-accent)'
                  : 'var(--color-danger)',
              }}
            />
            {STATUS_LABELS[status] || 'Ready'}
          </span>
        </div>

        {/* Chat toggle */}
        <div className="absolute top-5 right-5 z-10">
          <Tooltip content={chatOpen ? 'Hide chat' : 'Show chat'}>
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className={cn(
                'p-2 rounded-lg border transition-all cursor-pointer',
                chatOpen
                  ? 'bg-accent/15 border-accent/30 text-accent'
                  : 'bg-surface-0/80 border-border-subtle text-text-3 hover:text-text-0 hover:bg-surface-2/80',
              )}
            >
              <MessageSquare size={16} />
            </button>
          </Tooltip>
        </div>

        {/* Chat transcript overlay */}
        {chatOpen && (
          <div className="absolute top-14 right-5 bottom-5 w-72 z-10 flex flex-col rounded-xl border border-border-subtle bg-surface-0/90 backdrop-blur-md overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
              <span className="text-xs font-semibold text-text-1 font-sans">Transcript</span>
              <button
                onClick={() => setChatOpen(false)}
                className="p-1 rounded text-text-3 hover:text-text-0 cursor-pointer"
              >
                <X size={12} />
              </button>
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <div className="px-3 py-2 space-y-3">
                {messages.length === 0 && (
                  <p className="text-2xs text-text-4 font-sans text-center py-4">
                    Start talking or type a message...
                  </p>
                )}
                {messages.map((msg, i) => (
                  <div key={i} className={cn('flex flex-col gap-0.5', msg.role === 'user' ? 'items-end' : 'items-start')}>
                    <span className="text-2xs font-semibold text-text-3 font-sans">
                      {msg.role === 'user' ? 'You' : agent.name}
                    </span>
                    <div
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-sans max-w-[90%]',
                        msg.role === 'user'
                          ? 'bg-accent/12 text-text-0 rounded-tr-sm'
                          : 'bg-surface-3 text-text-1 rounded-tl-sm',
                      )}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            </ScrollArea>
            <div className="px-3 py-2 border-t border-border-subtle">
              <div className="flex items-center gap-2">
                <input
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder="Type a message..."
                  className="flex-1 h-7 px-2.5 text-xs rounded-md bg-surface-1 border border-border text-text-0 font-sans focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-text-4"
                />
                <button
                  onClick={handleSend}
                  disabled={!inputText.trim()}
                  className="p-1.5 rounded-md text-accent hover:bg-accent/10 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-center gap-4 px-4 py-4 border-t border-border-subtle bg-surface-1/80">
        <Tooltip content="Settings">
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="p-2.5 rounded-full text-text-3 hover:text-text-0 hover:bg-surface-3 transition-colors cursor-pointer"
          >
            <Settings size={18} />
          </button>
        </Tooltip>

        {/* Mic button */}
        <Tooltip content={isListening ? 'Stop listening' : 'Start listening'}>
          <button
            onClick={toggleMic}
            disabled={!isAlive}
            className={cn(
              'relative p-4 rounded-full transition-all cursor-pointer',
              'disabled:opacity-30 disabled:cursor-not-allowed',
              isListening
                ? 'bg-info/20 text-info border-2 border-info/40'
                : 'bg-accent/15 text-accent border-2 border-accent/30 hover:bg-accent/25',
            )}
          >
            {isListening && (
              <span className="absolute inset-[-4px] rounded-full border-2 border-info/30 animate-ping" />
            )}
            {isListening ? <MicOff size={22} /> : <Mic size={22} />}
          </button>
        </Tooltip>

        {/* End call */}
        <Tooltip content={inCall ? 'End call' : 'Start call'}>
          <button
            onClick={() => {
              if (inCall && isListening) stopListening();
              setInCall(!inCall);
            }}
            disabled={!isAlive}
            className={cn(
              'p-2.5 rounded-full transition-all cursor-pointer',
              'disabled:opacity-30 disabled:cursor-not-allowed',
              inCall
                ? 'bg-danger/20 text-danger border-2 border-danger/30 hover:bg-danger/30'
                : 'bg-success/15 text-success border-2 border-success/30 hover:bg-success/25',
            )}
          >
            {inCall ? <PhoneOff size={18} /> : <Phone size={18} />}
          </button>
        </Tooltip>
      </div>

      {/* Settings drawer */}
      {settingsOpen && (
        <div className="absolute inset-0 z-20 flex">
          <div className="flex-1" onClick={() => setSettingsOpen(false)} />
          <div className="w-72 bg-surface-1 border-l border-border-subtle h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
              <span className="text-sm font-semibold text-text-0 font-sans">Avatar Settings</span>
              <button
                onClick={() => setSettingsOpen(false)}
                className="p-1 rounded text-text-3 hover:text-text-0 cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
            <ScrollArea className="flex-1">
              <div className="px-4 py-3 space-y-4">
                <div>
                  <label className="text-2xs font-semibold text-text-2 font-sans uppercase tracking-wider block mb-1">TTS Provider</label>
                  <p className="text-xs text-text-1 font-sans">{agent.metadata?.ttsProvider || 'elevenlabs'}</p>
                </div>
                <div>
                  <label className="text-2xs font-semibold text-text-2 font-sans uppercase tracking-wider block mb-1">STT Mode</label>
                  <p className="text-xs text-text-1 font-sans">{agent.metadata?.sttMode || 'web-speech'}</p>
                </div>
                <div>
                  <label className="text-2xs font-semibold text-text-2 font-sans uppercase tracking-wider block mb-1">Chat Mode</label>
                  <p className="text-xs text-text-1 font-sans">{agent.metadata?.chatMode || 'quick-chat'}</p>
                </div>
                {agent.metadata?.avatarUrl && (
                  <div>
                    <label className="text-2xs font-semibold text-text-2 font-sans uppercase tracking-wider block mb-1">Avatar URL</label>
                    <p className="text-2xs text-text-3 font-mono break-all">{agent.metadata.avatarUrl}</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}
