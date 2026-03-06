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

export interface ChatAttachment {
  type: 'image';
  mimeType: string;
  data: string;
  name?: string;
  size?: number;
  url?: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: ChatAttachment[];
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

export interface ClarificationRequest {
  id: string;
  sessionId: string;
  questions: string[];
  timestamp: number;
  expiresAt?: number;
}

interface ChatState {
  sessions: ChatSession[];
  currentSessionId: string | null;
  messages: ChatMessage[];
  previewUrls: Record<string, string>;
  isStreaming: boolean;
  pendingApproval: ApprovalRequest | null;
  pendingClarification: ClarificationRequest | null;

  // Actions
  loadSessions: () => Promise<void>;
  createSession: (title: string, agentType?: string, workDir?: string) => Promise<string>;
  selectSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  sendMessage: (content: string, attachments?: ChatAttachment[]) => Promise<void>;
  abortGeneration: () => Promise<void>;
  switchModel: (providerId: string, modelId: string) => Promise<void>;
  appendStreamDelta: (delta: string) => void;
  addToolCall: (toolCall: ToolCallInfo) => void;
  updateToolCall: (toolCallId: string, updates: Partial<ToolCallInfo>) => void;
  setApproval: (approval: ApprovalRequest | null) => void;
  respondToApproval: (approvalId: string, approved: boolean) => Promise<void>;
  respondToClarification: (clarificationId: string, answers: Record<string, string>) => Promise<void>;
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
  let attachments: ChatAttachment[] | undefined;
  const rawAttachments = raw.attachments;
  if (typeof rawAttachments === 'string' && rawAttachments.trim()) {
    try {
      const parsed = JSON.parse(rawAttachments) as unknown;
      if (Array.isArray(parsed)) {
        attachments = parsed.filter((item): item is ChatAttachment => {
          if (!item || typeof item !== 'object') return false;
          const record = item as Record<string, unknown>;
          return record.type === 'image' && typeof record.mimeType === 'string'
            && (typeof record.data === 'string' || typeof record.url === 'string');
        });
      }
    } catch {
      // keep undefined for malformed persisted data
    }
  } else if (Array.isArray(rawAttachments)) {
    attachments = rawAttachments.filter((item): item is ChatAttachment => {
      if (!item || typeof item !== 'object') return false;
      const record = item as Record<string, unknown>;
      return record.type === 'image' && typeof record.mimeType === 'string'
        && (typeof record.data === 'string' || typeof record.url === 'string');
    });
  }

  return {
    id: String(raw.id ?? makeId()),
    sessionId: String(raw.session_id ?? raw.sessionId ?? ''),
    role: (raw.role as 'user' | 'assistant' | 'system') ?? 'assistant',
    content: String(raw.content ?? ''),
    attachments,
    modelUsed: (raw.model_used as string | null) ?? (raw.modelUsed as string | undefined) ?? undefined,
    createdAt: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
  };
}

// ── Store ───────────────────────────────────────────────────────────

export const useChatStore = create<ChatState>((set, get) => {
  // Listener cleanup handle kept in closure
  let streamCleanup: (() => void) | undefined;
  let approvalCleanup: (() => void) | undefined;
  let clarificationExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingStreamDelta = '';
  let streamDeltaFlushTimer: ReturnType<typeof setTimeout> | undefined;

  function flushPendingStreamDelta() {
    if (!pendingStreamDelta) return;
    const delta = pendingStreamDelta;
    pendingStreamDelta = '';
    set((state) => {
      const lastIdx = state.messages.length - 1;
      const last = state.messages[lastIdx];
      if (!last || !last.isStreaming) return state;
      const messages = [...state.messages];
      messages[lastIdx] = { ...last, content: last.content + delta };
      return { messages };
    });
  }

  function scheduleStreamDeltaFlush() {
    if (streamDeltaFlushTimer) return;
    streamDeltaFlushTimer = setTimeout(() => {
      streamDeltaFlushTimer = undefined;
      flushPendingStreamDelta();
    }, 16);
  }

  function clearPendingStreamDelta() {
    if (streamDeltaFlushTimer) {
      clearTimeout(streamDeltaFlushTimer);
      streamDeltaFlushTimer = undefined;
    }
    pendingStreamDelta = '';
  }

  function clearClarificationExpiryTimer() {
    if (clarificationExpiryTimer) {
      clearTimeout(clarificationExpiryTimer);
      clarificationExpiryTimer = undefined;
    }
  }

  function scheduleClarificationExpiry(
    clarificationId: string,
    expiresAt?: number,
  ) {
    clearClarificationExpiryTimer();
    if (!expiresAt) return;
    const delay = Math.max(0, expiresAt - Date.now());
    clarificationExpiryTimer = setTimeout(() => {
      clarificationExpiryTimer = undefined;
      set((state) => (
        state.pendingClarification?.id === clarificationId
          ? { pendingClarification: null }
          : {}
      ));
    }, delay);
  }

  // Register global listeners once
  function ensureListeners() {
    if (!streamCleanup) {
      streamCleanup = ipc.onChatStream((event) => {
        if (!event || typeof event !== 'object') return;

        const streamEvent = event as Record<string, unknown>;
        const eventSessionId = typeof streamEvent.sessionId === 'string' ? streamEvent.sessionId : null;
        const activeSessionId = get().currentSessionId;

        // Ignore events from other sessions to avoid cross-session stream pollution.
        if (eventSessionId && activeSessionId && eventSessionId !== activeSessionId) {
          return;
        }

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
        } else if (event.type === 'preview_ready') {
          const previewUrl = typeof event.previewUrl === 'string' ? event.previewUrl : '';
          const targetSessionId = typeof streamEvent.sessionId === 'string'
            ? streamEvent.sessionId
            : get().currentSessionId;
          if (previewUrl && targetSessionId) {
            set((s) => {
              if (s.previewUrls[targetSessionId] === previewUrl) return s;
              return {
                previewUrls: {
                  ...s.previewUrls,
                  [targetSessionId]: previewUrl,
                },
              };
            });
          }
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
            const nextApproval = {
              id: approvalData.approvalId,
              sessionId: approvalData.sessionId ?? '',
              action: approvalData.action ?? 'shell-command',
              details: approvalData.details ?? '',
              timestamp: approvalData.timestamp ?? Date.now(),
            };
            set((s) => {
              const current = s.pendingApproval;
              if (
                current
                && current.id === nextApproval.id
                && current.sessionId === nextApproval.sessionId
                && current.action === nextApproval.action
                && current.details === nextApproval.details
                && current.timestamp === nextApproval.timestamp
              ) {
                return s;
              }
              return { pendingApproval: nextApproval };
            });
          }
        } else if (event.type === 'clarification_req') {
          const clarificationData = event as unknown as {
            clarificationId?: string;
            questions?: string[];
            sessionId?: string;
            timestamp?: number;
            clarificationExpiresAt?: number;
          };
          if (clarificationData.clarificationId && Array.isArray(clarificationData.questions)) {
            const questions = clarificationData.questions
              .filter((q): q is string => typeof q === 'string')
              .map((q) => q.trim())
              .filter((q) => q.length > 0);
            if (questions.length > 0) {
              const resolvedSessionId = clarificationData.sessionId ?? eventSessionId ?? '';
              const expiresAt = typeof clarificationData.clarificationExpiresAt === 'number'
                ? clarificationData.clarificationExpiresAt
                : undefined;
              set({
                pendingClarification: {
                  id: clarificationData.clarificationId,
                  sessionId: resolvedSessionId,
                  questions,
                  timestamp: clarificationData.timestamp ?? Date.now(),
                  expiresAt,
                },
              });
              scheduleClarificationExpiry(clarificationData.clarificationId, expiresAt);
            }
          }
        } else if (event.type === 'turn_end') {
          flushPendingStreamDelta();
          clearClarificationExpiryTimer();
          set((s) => {
            if (!s.isStreaming && !s.pendingClarification && !s.messages.some((m) => m.isStreaming)) {
              return s;
            }
            const messages = s.messages.map((m) =>
              m.isStreaming ? { ...m, isStreaming: false } : m,
            );
            return { isStreaming: false, messages, pendingClarification: null };
          });
        } else if (event.type === 'error') {
          flushPendingStreamDelta();
          clearClarificationExpiryTimer();
          set((s) => {
            if (!s.messages.some((m) => m.isStreaming)) {
              if (!s.isStreaming && !s.pendingClarification) return s;
              return { isStreaming: false, pendingClarification: null };
            }
            const messages = s.messages.map((m) =>
              m.isStreaming
                ? { ...m, isStreaming: false, content: m.content + `\n\n[Error: ${(event.errorMessage ?? event.content) as string ?? 'Unknown error'}]` }
                : m,
            );
            return { isStreaming: false, messages, pendingClarification: null };
          });
        }
      });
    }

    if (!approvalCleanup) {
      approvalCleanup = ipc.onApprovalRequest((request) => {
        const activeSessionId = get().currentSessionId;
        if (request?.sessionId && activeSessionId && request.sessionId !== activeSessionId) {
          return;
        }
        set((s) => {
          const current = s.pendingApproval;
          if (
            current?.id === request?.id
            && current?.sessionId === request?.sessionId
            && current?.action === request?.action
            && current?.details === request?.details
            && current?.timestamp === request?.timestamp
          ) {
            return s;
          }
          return { pendingApproval: request };
        });
      });
    }
  }

  // Kick off listeners immediately
  ensureListeners();

  return {
    sessions: [],
    currentSessionId: null,
    messages: [],
    previewUrls: {},
    isStreaming: false,
    pendingApproval: null,
    pendingClarification: null,

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
      clearPendingStreamDelta();
      clearClarificationExpiryTimer();
      set({
        currentSessionId: sessionId,
        messages: [],
        isStreaming: false,
        pendingClarification: null,
      });

      const history = await ipc.chatHistory(sessionId);
      set({ messages: (history as unknown as Record<string, unknown>[]).map(normalizeMessage) });
    },

    deleteSession: async (sessionId) => {
      clearPendingStreamDelta();
      await ipc.deleteSession(sessionId);
      set((state) => {
        const sessions = state.sessions.filter((s) => s.id !== sessionId);
        const isCurrent = state.currentSessionId === sessionId;
        const nextPreviewUrls = { ...state.previewUrls };
        delete nextPreviewUrls[sessionId];
        return {
          sessions,
          currentSessionId: isCurrent ? (sessions[0]?.id ?? null) : state.currentSessionId,
          messages: isCurrent ? [] : state.messages,
          previewUrls: nextPreviewUrls,
          pendingClarification: isCurrent ? null : state.pendingClarification,
        };
      });
      const currentPending = get().pendingClarification;
      if (currentPending?.sessionId === sessionId) {
        clearClarificationExpiryTimer();
        set({ pendingClarification: null });
      }
    },

    sendMessage: async (content, attachments = []) => {
      const { currentSessionId, sessions } = get();
      if (!currentSessionId) {
        throw new Error('No active session');
      }
      const text = content.trim();
      const safeAttachments = attachments.filter((a) => a.type === 'image' && a.mimeType && a.data);
      if (!text && safeAttachments.length === 0) {
        throw new Error('Message content or attachments is required');
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
        content: text,
        attachments: safeAttachments.length > 0 ? safeAttachments : undefined,
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
        await ipc.sendMessage(currentSessionId, text, {
          agentType: currentAgentType,
          mode,
          cliBackend,
          providerId,
          modelId,
          workDirectory: session?.workDirectory,
          attachments: safeAttachments.length > 0 ? safeAttachments : undefined,
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
      flushPendingStreamDelta();
      const { currentSessionId } = get();
      if (currentSessionId) {
        await ipc.abortChat(currentSessionId);
      }
      set((state) => {
        if (!state.isStreaming && !state.messages.some((m) => m.isStreaming)) {
          return state;
        }
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
          sessions: state.sessions.map((s) => {
            if (s.id !== currentSessionId) return s;
            const nextModel = `${providerId}/${modelId}`;
            if (s.currentModel === nextModel) return s;
            return { ...s, currentModel: nextModel };
          }),
        }));
      } catch (err) {
        console.error('[Chat] switchModel failed:', err instanceof Error ? err.message : String(err));
        throw err;
      }
    },

    appendStreamDelta: (delta) => {
      pendingStreamDelta += delta;
      scheduleStreamDeltaFlush();
    },

    addToolCall: (toolCall) => {
      set((state) => {
        const lastIdx = state.messages.length - 1;
        const last = state.messages[lastIdx];
        if (!last || !last.isStreaming) return state;
        const messages = [...state.messages];
        const existing = last.toolCalls ?? [];
        messages[lastIdx] = { ...last, toolCalls: [...existing, toolCall] };
        return { messages };
      });
    },

    updateToolCall: (toolCallId, updates) => {
      set((state) => {
        const lastIdx = state.messages.length - 1;
        const last = state.messages[lastIdx];
        if (!last?.toolCalls || last.toolCalls.length === 0) return state;
        let changed = false;
        const toolCalls = last.toolCalls.map((tc) => {
          if (tc.id !== toolCallId) return tc;
          changed = true;
          return { ...tc, ...updates };
        });
        if (!changed) return state;
        const messages = [...state.messages];
        messages[lastIdx] = { ...last, toolCalls };
        return { messages };
      });
    },

    setApproval: (approval) => {
      set((state) => {
        const current = state.pendingApproval;
        if (
          current?.id === approval?.id
          && current?.sessionId === approval?.sessionId
          && current?.action === approval?.action
          && current?.details === approval?.details
          && current?.timestamp === approval?.timestamp
        ) {
          return state;
        }
        return { pendingApproval: approval };
      });
    },

    respondToApproval: async (approvalId, approved) => {
      await ipc.respondApproval(approvalId, approved);
      set({ pendingApproval: null });
    },

    respondToClarification: async (clarificationId, answers) => {
      const state = get();
      let clearPending = false;
      try {
        await ipc.respondClarification({
          clarificationId,
          sessionId: state.currentSessionId ?? undefined,
          answers,
        });
        clearPending = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/not found|expired|session mismatch/i.test(message)) {
          clearPending = true;
          console.warn('[Chat] clarification response ignored:', message);
          return;
        }
        throw err;
      } finally {
        if (clearPending) {
          clearClarificationExpiryTimer();
          set((current) => (
            current.pendingClarification?.id === clarificationId
              ? { pendingClarification: null }
              : {}
          ));
        }
      }
    },

    setCurrentSessionAgent: (agentType) => {
      const { currentSessionId } = get();
      if (!currentSessionId) return;
      const defaultModel = useProvidersStore
        .getState()
        .agentDefaults
        .find((d) => d.agentType === agentType)?.primaryModel;
      set((state) => ({
        sessions: state.sessions.map((s) => {
          if (s.id !== currentSessionId) return s;
          const nextModel = defaultModel && defaultModel.includes('/') ? defaultModel : s.currentModel;
          if (s.agentId === agentType && s.currentModel === nextModel) return s;
          return {
            ...s,
            agentId: agentType,
            currentModel: nextModel,
          };
        }),
      }));
    },
  };
});
