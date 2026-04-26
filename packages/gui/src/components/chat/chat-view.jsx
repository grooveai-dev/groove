// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useCallback } from 'react';
import { Plus, PanelLeftOpen } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { ConversationList } from './conversation-list';
import { ChatHeader } from './chat-header';
import { ChatMessages } from './chat-messages';
import { ChatInput } from './chat-input';
import { isImageModel } from './model-picker';

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
  const sendImageMessage = useGrooveStore((s) => s.sendImageMessage);
  const stopAgent = useGrooveStore((s) => s.stopAgent);
  const stopChatStreaming = useGrooveStore((s) => s.stopChatStreaming);
  const setConversationMode = useGrooveStore((s) => s.setConversationMode);
  const setConversationModel = useGrooveStore((s) => s.setConversationModel);

  const conversationRoles = useGrooveStore((s) => s.conversationRoles);
  const setConversationRole = useGrooveStore((s) => s.setConversationRole);

  const conversationReasoningEffort = useGrooveStore((s) => s.conversationReasoningEffort);
  const setConversationReasoningEffort = useGrooveStore((s) => s.setConversationReasoningEffort);
  const conversationVerbosity = useGrooveStore((s) => s.conversationVerbosity);
  const setConversationVerbosity = useGrooveStore((s) => s.setConversationVerbosity);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [replyContext, setReplyContext] = useState(null);
  const [modeChanging, setModeChanging] = useState(false);

  const activeRole = activeConversationId ? (conversationRoles?.[activeConversationId] || null) : null;
  const activeReasoningEffort = activeConversationId ? (conversationReasoningEffort?.[activeConversationId] || 'medium') : 'medium';
  const activeVerbosity = activeConversationId ? (conversationVerbosity?.[activeConversationId] || 'medium') : 'medium';

  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;
  const isCodexProvider = activeConversation?.provider === 'codex';
  const messages = activeConversationId ? (conversationMessages[activeConversationId] || []) : [];
  const isStreaming = streamingConversationId === activeConversationId && sendingMessage;
  const currentModelIsImage = activeConversation ? isImageModel(activeConversation.model) : false;

  const handleNewChat = useCallback(async (provider, model) => {
    try {
      await createConversation(provider || null, model || null, 'api');
    } catch { /* toast handles */ }
  }, [createConversation]);

  const handleModeChange = useCallback(async (mode) => {
    if (!activeConversationId || modeChanging) return;
    setModeChanging(true);
    try {
      await setConversationMode(activeConversationId, mode);
    } finally {
      setModeChanging(false);
    }
  }, [activeConversationId, setConversationMode, modeChanging]);

  const handleRoleChange = useCallback((role) => {
    if (!activeConversationId) return;
    setConversationRole(activeConversationId, role);
  }, [activeConversationId, setConversationRole]);

  const handleSend = useCallback((text) => {
    if (!activeConversationId) return;

    if (currentModelIsImage) {
      const prompt = replyContext
        ? `${text} (iterating on: "${replyContext.prompt}")`
        : text;
      sendImageMessage(activeConversationId, prompt, { model: activeConversation.model });
      setReplyContext(null);
    } else {
      sendChatMessage(activeConversationId, text);
    }
  }, [activeConversationId, activeConversation, currentModelIsImage, replyContext, sendChatMessage, sendImageMessage]);

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
      await setConversationModel(activeConversationId, selection.provider, selection.model);
    } else {
      await handleNewChat(selection.provider, selection.model);
    }
  }, [activeConversationId, setConversationModel, handleNewChat]);

  const handleImageReply = useCallback((msg) => {
    setReplyContext(msg);
  }, []);

  const handleReasoningEffortChange = useCallback((effort) => {
    if (!activeConversationId) return;
    setConversationReasoningEffort(activeConversationId, effort);
  }, [activeConversationId, setConversationReasoningEffort]);

  const handleVerbosityChange = useCallback((verbosity) => {
    if (!activeConversationId) return;
    setConversationVerbosity(activeConversationId, verbosity);
  }, [activeConversationId, setConversationVerbosity]);

  const currentModel = activeConversation
    ? { provider: activeConversation.provider, model: activeConversation.model }
    : null;

  return (
    <div className="flex h-full bg-surface-0">
      {/* Conversation sidebar */}
      <div className={cn(
        'relative flex-shrink-0 border-r border-accent/12 bg-surface-1 transition-all duration-200 overflow-hidden',
        sidebarCollapsed ? 'w-0 border-r-0' : 'w-64',
      )}>
        <ConversationList onNewChat={() => handleNewChat()} onCollapse={() => setSidebarCollapsed(true)} />
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {sidebarCollapsed && (
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="absolute top-3 left-2 z-10 w-7 h-7 flex items-center justify-center rounded-md text-text-3 hover:text-text-0 hover:bg-surface-3 transition-colors cursor-pointer"
            title="Show sidebar"
          >
            <PanelLeftOpen size={15} />
          </button>
        )}

        {activeConversation ? (
          <>
            <ChatHeader conversation={activeConversation} model={currentModel} onModelChange={handleModelChange} role={activeRole} onRoleChange={handleRoleChange} sidebarCollapsed={sidebarCollapsed} />
            <ChatMessages
              messages={messages}
              isStreaming={isStreaming}
              model={activeConversation.model}
              mode={activeConversation.mode || 'api'}
              onImageReply={handleImageReply}
              role={activeRole}
            />
            <ChatInput
              onSend={handleSend}
              onStop={handleStop}
              sending={sendingMessage}
              streaming={isStreaming}
              disabled={false}
              isImageModel={currentModelIsImage}
              currentModel={activeConversation.model}
              replyContext={replyContext}
              onClearReply={() => setReplyContext(null)}
              role={activeRole}
              isCodex={isCodexProvider}
              reasoningEffort={activeReasoningEffort}
              onReasoningEffortChange={handleReasoningEffortChange}
              verbosity={activeVerbosity}
              onVerbosityChange={handleVerbosityChange}
              mode={activeConversation?.mode || 'api'}
              onModeChange={handleModeChange}
              modeChanging={modeChanging}
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
              isImageModel={false}
              currentModel={null}
            />
          </>
        )}
      </div>
    </div>
  );
}
