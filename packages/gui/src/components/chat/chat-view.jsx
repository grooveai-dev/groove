// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { ConversationList } from './conversation-list';
import { ChatHeader } from './chat-header';
import { ChatMessages } from './chat-messages';
import { ChatInput } from './chat-input';

function EmptyState({ onNewChat }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-lg font-semibold text-text-1 font-sans">Groove Chat</h1>
        <p className="text-sm text-text-3 font-sans">Every provider, every model, full project context.</p>
        <button
          onClick={onNewChat}
          className="inline-flex items-center gap-2 h-9 px-5 rounded-lg bg-accent/15 text-accent text-sm font-semibold font-sans hover:bg-accent/25 transition-colors cursor-pointer border border-accent/20"
        >
          <Plus size={14} />
          New Chat
        </button>
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
    <div className="flex h-full bg-surface-0">
      {/* Conversation sidebar */}
      <div className={cn(
        'flex-shrink-0 border-r border-accent/12 bg-surface-1 transition-all duration-200 overflow-hidden',
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
