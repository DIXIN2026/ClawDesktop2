import { create } from 'zustand';
import { ipc } from '../services/ipc';
import { useGitStore } from './git';
import { useAgentsStore } from './agents';
import { useProvidersStore } from './providers';

// ── Types ──────────────────────────────────────────────────────────

export interface ToolCallInfo {
  id: string;
  name: string;
  input?: Record<string, unknown>;
  output?: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  modelUsed?: string;
  toolCalls?: ToolCallInfo[];
  isStreaming?: boolean;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string;
  agentId?: string;
  taskId?: string;
  workDirectory?: string;
  currentModel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  action: string;
  details: string;
  timestamp: number;
}

interface ChatState {
  sessions: ChatSession[];
  currentSessionId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  pendingApproval: ApprovalRequest | null;

  // Actions
  loadSessions: () => Promise<void>;
  createSession: (title: string, agentType?: string, workDir?: string) => Promise<string>;
  selectSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  abortGeneration: () => Promise<void>;
  switchModel: (providerId: string, modelId: string) => Promise<void>;
  appendStreamDelta: (delta: string) => void;
  addToolCall: (toolCall: ToolCallInfo) => void;
  updateToolCall: (toolCallId: string, updates: Partial<ToolCallInfo>) => void;
  setApproval: (approval: ApprovalRequest | null) => void;
  respondToApproval: (approvalId: string, approved: boolean) => Promise<void>;
  setCurrentSessionAgent: (agentType: 'coding' | 'requirements' | 'design' | 'testing') => void;
}

// ── Helpers ─────────────────────────────────────────────────────────

function makeId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeSession(raw: Record<string, unknown>): ChatSession {
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? 'New Session'),
    agentId: (raw.agent_id as string | null) ?? (raw.agentId as string | undefined),
    taskId: (raw.task_id as string | null) ?? (raw.taskId as string | undefined),
    workDirectory: (raw.work_directory as string | null) ?? (raw.workDirectory as string | undefined),
    currentModel: (raw.current_model as string | null) ?? (raw.currentModel as string | undefined),
    createdAt: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
    updatedAt: String(raw.updated_at ?? raw.updatedAt ?? new Date().toISOString()),
  };
}

function normalizeMessage(raw: Record<string, unknown>): ChatMessage {
  return {
    id: String(raw.id ?? makeId()),
    sessionId: String(raw.session_id ?? raw.sessionId ?? ''),
    role: (raw.role as 'user' | 'assistant' | 'system') ?? 'assistant',
    content: String(raw.content ?? ''),
    modelUsed: (raw.model_used as string | null) ?? (raw.modelUsed as string | undefined) ?? undefined,
    createdAt: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
  };
}

// ── Store ───────────────────────────────────────────────────────────

export const useChatStore = create<ChatState>((set, get) => {
  // Listener cleanup handle kept in closure
  let streamCleanup: (() => void) | undefined;
  let approvalCleanup: (() => void) | undefined;

  // Register global listeners once
  function ensureListeners() {
    if (!streamCleanup) {
      streamCleanup = ipc.onChatStream((event) => {
        const state = get();

        if (event.type === 'text_delta' && typeof event.content === 'string') {
          state.appendStreamDelta(event.content);
        } else if (event.type === 'tool_start') {
          const toolCall: ToolCallInfo = {
            id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name: (event.toolName as string) ?? 'unknown',
            input: event.toolInput as Record<string, unknown> | undefined,
            status: 'running',
          };
          state.addToolCall(toolCall);
        } else if (event.type === 'tool_end') {
          // Find the last running tool call and mark it completed
          const msgs = get().messages;
          const lastMsg = msgs[msgs.length - 1];
          const tcs = lastMsg?.toolCalls ?? [];
          const runningTc = [...tcs].reverse().find((tc: ToolCallInfo) => tc.status === 'running');
          if (runningTc) {
            state.updateToolCall(runningTc.id, {
              status: 'completed',
              output: event.content as string | undefined,
            });
          }
        } else if (event.type === 'tool_output') {
          // Update the last running tool call with output
          const msgs = get().messages;
          const lastMsg = msgs[msgs.length - 1];
          const tcs2 = lastMsg?.toolCalls ?? [];
          const runningTc = [...tcs2].reverse().find((tc: ToolCallInfo) => tc.status === 'running');
          if (runningTc) {
            state.updateToolCall(runningTc.id, {
              output: event.content as string | undefined,
            });
          }
        } else if (event.type === 'file_changed') {
          // Refresh git status so ReviewPanel/DiffViewer auto-update
          useGitStore.getState().refreshStatus().catch(() => {
            // Silently ignore — git status refresh is best-effort
          });
        } else if (event.type === 'approval_req') {
          // Surface approval request from agent stream
          const approvalData = event as unknown as {
            approvalId?: string;
            sessionId?: string;
            action?: string;
            details?: string;
            timestamp?: number;
          };
          if (approvalData.approvalId) {
            set({
              pendingApproval: {
                id: approvalData.approvalId,
                sessionId: approvalData.sessionId ?? '',
                action: approvalData.action ?? 'shell-command',
                details: approvalData.details ?? '',
                timestamp: approvalData.timestamp ?? Date.now(),
              },
            });
          }
        } else if (event.type === 'turn_end') {
          set((s) => {
            const messages = s.messages.map((m) =>
              m.isStreaming ? { ...m, isStreaming: false } : m,
            );
            return { isStreaming: false, messages };
          });
        } else if (event.type === 'error') {
          set((s) => {
            const messages = s.messages.map((m) =>
              m.isStreaming
                ? { ...m, isStreaming: false, content: m.content + `\n\n[Error: ${(event.errorMessage ?? event.content) as string ?? 'Unknown error'}]` }
                : m,
            );
            return { isStreaming: false, messages };
          });
        }
      });
    }

    if (!approvalCleanup) {
      approvalCleanup = ipc.onApprovalRequest((request) => {
        set({ pendingApproval: request });
      });
    }
  }

  // Kick off listeners immediately
  ensureListeners();

  return {
    sessions: [],
    currentSessionId: null,
    messages: [],
    isStreaming: false,
    pendingApproval: null,

    loadSessions: async () => {
      const sessions = (await ipc.listSessions()) as unknown as Record<string, unknown>[];
      set({ sessions: sessions.map(normalizeSession) });
    },

    createSession: async (title, agentType, workDir) => {
      const resolvedAgentType = (agentType ?? useAgentsStore.getState().currentAgentType) as ChatSession['agentId'];
      const defaultModel = useProvidersStore
        .getState()
        .agentDefaults
        .find((d) => d.agentType === resolvedAgentType)?.primaryModel;

      const result = await ipc.createSession({
        title,
        agentId: resolvedAgentType,
        workDirectory: workDir,
        currentModel: defaultModel || undefined,
      });
      const sessionId = result.sessionId;

      const session: ChatSession = {
        id: sessionId,
        title,
        agentId: resolvedAgentType,
        workDirectory: workDir,
        currentModel: defaultModel || undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      set((state) => ({
        sessions: [session, ...state.sessions],
        currentSessionId: sessionId,
        messages: [],
      }));

      return sessionId;
    },

    selectSession: async (sessionId) => {
      set({ currentSessionId: sessionId, messages: [], isStreaming: false });

      const history = await ipc.chatHistory(sessionId);
      set({ messages: (history as unknown as Record<string, unknown>[]).map(normalizeMessage) });
    },

    deleteSession: async (sessionId) => {
      await ipc.deleteSession(sessionId);
      set((state) => {
        const sessions = state.sessions.filter((s) => s.id !== sessionId);
        const isCurrent = state.currentSessionId === sessionId;
        return {
          sessions,
          currentSessionId: isCurrent ? (sessions[0]?.id ?? null) : state.currentSessionId,
          messages: isCurrent ? [] : state.messages,
        };
      });
    },

    sendMessage: async (content) => {
      const { currentSessionId, sessions } = get();
      if (!currentSessionId) {
        throw new Error('No active session');
      }
      const session = sessions.find((s) => s.id === currentSessionId);
      const currentAgentType = (useAgentsStore.getState().currentAgentType ?? session?.agentId ?? 'coding') as
        'coding' | 'requirements' | 'design' | 'testing';
      const providerState = useProvidersStore.getState();
      const fallbackAgentModel =
        providerState.agentDefaults.find((d) => d.agentType === currentAgentType)?.primaryModel || undefined;
      const currentModel = session?.currentModel || fallbackAgentModel;
      const [providerId, modelId] = currentModel ? currentModel.split('/') : [undefined, undefined];
      const cliBackend = providerState.selectedCliBackend ?? undefined;
      const mode: 'cli' | 'api' = providerId && modelId ? 'api' : 'cli';

      // 1. Add user message optimistically
      const userMessage: ChatMessage = {
        id: makeId(),
        sessionId: currentSessionId,
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      };

      // 2. Create placeholder assistant message for streaming
      const assistantMessage: ChatMessage = {
        id: makeId(),
        sessionId: currentSessionId,
        role: 'assistant',
        content: '',
        isStreaming: true,
        createdAt: new Date().toISOString(),
      };

      set((state) => ({
        messages: [...state.messages, userMessage, assistantMessage],
        isStreaming: true,
      }));

      // 3. Send via IPC — stream events handled by the listener
      try {
        await ipc.sendMessage(currentSessionId, content, {
          agentType: currentAgentType,
          mode,
          cliBackend,
          providerId,
          modelId,
          workDirectory: session?.workDirectory,
        });
      } catch (err) {
        set((state) => {
          const messages = state.messages.map((m) =>
            m.id === assistantMessage.id
              ? { ...m, isStreaming: false, content: `[Error: ${err instanceof Error ? err.message : String(err)}]` }
              : m,
          );
          return { isStreaming: false, messages };
        });
      }
    },

    abortGeneration: async () => {
      const { currentSessionId } = get();
      if (currentSessionId) {
        await ipc.abortChat(currentSessionId);
      }
      set((state) => {
        const messages = state.messages.map((m) =>
          m.isStreaming ? { ...m, isStreaming: false, content: m.content + '\n\n[Aborted]' } : m,
        );
        return { isStreaming: false, messages };
      });
    },

    switchModel: async (providerId, modelId) => {
      const { currentSessionId } = get();
      if (!currentSessionId) return;

      try {
        await ipc.switchModel(currentSessionId, providerId, modelId);
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === currentSessionId ? { ...s, currentModel: `${providerId}/${modelId}` } : s,
          ),
        }));
      } catch (err) {
        console.error('[Chat] switchModel failed:', err instanceof Error ? err.message : String(err));
        throw err;
      }
    },

    appendStreamDelta: (delta) => {
      set((state) => {
        const messages = [...state.messages];
        const lastIdx = messages.length - 1;
        const last = messages[lastIdx];
        if (last && last.isStreaming) {
          messages[lastIdx] = { ...last, content: last.content + delta };
        }
        return { messages };
      });
    },

    addToolCall: (toolCall) => {
      set((state) => {
        const messages = [...state.messages];
        const lastIdx = messages.length - 1;
        const last = messages[lastIdx];
        if (last && last.isStreaming) {
          const existing = last.toolCalls ?? [];
          messages[lastIdx] = { ...last, toolCalls: [...existing, toolCall] };
        }
        return { messages };
      });
    },

    updateToolCall: (toolCallId, updates) => {
      set((state) => {
        const messages = [...state.messages];
        const lastIdx = messages.length - 1;
        const last = messages[lastIdx];
        if (last?.toolCalls) {
          const toolCalls = last.toolCalls.map((tc) =>
            tc.id === toolCallId ? { ...tc, ...updates } : tc,
          );
          messages[lastIdx] = { ...last, toolCalls };
        }
        return { messages };
      });
    },

    setApproval: (approval) => {
      set({ pendingApproval: approval });
    },

    respondToApproval: async (approvalId, approved) => {
      await ipc.respondApproval(approvalId, approved);
      set({ pendingApproval: null });
    },

    setCurrentSessionAgent: (agentType) => {
      const { currentSessionId } = get();
      if (!currentSessionId) return;
      const defaultModel = useProvidersStore
        .getState()
        .agentDefaults
        .find((d) => d.agentType === agentType)?.primaryModel;
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === currentSessionId
            ? {
                ...s,
                agentId: agentType,
                currentModel: defaultModel && defaultModel.includes('/') ? defaultModel : s.currentModel,
              }
            : s,
        ),
      }));
    },
  };
});
