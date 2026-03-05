import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { ClarificationDialog } from '@/components/chat/ClarificationDialog';
import { ReviewPanel } from '@/components/review/ReviewPanel';
import { DesignPreview } from '@/components/preview/DesignPreview';

import { useChatStore } from '@/stores/chat';
import type { ChatAttachment } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useProvidersStore } from '@/stores/providers';
import { useGitStore } from '@/stores/git';
import type { GitWorktree } from '@/stores/git';
import { useSettingsStore } from '@/stores/settings';

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
  const previewUrls = useChatStore((s) => s.previewUrls);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const pendingApproval = useChatStore((s) => s.pendingApproval);
  const pendingClarification = useChatStore((s) => s.pendingClarification);
  const createSession = useChatStore((s) => s.createSession);
  const selectSession = useChatStore((s) => s.selectSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortGeneration = useChatStore((s) => s.abortGeneration);
  const respondToApproval = useChatStore((s) => s.respondToApproval);
  const respondToClarification = useChatStore((s) => s.respondToClarification);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const setCurrentSessionAgent = useChatStore((s) => s.setCurrentSessionAgent);
  const worktrees = useGitStore((s) => s.worktrees);
  const loadWorktrees = useGitStore((s) => s.loadWorktrees);
  const createWorktree = useGitStore((s) => s.createWorktree);
  const removeWorktree = useGitStore((s) => s.removeWorktree);
  const setGitWorkDirectory = useGitStore((s) => s.setWorkDirectory);
  const defaultWorkDirectory = useSettingsStore((s) => s.workDirectory);

  // Agents store
  const agents = useAgentsStore((s) => s.agents);
  const currentAgentType = useAgentsStore((s) => s.currentAgentType);
  const setCurrentAgentType = useAgentsStore((s) => s.setCurrentAgentType);

  // Providers store for model selection
  const providers = useProvidersStore((s) => s.providers);

  // Build flat model list
  const availableModels = useMemo(
    () => providers.flatMap((p) =>
      p.models.map((m) => ({
        value: `${p.id}/${m.id}`,
        label: `${m.name} (${p.name})`,
      })),
    ),
    [providers],
  );

  const currentSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId),
    [sessions, currentSessionId],
  );
  const currentPreviewUrl = currentSessionId ? previewUrls[currentSessionId] : undefined;
  const [selectedModel, setSelectedModel] = useState(
    currentSession?.currentModel ?? (availableModels[0]?.value ?? ''),
  );

  // Load sessions on mount
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    void setGitWorkDirectory(currentSession?.workDirectory ?? defaultWorkDirectory ?? null);
  }, [currentSession?.workDirectory, defaultWorkDirectory, setGitWorkDirectory]);

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

  const handleWorktreeCreate = useCallback(
    (branch: string, path: string) => {
      void createWorktree(branch, path);
    },
    [createWorktree],
  );

  const handleWorktreeDelete = useCallback(
    (path: string) => {
      void removeWorktree(path);
    },
    [removeWorktree],
  );

  const handleWorktreeRefresh = useCallback(() => {
    void loadWorktrees();
  }, [loadWorktrees]);

  const handleWorktreeStartChat = useCallback(
    (worktree: GitWorktree) => {
      const title = worktree.branch ? `Worktree: ${worktree.branch}` : 'Worktree Chat';
      void createSession(title, currentAgentType, worktree.path);
    },
    [createSession, currentAgentType],
  );

  const handleSendMessage = useCallback(
    (content: string, attachments?: ChatAttachment[]) => {
      void sendMessage(content, attachments);
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

  const handleClarificationSubmit = useCallback(
    (answers: Record<string, string>) => {
      if (!pendingClarification) return;
      void respondToClarification(pendingClarification.id, answers).catch((err) => {
        console.error('Failed to submit clarification:', err instanceof Error ? err.message : String(err));
      });
    },
    [pendingClarification, respondToClarification],
  );

  const handleClarificationSkip = useCallback(() => {
    if (!pendingClarification) return;
    void respondToClarification(pendingClarification.id, {}).catch((err) => {
      console.error('Failed to skip clarification:', err instanceof Error ? err.message : String(err));
    });
  }, [pendingClarification, respondToClarification]);

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
    <div className="flex h-full bg-background">
      {/* Left sidebar - Session list */}
      <div
        className={cn(
          'shrink-0 transition-all duration-200',
          showSidebar ? 'w-72 p-3 pr-2' : 'w-0 overflow-hidden p-0',
        )}
      >
        <div className="h-full overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-sm">
          <SessionList
            sessions={sessions}
            currentId={currentSessionId}
            onSelect={handleSelectSession}
            onCreate={handleCreateSession}
            onDelete={handleDeleteSession}
            worktrees={worktrees}
            currentWorktreePath={currentSession?.workDirectory ?? null}
            onWorktreeRefresh={handleWorktreeRefresh}
            onWorktreeCreate={handleWorktreeCreate}
            onWorktreeDelete={handleWorktreeDelete}
            onWorktreeStartChat={handleWorktreeStartChat}
            defaultWorktreeBase={currentSession?.workDirectory ?? defaultWorkDirectory ?? null}
          />
        </div>
      </div>

      {/* Center: Chat panel */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <div className="mx-4 mb-2 mt-4 flex shrink-0 items-center justify-between gap-2 rounded-2xl border border-border/70 bg-card/80 px-3 py-2 shadow-sm">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={() => setShowSidebar(!showSidebar)}
              title={showSidebar ? '隐藏侧栏' : '显示侧栏'}
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
              <SelectTrigger className="h-9 w-44 rounded-lg border-border/70 bg-background/80 text-xs shadow-none">
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
                <SelectTrigger className="h-9 w-56 rounded-lg border-border/70 bg-background/80 text-xs shadow-none">
                  <SelectValue placeholder="选择模型..." />
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
              className="h-8 w-8 rounded-lg"
              onClick={() => setShowReviewPanel(!showReviewPanel)}
              title={showReviewPanel ? '隐藏评审面板' : '显示评审面板'}
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
        {pendingClarification && (
          <ClarificationDialog
            clarification={pendingClarification}
            onSubmit={handleClarificationSubmit}
            onSkip={handleClarificationSkip}
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
        {currentAgentType === 'design' && currentPreviewUrl ? (
          <DesignPreview url={currentPreviewUrl} className="h-full rounded-none border-0" />
        ) : (
          <ReviewPanel />
        )}
      </div>
    </div>
  );
}
