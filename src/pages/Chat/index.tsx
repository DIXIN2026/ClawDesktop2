import { useState, useEffect, useCallback } from 'react';
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Code,
  FileText,
  Palette,
  TestTube,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { SessionList } from '@/components/chat/SessionList';
import { MessageList } from '@/components/chat/MessageList';
import { ChatInput } from '@/components/chat/ChatInput';
import { ApprovalDialog } from '@/components/chat/ApprovalDialog';
import { ReviewPanel } from '@/components/review/ReviewPanel';

import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useProvidersStore } from '@/stores/providers';

const AGENT_TYPE_ICONS: Record<string, React.ReactNode> = {
  coding: <Code className="h-4 w-4" />,
  requirements: <FileText className="h-4 w-4" />,
  design: <Palette className="h-4 w-4" />,
  testing: <TestTube className="h-4 w-4" />,
};

export function ChatPage() {
  const [showSidebar, setShowSidebar] = useState(true);
  const [showReviewPanel, setShowReviewPanel] = useState(true);

  // Chat store
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const pendingApproval = useChatStore((s) => s.pendingApproval);
  const createSession = useChatStore((s) => s.createSession);
  const selectSession = useChatStore((s) => s.selectSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortGeneration = useChatStore((s) => s.abortGeneration);
  const respondToApproval = useChatStore((s) => s.respondToApproval);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const setCurrentSessionAgent = useChatStore((s) => s.setCurrentSessionAgent);

  // Agents store
  const agents = useAgentsStore((s) => s.agents);
  const currentAgentType = useAgentsStore((s) => s.currentAgentType);
  const setCurrentAgentType = useAgentsStore((s) => s.setCurrentAgentType);

  // Providers store for model selection
  const providers = useProvidersStore((s) => s.providers);

  // Build flat model list
  const availableModels = providers.flatMap((p) =>
    p.models.map((m) => ({
      value: `${p.id}/${m.id}`,
      label: `${m.name} (${p.name})`,
    })),
  );

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const [selectedModel, setSelectedModel] = useState(
    currentSession?.currentModel ?? (availableModels[0]?.value ?? ''),
  );

  // Load sessions on mount
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // Update selected model when session changes
  useEffect(() => {
    if (currentSession?.currentModel) {
      setSelectedModel(currentSession.currentModel);
    }
  }, [currentSession?.currentModel]);

  useEffect(() => {
    const sessionAgent = currentSession?.agentId;
    if (sessionAgent && sessionAgent !== currentAgentType) {
      setCurrentAgentType(sessionAgent as 'coding' | 'requirements' | 'design' | 'testing');
    }
  }, [currentSession?.agentId, currentAgentType, setCurrentAgentType]);

  const handleCreateSession = useCallback(async () => {
    try {
      await createSession('New Chat', currentAgentType);
    } catch (err) {
      console.error('Failed to create session:', err instanceof Error ? err.message : String(err));
    }
  }, [createSession, currentAgentType]);

  const handleSelectSession = useCallback(
    (id: string) => {
      void selectSession(id);
    },
    [selectSession],
  );

  const handleDeleteSession = useCallback(
    (id: string) => {
      void deleteSession(id);
    },
    [deleteSession],
  );

  const handleSendMessage = useCallback(
    (content: string) => {
      void sendMessage(content);
    },
    [sendMessage],
  );

  const handleAbort = useCallback(() => {
    void abortGeneration();
  }, [abortGeneration]);

  const handleApprovalRespond = useCallback(
    (approved: boolean) => {
      if (pendingApproval) {
        void respondToApproval(pendingApproval.id, approved);
      }
    },
    [pendingApproval, respondToApproval],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      setSelectedModel(value);
      if (currentSessionId) {
        const [providerId, modelId] = value.split('/');
        if (providerId && modelId) {
          const switchModel = useChatStore.getState().switchModel;
          void switchModel(providerId, modelId);
        }
      }
    },
    [currentSessionId],
  );

  return (
    <div className="h-full flex">
      {/* Left sidebar - Session list */}
      <div
        className={cn(
          'border-r border-border bg-background/50 transition-all duration-200 shrink-0',
          showSidebar ? 'w-64' : 'w-0 overflow-hidden',
        )}
      >
        <SessionList
          sessions={sessions}
          currentId={currentSessionId}
          onSelect={handleSelectSession}
          onCreate={() => void handleCreateSession()}
          onDelete={handleDeleteSession}
        />
      </div>

      {/* Center: Chat panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="h-12 flex items-center justify-between px-3 border-b border-border shrink-0 gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setShowSidebar(!showSidebar)}
              title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
            >
              {showSidebar ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </Button>

            {/* Agent type selector */}
            <Select
              value={currentAgentType}
              onValueChange={(val) => {
                const next = val as typeof currentAgentType;
                setCurrentAgentType(next);
                setCurrentSessionAgent(next);
              }}
            >
              <SelectTrigger className="w-44 h-8 text-xs">
                <div className="flex items-center gap-2">
                  {AGENT_TYPE_ICONS[currentAgentType]}
                  <SelectValue />
                </div>
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem key={agent.type} value={agent.type}>
                    <div className="flex items-center gap-2">
                      {AGENT_TYPE_ICONS[agent.type]}
                      <span>{agent.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            {/* Model selector */}
            {availableModels.length > 0 && (
              <Select value={selectedModel} onValueChange={handleModelChange}>
                <SelectTrigger className="w-52 h-8 text-xs">
                  <SelectValue placeholder="Select model..." />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setShowReviewPanel(!showReviewPanel)}
              title={showReviewPanel ? 'Hide review panel' : 'Show review panel'}
            >
              {showReviewPanel ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Messages */}
        <MessageList messages={messages} isStreaming={isStreaming} />

        {/* Input */}
        <ChatInput
          onSend={handleSendMessage}
          onAbort={handleAbort}
          isStreaming={isStreaming}
          disabled={!currentSessionId && sessions.length > 0}
        />

        {/* Approval dialog */}
        {pendingApproval && (
          <ApprovalDialog
            approval={pendingApproval}
            onRespond={handleApprovalRespond}
          />
        )}
      </div>

      {/* Right: Review/Diff panel */}
      <div
        className={cn(
          'border-l border-border bg-background/50 transition-all duration-200 shrink-0',
          showReviewPanel ? 'w-96' : 'w-0 overflow-hidden',
        )}
      >
        <ReviewPanel />
      </div>
    </div>
  );
}
