/**
 * IPC Service Layer
 * Type-safe IPC call wrappers
 */

import type { ChatMessage, ChatSession, ApprovalRequest } from '../stores/chat';
import type { AgentConfig } from '../stores/agents';
import type { GitStatus } from '../stores/git';

// ── Re-usable types from providers store (avoid circular import) ──

interface ModelDefinition {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: {
    reasoning: boolean;
    vision: boolean;
    codeGen: boolean;
    toolUse: boolean;
  };
  costPerMillionInput: number;
  costPerMillionOutput: number;
}

interface ProviderConfig {
  id: string;
  name: string;
  accessType: 'local-cli' | 'api-key' | 'coding-plan';
  apiProtocol: 'openai-compatible' | 'anthropic-messages' | 'ollama';
  baseUrl: string;
  envVar: string;
  models: ModelDefinition[];
  status: 'available' | 'unconfigured' | 'error';
  isBuiltin: boolean;
  icon?: string;
  region?: 'global' | 'cn';
}

interface CliAgentBackend {
  id: string;
  name: string;
  command: string;
  installed: boolean;
  version?: string;
}

/** Board types */
interface BoardState {
  id: string;
  name: string;
  color: string;
  category: string;
  sort_order: number | null;
  allow_new_items: number;
}

interface BoardIssue {
  id: string;
  title: string;
  description: string | null;
  state_id: string;
  priority: string;
  assignee: string | null;
  labels: string | null;
  parent_id: string | null;
  estimate_points: number | null;
  start_date: string | null;
  target_date: string | null;
  issue_type: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** Generic shape of coding-agent stream events */
interface CodingAgentEvent {
  type: string;
  delta?: string;
  toolCall?: Record<string, unknown>;
  toolCallId?: string;
  updates?: Record<string, unknown>;
  error?: string;
  [key: string]: unknown;
}

interface ChatSendOptions {
  mode?: 'cli' | 'api';
  cliBackend?: string;
  providerId?: string;
  modelId?: string;
  agentType?: 'coding' | 'requirements' | 'design' | 'testing';
  workDirectory?: string;
}

// ── IPC envelope ────────────────────────────────────────────────────

interface IpcResponse<T = unknown> {
  success: boolean;
  result?: T;
  error?: string;
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.electron) {
    throw new Error('Electron IPC not available');
  }
  const response = await window.electron.ipcRenderer.invoke(channel, ...args);

  // If response follows envelope pattern
  if (response && typeof response === 'object' && 'success' in (response as Record<string, unknown>)) {
    const envelope = response as IpcResponse<T>;
    if (!envelope.success) {
      throw new Error(envelope.error ?? 'IPC call failed');
    }
    return envelope.result as T;
  }

  // Direct return
  return response as T;
}

// ── Exported service ────────────────────────────────────────────────

export const ipc = {
  invoke,

  // ─── Engine ───────────────────────────────────────────────────────
  engineStatus: () => invoke<{ status: string }>('engine:status'),

  // ─── Settings ─────────────────────────────────────────────────────
  getSetting: (key: string) => invoke<unknown>('settings:get', key),
  setSetting: (key: string, value: unknown) => invoke<boolean>('settings:set', key, value),

  // ─── Providers ────────────────────────────────────────────────────
  listProviders: () => invoke<ProviderConfig[]>('providers:list'),
  discoverProviders: () => invoke<{ providers: ProviderConfig[]; cliAgents: CliAgentBackend[] }>('providers:discover'),
  getProvider: (id: string) => invoke<ProviderConfig>('providers:get', id),
  saveProvider: (config: ProviderConfig) => invoke<boolean>('providers:save', config),
  deleteProvider: (id: string) => invoke<boolean>('providers:delete', id),
  setApiKey: (providerId: string, apiKey: string) => invoke<boolean>('providers:setApiKey', providerId, apiKey),
  deleteApiKey: (providerId: string) => invoke<boolean>('providers:deleteApiKey', providerId),
  hasApiKey: (providerId: string) => invoke<boolean>('providers:hasApiKey', providerId),
  getApiKeyMasked: (providerId: string) => invoke<string | null>('providers:getApiKeyMasked', providerId),
  providerModels: (providerId: string) => invoke<ModelDefinition[]>('providers:models', providerId),
  providerHealth: (providerId: string) => invoke<{ healthy: boolean }>('providers:health', providerId),
  cliStatus: () => invoke<CliAgentBackend[]>('providers:cli-status'),

  // ─── Sessions ─────────────────────────────────────────────────────
  listSessions: () => invoke<ChatSession[]>('sessions:list'),
  createSession: (params?: {
    title?: string;
    agentId?: string;
    workDirectory?: string;
    currentModel?: string;
    taskId?: string;
  }) => invoke<{ sessionId: string }>('sessions:create', params),
  getSession: (id: string) => invoke<ChatSession>('sessions:get', id),
  deleteSession: (id: string) => invoke<boolean>('sessions:delete', id),
  resumeSession: (id: string) => invoke<{ sessionId: string }>('sessions:resume', id),

  // ─── Chat ─────────────────────────────────────────────────────────
  sendMessage: (sessionId: string, content: string, options?: ChatSendOptions) =>
    invoke<{ messageId: string }>('chat:send', sessionId, content, options),
  abortChat: (sessionId: string) => invoke<boolean>('chat:abort', sessionId),
  chatHistory: (sessionId: string) => invoke<ChatMessage[]>('chat:history', sessionId),
  switchModel: (sessionId: string, providerId: string, modelId: string) =>
    invoke<boolean>('chat:switch-model', sessionId, providerId, modelId),

  // ─── Agents ───────────────────────────────────────────────────────
  listAgents: () => invoke<AgentConfig[]>('agents:list'),
  getAgent: (id: string) => invoke<AgentConfig>('agents:get', id),
  updateAgent: (id: string, updates: Record<string, unknown>) => invoke<boolean>('agents:update', id, updates),
  setAgentModel: (agentType: string, providerId: string, modelId: string) =>
    invoke<boolean>('agents:set-model', agentType, providerId, modelId),

  // ─── Git ──────────────────────────────────────────────────────────
  gitStatus: () => invoke<GitStatus>('git:status'),
  gitDiff: (filePath?: string) => invoke<string>('git:diff', filePath),
  gitCommit: (message: string) => invoke<{ commitHash: string }>('git:commit', message),
  gitPush: () => invoke<boolean>('git:push'),
  gitStage: (files: string[]) => invoke<boolean>('git:stage', files),
  gitUnstage: (files: string[]) => invoke<boolean>('git:unstage', files),
  gitRevert: (files: string[]) => invoke<boolean>('git:revert', files),
  gitUndo: () => invoke<boolean>('git:undo'),
  gitRedo: () => invoke<boolean>('git:redo'),

  // ─── Approval ─────────────────────────────────────────────────────
  respondApproval: (approvalId: string, approved: boolean) =>
    invoke<boolean>('approval:response', approvalId, approved),
  getApprovalMode: () => invoke<string>('approval:mode:get'),
  setApprovalMode: (mode: string) => invoke<boolean>('approval:mode:set', mode),

  // ─── Tasks ────────────────────────────────────────────────────────
  listTasks: () => invoke<Record<string, unknown>[]>('tasks:list'),
  createTask: (task: Record<string, unknown>) => invoke<{ taskId: string }>('tasks:create', task),
  updateTask: (id: string, updates: Record<string, unknown>) => invoke<boolean>('tasks:update', id, updates),
  deleteTask: (id: string) => invoke<boolean>('tasks:delete', id),

  // ─── Schedule ─────────────────────────────────────────────────────
  listSchedules: () => invoke<Record<string, unknown>[]>('schedule:list'),
  createSchedule: (schedule: Record<string, unknown>) => invoke<{ id: string }>('schedule:create', schedule),
  toggleSchedule: (id: string, enabled: boolean) => invoke<boolean>('schedule:toggle', id, enabled),
  deleteSchedule: (id: string) => invoke<boolean>('schedule:delete', id),
  scheduleLogs: (taskId: string) => invoke<Record<string, unknown>[]>('schedule:logs', taskId),

  // ─── Skills ───────────────────────────────────────────────────────
  searchSkills: (query: string) => invoke<Record<string, unknown>[]>('skills:search', query),
  installSkill: (id: string) => invoke<boolean>('skills:install', id),
  uninstallSkill: (id: string) => invoke<boolean>('skills:uninstall', id),
  listInstalledSkills: () => invoke<Record<string, unknown>[]>('skills:list'),

  // ─── Channels ─────────────────────────────────────────────────────
  configureChannel: (channelType: string, config: Record<string, unknown>) =>
    invoke<boolean>('channels:config', channelType, config),
  testChannel: (channelType: string) => invoke<{ connected: boolean; error?: string }>('channels:test', channelType),
  listChannels: () => invoke<Record<string, unknown>[]>('channels:list'),
  startChannel: (channelId: string) => invoke<{ started: boolean }>('channels:start', channelId),
  stopChannel: (channelId: string) => invoke<{ stopped: boolean }>('channels:stop', channelId),

  // ─── Mount allowlist ──────────────────────────────────────────────
  mountAllowlistList: () => invoke<string[]>('mount:allowlist:list'),
  mountAllowlistAdd: (path: string) => invoke<boolean>('mount:allowlist:add', path),
  mountAllowlistRemove: (path: string) => invoke<boolean>('mount:allowlist:remove', path),

  // ─── Board (Kanban) ────────────────────────────────────────────────
  boardStates: () => invoke<BoardState[]>('board:states'),
  boardTransitions: () => invoke<{ from_state_id: string; to_state_id: string }[]>('board:transitions'),
  boardIssuesList: (filters?: { stateId?: string; priority?: string; issueType?: string }) =>
    invoke<BoardIssue[]>('board:issues:list', filters),
  boardIssueGet: (id: string) => invoke<BoardIssue | null>('board:issues:get', id),
  boardIssueCreate: (issue: {
    title: string; description?: string; stateId: string;
    priority?: string; assignee?: string; labels?: string[];
    parentId?: string; issueType?: string;
  }) => invoke<{ id: string }>('board:issues:create', issue),
  boardIssueUpdate: (id: string, updates: Record<string, unknown>) =>
    invoke<boolean>('board:issues:update', id, updates),
  boardIssueMove: (id: string, targetStateId: string, sortOrder?: number) =>
    invoke<boolean>('board:issues:move', id, targetStateId, sortOrder ?? 0),
  boardIssueDelete: (id: string) => invoke<boolean>('board:issues:delete', id),
  boardIssueStart: (id: string, title: string, agentType: 'coding' | 'requirements' | 'design' | 'testing' = 'coding') =>
    invoke<{ sessionId: string; branch: string; worktreePath: string }>('board:issues:start', { id, title, agentType }),

  // ─── Orchestrator ───────────────────────────────────────────────────
  executePipeline: (pipeline: Record<string, unknown>) => invoke<{ pipelineId: string }>('orchestrator:execute', pipeline),
  cancelPipeline: (pipelineId: string) => invoke<boolean>('orchestrator:cancel', pipelineId),
  pipelineStatus: (pipelineId: string) => invoke<{ running: boolean }>('orchestrator:status', pipelineId),

  // ─── Memory ────────────────────────────────────────────────────────
  memorySearch: (options: { query: string; maxResults?: number; minScore?: number; sessionId?: string | null }) =>
    invoke<Array<{ chunkId: string; content: string; score: number; source: string; sessionId: string | null; createdAt: string }>>('memory:search', options),
  memoryStats: () =>
    invoke<{ totalChunks: number; totalSummaries: number; chunksWithEmbeddings: number; oldestChunkDate: string | null; newestChunkDate: string | null }>('memory:stats'),
  memoryConfigGet: () =>
    invoke<{ compactRatio: number; keepRecentMessages: number; maxSearchResults: number; embeddingEnabled: boolean; vectorWeight: number; bm25Weight: number }>('memory:config:get'),
  memoryConfigSet: (key: string, value: string | number | boolean) =>
    invoke<boolean>('memory:config:set', key, value),
  memoryDelete: (chunkId: string) => invoke<boolean>('memory:delete', chunkId),
  memoryDeleteSession: (sessionId: string) => invoke<boolean>('memory:delete-session', sessionId),
  memoryReindex: () => invoke<{ indexed: number; reason?: string }>('memory:reindex'),

  // ─── App ──────────────────────────────────────────────────────────
  getVersion: () => invoke<string>('app:version'),
  getPlatform: () => invoke<string>('app:platform'),
  quit: () => invoke<void>('app:quit'),

  // ─── Dialog ───────────────────────────────────────────────────────
  openDirectory: () =>
    invoke<{ canceled: boolean; filePaths: string[] }>('dialog:open', {
      properties: ['openDirectory'],
    }),

  // ─── Window ───────────────────────────────────────────────────────
  minimize: () => window.electron?.ipcRenderer.invoke('window:minimize'),
  maximize: () => window.electron?.ipcRenderer.invoke('window:maximize'),
  close: () => window.electron?.ipcRenderer.invoke('window:close'),

  // ─── Event listeners (main → renderer) ────────────────────────────
  onChatStream: (callback: (event: CodingAgentEvent) => void): (() => void) | undefined => {
    return window.electron?.ipcRenderer.on('chat:stream', (_event: unknown, data: unknown) =>
      callback(data as CodingAgentEvent),
    );
  },

  onApprovalRequest: (callback: (request: ApprovalRequest) => void): (() => void) | undefined => {
    return window.electron?.ipcRenderer.on('approval:request', (_event: unknown, data: unknown) =>
      callback(data as ApprovalRequest),
    );
  },
};
