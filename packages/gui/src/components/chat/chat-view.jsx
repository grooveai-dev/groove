// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useCallback } from 'react';
import { MessageCircle, Plus, Sparkles, Zap } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { ConversationList } from './conversation-list';
import { ChatHeader } from './chat-header';
import { ChatMessages } from './chat-messages';
import { ChatInput } from './chat-input';

function EmptyState({ onNewChat }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="max-w-md w-full text-center space-y-8 px-8">
        <div className="relative mx-auto w-20 h-20">
          <div className="absolute inset-0 rounded-full bg-accent/8 animate-pulse" />
          <div className="absolute inset-1 rounded-full bg-surface-3 border border-border-subtle flex items-center justify-center shadow-lg shadow-accent/5">
            <MessageCircle size={32} className="text-accent" />
          </div>
        </div>

        <div className="space-y-3">
          <h1 className="text-2xl font-bold text-text-0 font-sans tracking-tight">Groove Chat</h1>
          <p className="text-sm text-text-2 font-sans max-w-sm mx-auto leading-relaxed">
            A command center disguised as a conversation. Every provider, every model, full project context.
          </p>
        </div>

        <button
          onClick={onNewChat}
          className="inline-flex items-center gap-2 h-10 px-6 rounded-lg bg-accent/15 text-accent text-sm font-semibold font-sans hover:bg-accent/25 transition-colors cursor-pointer border border-accent/20"
        >
          <Plus size={16} />
          New Chat
        </button>

        <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-3 border border-border-subtle">
            <Sparkles size={14} className="text-purple flex-shrink-0" />
            <span className="text-2xs text-text-2 font-sans">Multi-model routing</span>
          </div>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-3 border border-border-subtle">
            <Zap size={14} className="text-warning flex-shrink-0" />
            <span className="text-2xs text-text-2 font-sans">Streaming responses</span>
          </div>
        </div>

        <p className="text-xs text-text-4 font-sans">
          <kbd className="font-mono bg-surface-4 px-1.5 py-0.5 rounded text-text-3">Cmd+Shift+N</kbd>
          <span className="mx-1.5">new chat</span>
        </p>
      </div>
    </div>
  );
}

export function ChatView() {
  const conversations = useGrooveStore((s) => s.conversations);
  const activeConversationId = useGrooveStore((s) => s.activeConversationId);
  const conversationMessages = useGrooveStore((s) => s.conversationMessages);
  const sendingMessage = useGrooveStore((s) => s.sendingMessage);
  const streamingConversationId = useGrooveStore((s) => s.streamingConversationId);
  const createConversation = useGrooveStore((s) => s.createConversation);
  const setActiveConversation = useGrooveStore((s) => s.setActiveConversation);
  const sendChatMessage = useGrooveStore((s) => s.sendChatMessage);
  const stopAgent = useGrooveStore((s) => s.stopAgent);
  const stopChatStreaming = useGrooveStore((s) => s.stopChatStreaming);
  const setConversationMode = useGrooveStore((s) => s.setConversationMode);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;
  const messages = activeConversationId ? (conversationMessages[activeConversationId] || []) : [];
  const isStreaming = streamingConversationId === activeConversationId && sendingMessage;

  const handleNewChat = useCallback(async (provider, model) => {
    const p = provider || 'claude-code';
    const m = model || 'claude-sonnet-4-6';
    try {
      await createConversation(p, m, 'api');
    } catch { /* toast handles */ }
  }, [createConversation]);

  const handleModeChange = useCallback((mode) => {
    if (!activeConversationId) return;
    setConversationMode(activeConversationId, mode);
  }, [activeConversationId, setConversationMode]);

  const handleSend = useCallback((text) => {
    if (!activeConversationId) return;
    sendChatMessage(activeConversationId, text);
  }, [activeConversationId, sendChatMessage]);

  const handleStop = useCallback(() => {
    if (!activeConversation) return;
    if (activeConversation.mode === 'agent' && activeConversation.agentId) {
      stopAgent(activeConversation.agentId);
    } else {
      stopChatStreaming(activeConversationId);
    }
  }, [activeConversation, activeConversationId, stopAgent, stopChatStreaming]);

  const handleModelChange = useCallback(async (selection) => {
    if (activeConversationId) {
      // TODO: Update conversation model via API
    } else {
      await handleNewChat(selection.provider, selection.model);
    }
  }, [activeConversationId, handleNewChat]);

  const currentModel = activeConversation
    ? { provider: activeConversation.provider, model: activeConversation.model }
    : null;

  return (
    <div className="flex h-full bg-surface-2">
      {/* Conversation sidebar */}
      <div className={cn(
        'flex-shrink-0 border-r border-border bg-surface-1 transition-all duration-200 overflow-hidden',
        sidebarCollapsed ? 'w-0' : 'w-64',
      )}>
        <ConversationList onNewChat={() => handleNewChat()} />
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeConversation ? (
          <>
            <ChatHeader conversation={activeConversation} model={currentModel} onModelChange={handleModelChange} onModeChange={handleModeChange} />
            <ChatMessages
              messages={messages}
              isStreaming={isStreaming}
              model={activeConversation.model}
              mode={activeConversation.mode || 'api'}
            />
            <ChatInput
              onSend={handleSend}
              onStop={handleStop}
              sending={sendingMessage}
              streaming={isStreaming}
              disabled={false}
            />
          </>
        ) : (
          <>
            <EmptyState onNewChat={() => handleNewChat()} />
            <ChatInput
              onSend={(text) => {
                handleNewChat().then(() => {
                  setTimeout(() => {
                    const id = useGrooveStore.getState().activeConversationId;
                    if (id) sendChatMessage(id, text);
                  }, 500);
                });
              }}
              onStop={() => {}}
              sending={false}
              streaming={false}
              disabled={false}
            />
          </>
        )}
      </div>
    </div>
  );
}
