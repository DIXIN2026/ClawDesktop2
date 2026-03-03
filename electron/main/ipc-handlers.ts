/**
 * IPC Handler Registration Center
 * All IPC handlers registered with unified response envelope
 * Per requirements §4.1
 */
import { ipcMain, dialog, shell, app } from 'electron';
import type { BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  getSetting,
  setSetting,
  listChatSessions,
  createChatSession,
  getChatSession,
  deleteChatSession,
  updateChatSession,
  insertMessage,
  getSessionMessages,
  getAgents,
  getAgent,
  updateAgent,
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  getScheduledTasks,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  getTaskRunLogs,
  setChannelState,
  getChannelState,
  getAgentModelMappings,
  setAgentModelMapping,
  getBoardStates,
  getBoardIssues,
  getBoardIssue,
  createBoardIssue,
  updateBoardIssue,
  deleteBoardIssue,
  moveBoardIssue,
  getBoardTransitions,
} from '../utils/db.js';
import { detectRuntime } from '../engine/container-runtime.js';
import { ProviderRegistry } from '../providers/registry.js';
import { runDiscovery } from '../providers/discovery.js';
import { setAgentModel } from '../providers/router.js';
import { storeApiKey, getApiKey, deleteApiKey, hasApiKey } from '../security/credential.js';
import { searchClawHub, downloadSkillManifest } from '../skills/clawhub.js';
import { WEB_SEARCH_TOOL } from '../skills/builtin/web-search.js';
import { SkillRegistry } from '../skills/registry.js';
import { scanSource } from '../security/skill-scanner.js';
import { getChannelManager } from '../channels/manager.js';
import { parseTasksFromPRD, parseBugsFromTestReport, createBoardIssuesFromTasks } from '../agents/board-integration.js';
import { createApprovalRequest, resolveApproval, setApprovalMode, getApprovalMode } from '../security/approval.js';
import { createAgentExecutor } from '../engine/agent-executor.js';
import type { AgentExecuteOptions } from '../engine/agent-executor.js';
import { getOrchestrator } from '../engine/orchestrator.js';
import type { AgentPipeline } from '../engine/orchestrator.js';
import {
  searchMemory,
  getMemoryStats,
  getMemoryConfig,
  setMemoryConfigValue,
  deleteMemoryChunk,
  deleteSessionMemory,
  getChunksWithoutEmbeddings,
  updateChunkEmbedding,
} from '../memory/index.js';
import { createEmbeddingAdapter, embeddingToBuffer } from '../memory/embedding-adapter.js';
import type { SearchOptions } from '../memory/types.js';
import {
  getGitStatus,
  getGitDiff,
  getGitFileDiff,
  gitCommit,
  gitPush,
  gitStage,
  gitUnstage,
  gitRevert,
  createSnapshot,
  undoToSnapshot,
  redoFromUndo,
  listWorktrees,
  createWorktree,
  removeWorktree,
} from '../engine/git-ops.js';
import { listOllamaModels } from '../providers/adapters/ollama.js';
import type { ProviderConfig } from '../providers/types.js';
import { validateIpcArgs } from '../security/ipc-validators.js';
import { withRateLimit } from '../security/rate-limiter.js';
import { addToAllowlist, removeFromAllowlist, getAllowlist } from '../engine/mount-security.js';
import { registerOrUpdateChannel } from '../channels/registration.js';

// ---------------------------------------------------------------------------
// Module-level singletons
// ---------------------------------------------------------------------------

const registry = new ProviderRegistry();
const agentExecutor = createAgentExecutor();
const skillRegistry = new SkillRegistry();
skillRegistry.loadFromDatabase();

const BUILTIN_SKILL_HANDLERS: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  [WEB_SEARCH_TOOL.name]: WEB_SEARCH_TOOL.handler,
};

// ---------------------------------------------------------------------------
// Response envelope
// ---------------------------------------------------------------------------

interface IpcResponse<T = unknown> {
  success: boolean;
  result?: T;
  error?: string;
  code?: string;
}

function wrapHandler<T>(
  handler: (...args: unknown[]) => Promise<T> | T,
  channel?: string,
): (...args: unknown[]) => Promise<IpcResponse<T>> {
  const wrapped = async (...args: unknown[]) => {
    try {
      // Validate input if schema exists for this channel
      if (channel) {
        validateIpcArgs(channel, args);
      }
      const result = await handler(...args);
      return { success: true, result } as IpcResponse<T>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof Error && 'code' in err ? String((err as Record<string, unknown>).code) : undefined;
      console.error('[IPC ERROR]', message, err instanceof Error ? err.stack : '');
      return { success: false, error: message, code } as IpcResponse<T>;
    }
  };

  // Apply rate limiting if channel is rate-limited
  if (channel) {
    return withRateLimit(channel, wrapped);
  }
  return wrapped;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // Restore persisted agent default model mappings into runtime router.
  for (const mapping of getAgentModelMappings()) {
    if (mapping.agent_type && mapping.provider_id && mapping.model_id) {
      setAgentModel({
        agentType: mapping.agent_type as 'coding' | 'requirements' | 'design' | 'testing',
        providerId: mapping.provider_id,
        modelId: mapping.model_id,
      });
    }
  }

  // --- Engine ---
  ipcMain.handle('engine:status', wrapHandler(() => {
    const runtime = detectRuntime();
    return {
      status: 'idle',
      containerRuntime: runtime.available ? runtime.type : 'none',
      containerVersion: runtime.version,
    };
  }));

  // --- Settings ---
  ipcMain.handle('settings:get', wrapHandler((...args: unknown[]) => {
    const key = args[1] as string;
    return getSetting(key) ?? null;
  }, 'settings:get'));

  ipcMain.handle('settings:set', wrapHandler((...args: unknown[]) => {
    const key = args[1] as string;
    const value = args[2] as string;
    setSetting(key, value);
    return true;
  }, 'settings:set'));

  // --- Mount allowlist ---
  ipcMain.handle('mount:allowlist:list', wrapHandler(() => {
    return getAllowlist();
  }));

  ipcMain.handle('mount:allowlist:add', wrapHandler((...args: unknown[]) => {
    const path = args[1] as string;
    if (!path?.trim()) throw new Error('path is required');
    addToAllowlist(path.trim());
    return true;
  }));

  ipcMain.handle('mount:allowlist:remove', wrapHandler((...args: unknown[]) => {
    const path = args[1] as string;
    if (!path?.trim()) throw new Error('path is required');
    removeFromAllowlist(path.trim());
    return true;
  }));

  // --- Window (wrapped for error safety) ---
  ipcMain.handle('window:minimize', wrapHandler(() => {
    mainWindow.minimize();
  }));

  ipcMain.handle('window:maximize', wrapHandler(() => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }));

  ipcMain.handle('window:close', wrapHandler(() => {
    mainWindow.close();
  }));

  ipcMain.handle('window:isMaximized', wrapHandler(() => {
    return mainWindow.isMaximized();
  }));

  // --- App ---
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:name', () => app.getName());
  ipcMain.handle('app:platform', () => process.platform);

  // Whitelist allowed path names to prevent arbitrary file system probing
  const ALLOWED_PATH_NAMES: ReadonlySet<string> = new Set([
    'userData', 'temp', 'downloads', 'documents', 'desktop', 'home', 'appData',
  ]);

  ipcMain.handle('app:getPath', (_event, name: string) => {
    if (!ALLOWED_PATH_NAMES.has(name)) {
      throw new Error(`Access denied: getPath("${name}") is not in the allowed list`);
    }
    return app.getPath(name as Parameters<typeof app.getPath>[0]);
  });
  ipcMain.handle('app:quit', () => app.quit());

  // --- Dialog ---
  ipcMain.handle('dialog:open', async (_event, options: Electron.OpenDialogOptions) => {
    return dialog.showOpenDialog(mainWindow, options);
  });

  ipcMain.handle('dialog:save', async (_event, options: Electron.SaveDialogOptions) => {
    return dialog.showSaveDialog(mainWindow, options);
  });

  ipcMain.handle('dialog:message', async (_event, options: Electron.MessageBoxOptions) => {
    return dialog.showMessageBox(mainWindow, options);
  });

  // --- Shell ---
  // Only allow http/https URLs to prevent arbitrary protocol handler invocation
  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    if (typeof url !== 'string') {
      throw new Error('URL must be a string');
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Blocked: only http/https URLs are allowed, got "${parsed.protocol}"`);
    }
    return shell.openExternal(url);
  });

  ipcMain.handle('shell:showItemInFolder', (_event, fullPath: string) => {
    shell.showItemInFolder(fullPath);
  });

  // =========================================================================
  // Providers
  // =========================================================================

  ipcMain.handle('providers:list', wrapHandler(() => {
    return registry.getAll();
  }));

  ipcMain.handle('providers:discover', wrapHandler(async () => {
    const result = await runDiscovery();
    // Update registry status for discovered providers
    for (const dp of result.providers) {
      const source = dp.source === 'env' ? 'env' as const
        : dp.source === 'local-service' ? 'local-service' as const
        : 'cli-detect' as const;
      registry.markAvailable(dp.providerId, source);
    }

    // Populate Ollama models dynamically
    if (result.ollamaModels && result.ollamaModels.models.length > 0) {
      const ollamaModelDefs = result.ollamaModels.models.map(m => ({
        id: m.name,
        name: m.name,
        contextWindow: 128000,
        maxOutputTokens: 4096,
        capabilities: { reasoning: true, vision: false, codeGen: true, toolUse: false },
        costPerMillionInput: 0,
        costPerMillionOutput: 0,
      }));
      registry.updateModels('ollama', ollamaModelDefs);
    }

    return result;
  }, 'providers:discover'));

  ipcMain.handle('providers:get', wrapHandler((...args: unknown[]) => {
    const id = args[1] as string;
    return registry.getById(id) ?? null;
  }));

  ipcMain.handle('providers:save', wrapHandler((...args: unknown[]) => {
    // Frontend sends the full config object as args[1]
    const config = args[1] as ProviderConfig;
    if (!config || !config.id) throw new Error('Provider config with id is required');
    const existing = registry.getById(config.id);
    if (existing) {
      registry.update(config.id, config);
    } else {
      registry.add(config);
    }
    return true;
  }));

  ipcMain.handle('providers:delete', wrapHandler((...args: unknown[]) => {
    const id = args[1] as string;
    return registry.remove(id);
  }));

  ipcMain.handle('providers:setApiKey', wrapHandler(async (...args: unknown[]) => {
    const providerId = args[1] as string;
    const apiKey = args[2] as string;
    await storeApiKey(providerId, apiKey);
    registry.markAvailable(providerId, 'manual');
    return true;
  }));

  ipcMain.handle('providers:deleteApiKey', wrapHandler(async (...args: unknown[]) => {
    const providerId = args[1] as string;
    await deleteApiKey(providerId);
    registry.update(providerId, { status: 'unconfigured' });
    return true;
  }));

  ipcMain.handle('providers:hasApiKey', wrapHandler(async (...args: unknown[]) => {
    const providerId = args[1] as string;
    return hasApiKey(providerId);
  }));

  // providers:getApiKey removed — API keys must never be sent to the renderer process.
  // Use providers:hasApiKey instead. For display, we provide a masked version.
  ipcMain.handle('providers:getApiKeyMasked', wrapHandler(async (...args: unknown[]) => {
    const providerId = args[1] as string;
    const key = await getApiKey(providerId);
    if (!key) return null;
    // Return only the last 4 chars, masked
    return key.length > 4 ? `${'*'.repeat(key.length - 4)}${key.slice(-4)}` : '****';
  }));

  ipcMain.handle('providers:setDefault', wrapHandler((...args: unknown[]) => {
    const agentType = args[1] as 'coding' | 'requirements' | 'design' | 'testing';
    const providerId = args[2] as string;
    const modelId = args[3] as string;
    setAgentModel({ agentType, providerId, modelId });
    setAgentModelMapping({
      id: `mapping-${agentType}`,
      agentType,
      providerId,
      modelId,
    });
    return true;
  }));

  ipcMain.handle('providers:configure', wrapHandler((...args: unknown[]) => {
    const id = args[1] as string;
    const config = args[2] as Partial<ProviderConfig>;
    registry.update(id, config);
    return true;
  }, 'providers:configure'));

  ipcMain.handle('providers:models', wrapHandler(async (...args: unknown[]) => {
    const providerId = args[1] as string;
    const provider = registry.getById(providerId);
    if (!provider) return [];

    if (provider.apiProtocol === 'ollama') {
      try {
        const ollamaModels = await listOllamaModels(provider.baseUrl);
        return ollamaModels.map(m => ({
          id: m.name,
          name: m.name,
          size: m.size,
          digest: m.digest,
          modified_at: m.modified_at,
        }));
      } catch (err) {
        console.warn('[IPC] Ollama model listing failed:', err instanceof Error ? err.message : String(err));
        return [];
      }
    }

    return provider.models;
  }));

  ipcMain.handle('providers:health', wrapHandler(async (...args: unknown[]) => {
    const providerId = args[1] as string;
    const provider = registry.getById(providerId);
    if (!provider) return { healthy: false, error: 'Provider not found' };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(provider.baseUrl, { signal: controller.signal });
      clearTimeout(timeout);
      return { healthy: response.ok, statusCode: response.status };
    } catch (err) {
      return {
        healthy: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, 'providers:health'));

  ipcMain.handle('providers:cli-status', wrapHandler(async () => {
    const result = await runDiscovery();
    return result.cliAgents;
  }));

  // =========================================================================
  // Sessions
  // =========================================================================

  ipcMain.handle('sessions:list', wrapHandler(() => {
    return listChatSessions().map((s) => ({
      id: s.id,
      title: s.title,
      agentId: s.agent_id,
      taskId: s.task_id,
      workDirectory: s.work_directory,
      currentModel: s.current_model,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    }));
  }));

  ipcMain.handle('sessions:create', wrapHandler((...args: unknown[]) => {
    const params = args[1] as {
      title?: string;
      agentId?: string;
      workDirectory?: string;
      currentModel?: string;
      taskId?: string;
    } | undefined;
    const sessionId = randomUUID();
    createChatSession({
      id: sessionId,
      title: params?.title ?? 'New Session',
      agentId: params?.agentId,
      taskId: params?.taskId,
      workDirectory: params?.workDirectory,
      currentModel: params?.currentModel,
    });
    return { sessionId };
  }));

  ipcMain.handle('sessions:get', wrapHandler((...args: unknown[]) => {
    const id = args[1] as string;
    const session = getChatSession(id);
    if (!session) return null;
    return {
      id: session.id,
      title: session.title,
      agentId: session.agent_id,
      taskId: session.task_id,
      workDirectory: session.work_directory,
      currentModel: session.current_model,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    };
  }));

  ipcMain.handle('sessions:delete', wrapHandler((...args: unknown[]) => {
    const id = args[1] as string;
    deleteChatSession(id);
    return true;
  }));

  ipcMain.handle('sessions:resume', wrapHandler((...args: unknown[]) => {
    const sessionId = args[1] as string;
    if (!sessionId) throw new Error('sessionId is required');
    // Ensure session exists, then return expected shape
    const session = getChatSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return { sessionId: session.id };
  }));

  // =========================================================================
  // Chat
  // =========================================================================

  ipcMain.handle('chat:send', wrapHandler(async (...args: unknown[]) => {
    const sessionId = args[1] as string;
    const content = args[2] as string;
    const options = args[3] as {
      mode?: 'cli' | 'api';
      cliBackend?: string;
      providerId?: string;
      modelId?: string;
      agentType?: 'coding' | 'requirements' | 'design' | 'testing';
      workDirectory?: string;
    } | undefined;

    // 1. Persist the user message
    const messageId = randomUUID();
    insertMessage({
      id: messageId,
      sessionId,
      role: 'user',
      content,
    });

    // 2. Resolve session context
    const session = getChatSession(sessionId);
    const workDirectory = options?.workDirectory ?? session?.work_directory ?? process.cwd();
    const agentType = options?.agentType
      ?? (session?.agent_id as 'coding' | 'requirements' | 'design' | 'testing' | null)
      ?? 'coding';

    // 3. Resolve provider/model and execution mode
    let providerId = options?.providerId;
    let modelId = options?.modelId;
    if ((!providerId || !modelId) && session?.current_model?.includes('/')) {
      const [sessionProviderId, sessionModelId] = session.current_model.split('/');
      providerId = providerId ?? sessionProviderId;
      modelId = modelId ?? sessionModelId;
    }
    if (!providerId || !modelId) {
      const mapping = getAgentModelMappings(agentType).find((m) => m.provider_id && m.model_id && m.is_fallback === 0);
      if (mapping?.provider_id && mapping.model_id) {
        providerId = providerId ?? mapping.provider_id;
        modelId = modelId ?? mapping.model_id;
      }
    }

    let mode: 'cli' | 'api' = options?.mode ?? ((providerId && modelId) ? 'api' : 'cli');
    if (agentType !== 'coding') {
      if (providerId && modelId) {
        mode = 'api';
      } else {
        throw new Error(`${agentType} agent requires an API model. Please select a model first.`);
      }
    }

    if (session && (session.agent_id !== agentType || (providerId && modelId))) {
      updateChatSession(sessionId, {
        agent_id: agentType,
        current_model: providerId && modelId ? `${providerId}/${modelId}` : session.current_model,
      });
    }

    // 3.5 Execute a skill command: "/skill <tool> <args>"
    const skillCommand = content.trim().match(/^\/skill\s+([a-zA-Z0-9_-]+)\s*(.*)$/);
    if (skillCommand) {
      const toolName = skillCommand[1] ?? '';
      const rawArgs = skillCommand[2] ?? '';
      const allSkills = skillRegistry.getAll();
      const allTools = allSkills.flatMap((s) => s.tools.map((t) => ({ skillId: s.id, tool: t })));

      if (toolName === 'list') {
        const assistantMessageId = randomUUID();
        const listResult = allTools.map((entry) => ({
          skillId: entry.skillId,
          tool: entry.tool.name,
          description: entry.tool.description,
        }));
        const assistantContent = `\`\`\`json\n${JSON.stringify(listResult, null, 2)}\n\`\`\``;
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('chat:stream', {
            sessionId,
            messageId: assistantMessageId,
            type: 'text_delta',
            content: assistantContent,
            timestamp: Date.now(),
          });
          mainWindow.webContents.send('chat:stream', {
            sessionId,
            messageId: assistantMessageId,
            type: 'turn_end',
            timestamp: Date.now(),
          });
        }
        insertMessage({
          id: assistantMessageId,
          sessionId,
          role: 'assistant',
          content: assistantContent,
          modelUsed: 'skill/list',
        });
        return { messageId };
      }

      let toolInput: Record<string, unknown>;
      if (rawArgs.trim().startsWith('{')) {
        try {
          toolInput = JSON.parse(rawArgs) as Record<string, unknown>;
        } catch {
          throw new Error('Invalid JSON args for /skill command');
        }
      } else {
        toolInput = { query: rawArgs.trim(), max_results: 5 };
      }
      const skillHandler = BUILTIN_SKILL_HANDLERS[toolName];
      const toolDef = allTools.find((entry) => entry.tool.name === toolName);

      if (!skillHandler && !toolDef) {
        throw new Error(`Unknown skill tool "${toolName}". Use "/skill list" to view available tools.`);
      }

      const assistantMessageId = randomUUID();
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('chat:stream', {
          sessionId,
          messageId: assistantMessageId,
          type: 'tool_start',
          toolName,
          toolInput,
          timestamp: Date.now(),
        });
      }

      let result: unknown;
      if (skillHandler) {
        if (!toolInput.query || String(toolInput.query).trim().length === 0) {
          throw new Error('Built-in skill command requires a non-empty query');
        }
        result = await skillHandler(toolInput);
      } else {
        const tool = toolDef?.tool;
        const endpoint = tool?.endpoint;
        if (typeof endpoint !== 'string' || endpoint.length === 0) {
          result = {
            loaded: true,
            executed: false,
            reason: `Skill tool "${toolName}" is installed but does not expose an executable endpoint`,
          };
        } else {
          const method = tool?.method ?? 'POST';
          const timeoutMs = typeof tool?.timeoutMs === 'number' ? Math.max(1000, tool.timeoutMs) : 20_000;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

          const headers: Record<string, string> = {
            ...((tool?.headers as Record<string, string> | undefined) ?? {}),
          };
          if (method !== 'GET' && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
          }

          const url = method === 'GET'
            ? (() => {
                const parsed = new URL(endpoint);
                for (const [k, v] of Object.entries(toolInput)) {
                  if (v == null) continue;
                  parsed.searchParams.set(k, String(v));
                }
                return parsed.toString();
              })()
            : endpoint;

          const response = await fetch(url, {
            method,
            headers,
            body: method === 'GET' ? undefined : JSON.stringify(toolInput),
            signal: controller.signal,
          }).finally(() => {
            clearTimeout(timeoutId);
          });
          const body = await response.text();
          let parsedBody: unknown = body;
          try {
            parsedBody = JSON.parse(body);
          } catch {
            // keep text
          }
          result = {
            status: response.status,
            ok: response.ok,
            body: parsedBody,
            endpoint: url,
            method,
          };
        }
      }
      const assistantContent = `\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;

      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('chat:stream', {
          sessionId,
          messageId: assistantMessageId,
          type: 'text_delta',
          content: assistantContent,
          timestamp: Date.now(),
        });
        mainWindow.webContents.send('chat:stream', {
          sessionId,
          messageId: assistantMessageId,
          type: 'tool_end',
          toolName,
          timestamp: Date.now(),
        });
        mainWindow.webContents.send('chat:stream', {
          sessionId,
          messageId: assistantMessageId,
          type: 'turn_end',
          timestamp: Date.now(),
        });
      }

      insertMessage({
        id: assistantMessageId,
        sessionId,
        role: 'assistant',
        content: assistantContent,
        modelUsed: `skill/${toolName}`,
      });
      return { messageId };
    }

    // 4. Resolve provider config for API mode
    let apiKey: string | undefined;
    let baseUrl: string | undefined;
    let apiProtocol: AgentExecuteOptions['apiProtocol'];

    if (mode === 'api' && providerId) {
      const provider = registry.getById(providerId);
      if (provider) {
        baseUrl = provider.baseUrl;
        apiProtocol = provider.apiProtocol;
        apiKey = (await getApiKey(providerId)) ?? undefined;
        if (!modelId && provider.models.length > 0) {
          modelId = provider.models[0]?.id;
        }
      }
    }

    // 5. Start agent execution (fire-and-forget, stream events via webContents)
    const assistantMessageId = randomUUID();
    let assistantContent = '';

    agentExecutor.execute({
      sessionId,
      prompt: content,
      workDirectory,
      agentType,
      mode,
      cliBackend: options?.cliBackend,
      providerId,
      modelId,
      apiKey,
      baseUrl,
      apiProtocol,
      onEvent: (event) => {
        // Accumulate text for persistence
        if (event.type === 'text_delta' && event.content) {
          assistantContent += event.content;
        }

        // Push stream event to renderer
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('chat:stream', {
            sessionId,
            messageId: assistantMessageId,
            ...event,
          });
        }

        // Persist assistant message on turn end
        if (event.type === 'turn_end' && assistantContent.length > 0) {
          insertMessage({
            id: assistantMessageId,
            sessionId,
            role: 'assistant',
            content: assistantContent,
            modelUsed: modelId ? `${providerId ?? 'cli'}/${modelId}` : undefined,
          });

          // Auto-create board issues from agent output
          if (agentType === 'requirements' && assistantContent.length > 100) {
            try {
              const tasks = parseTasksFromPRD(assistantContent);
              if (tasks.length > 0) {
                const count = createBoardIssuesFromTasks(tasks);
                if (count > 0 && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('chat:stream', {
                    sessionId,
                    type: 'text_delta',
                    content: `\n\n> 已自动创建 ${count} 个任务卡片到看板\n`,
                    timestamp: Date.now(),
                  });
                }
              }
            } catch { /* best-effort */ }
          }

          if (agentType === 'testing' && assistantContent.length > 100) {
            try {
              const bugs = parseBugsFromTestReport(assistantContent);
              if (bugs.length > 0) {
                const count = createBoardIssuesFromTasks(bugs);
                if (count > 0 && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('chat:stream', {
                    sessionId,
                    type: 'text_delta',
                    content: `\n\n> 已自动创建 ${count} 个 Bug 卡片到看板\n`,
                    timestamp: Date.now(),
                  });
                }
              }
            } catch { /* best-effort */ }
          }
        }
      },
    }).catch((err) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('chat:stream', {
          sessionId,
          messageId: assistantMessageId,
          type: 'error',
          errorMessage,
          timestamp: Date.now(),
        });
      }
    });

    return { messageId };
  }, 'chat:send'));

  ipcMain.handle('chat:abort', wrapHandler(async (...args: unknown[]) => {
    const sessionId = args[1] as string;
    await agentExecutor.abort(sessionId);
    return true;
  }));

  ipcMain.handle('chat:history', wrapHandler((...args: unknown[]) => {
    const sessionId = args[1] as string;
    return getSessionMessages(sessionId).map((m) => ({
      id: m.id,
      sessionId: m.session_id,
      role: m.role,
      content: m.content,
      modelUsed: m.model_used,
      createdAt: m.created_at,
    }));
  }));

  ipcMain.handle('chat:switch-model', wrapHandler((...args: unknown[]) => {
    const sessionId = args[1] as string;
    const providerId = args[2] as string;
    const modelId = args[3] as string;
    updateChatSession(sessionId, { current_model: `${providerId}/${modelId}` });
    return true;
  }));

  // =========================================================================
  // Agents
  // =========================================================================

  ipcMain.handle('agents:list', wrapHandler(() => {
    return getAgents();
  }));

  ipcMain.handle('agents:get', wrapHandler((...args: unknown[]) => {
    const id = args[1] as string;
    return getAgent(id) ?? null;
  }));

  ipcMain.handle('agents:update', wrapHandler((...args: unknown[]) => {
    const id = args[1] as string;
    const updates = args[2] as Partial<{
      name: string;
      type: 'coding' | 'requirements' | 'design' | 'testing';
      system_prompt: string;
      skills: string;
      container_config: string;
      status: string;
    }>;
    updateAgent(id, updates);
    return true;
  }, 'agents:update'));

  ipcMain.handle('agents:config', wrapHandler((...args: unknown[]) => {
    const id = args[1] as string;
    const agent = getAgent(id);
    if (!agent) return null;
    return {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      systemPrompt: agent.system_prompt,
      skills: agent.skills,
      containerConfig: agent.container_config,
      status: agent.status,
    };
  }));

  ipcMain.handle('agents:set-model', wrapHandler((...args: unknown[]) => {
    const agentType = args[1] as string;
    const providerId = args[2] as string;
    const modelId = args[3] as string;
    const mappingId = `mapping-${agentType}`;
    setAgentModelMapping({
      id: mappingId,
      agentType,
      providerId,
      modelId,
    });
    // Also update the in-memory router
    setAgentModel({
      agentType: agentType as 'coding' | 'requirements' | 'design' | 'testing',
      providerId,
      modelId,
    });
    return true;
  }));

  // =========================================================================
  // Git
  // =========================================================================

  // Helper: resolve workDir from args or fallback to cwd
  function resolveWorkDir(args: unknown[], idx = 1): string {
    const val = args[idx];
    return (typeof val === 'string' && val.length > 0) ? val : process.cwd();
  }

  ipcMain.handle('git:status', wrapHandler((...args: unknown[]) => {
    return getGitStatus(resolveWorkDir(args));
  }));

  ipcMain.handle('git:diff', wrapHandler((...args: unknown[]) => {
    const arg = args[1];
    if (typeof arg === 'string' && arg.length > 0) {
      return getGitFileDiff(process.cwd(), arg, false);
    }
    const staged = typeof arg === 'boolean' ? arg : false;
    const result = getGitDiff(process.cwd(), staged);
    return result.files.map((f) => f.diff).filter(Boolean).join('\n');
  }));

  ipcMain.handle('git:commit', wrapHandler((...args: unknown[]) => {
    const message = args[1] as string;
    if (!message || typeof message !== 'string') {
      throw new Error('Commit message is required');
    }
    const commitHash = gitCommit(process.cwd(), message);
    return { commitHash };
  }));

  ipcMain.handle('git:push', wrapHandler(() => {
    const { waitForApproval } = createApprovalRequest(
      'git-push',
      'git-push',
      'Git push to remote repository',
      'git push',
    );
    return waitForApproval.then((approved) => {
      if (!approved) {
        throw new Error('Git push denied by user');
      }
      gitPush(process.cwd());
      return true;
    });
  }));

  ipcMain.handle('git:stage', wrapHandler((...args: unknown[]) => {
    const files = args[1] as string[];
    if (!Array.isArray(files)) throw new Error('files must be an array');
    gitStage(process.cwd(), files);
    return true;
  }));

  ipcMain.handle('git:unstage', wrapHandler((...args: unknown[]) => {
    const files = args[1] as string[];
    if (!Array.isArray(files)) throw new Error('files must be an array');
    gitUnstage(process.cwd(), files);
    return true;
  }));

  ipcMain.handle('git:revert', wrapHandler((...args: unknown[]) => {
    const files = args[1] as string[];
    if (!Array.isArray(files)) throw new Error('files must be an array');
    gitRevert(process.cwd(), files);
    return true;
  }));

  ipcMain.handle('git:snapshot', wrapHandler(() => {
    return createSnapshot(process.cwd());
  }));

  ipcMain.handle('git:undo', wrapHandler((...args: unknown[]) => {
    const snapshotRef = args[1] as string | undefined;
    // If no snapshot ref provided, undo to previous commit (HEAD~1)
    const ref = snapshotRef && typeof snapshotRef === 'string' ? snapshotRef : 'HEAD~1';
    undoToSnapshot(process.cwd(), ref);
    return true;
  }));

  ipcMain.handle('git:redo', wrapHandler(() => {
    redoFromUndo(process.cwd());
    return true;
  }));

  ipcMain.handle('git:worktree-list', wrapHandler(() => {
    return listWorktrees(process.cwd());
  }));

  ipcMain.handle('git:worktree-create', wrapHandler((...args: unknown[]) => {
    const branch = args[1] as string;
    const path = args[2] as string;
    if (!branch || !path) throw new Error('branch and path are required');
    const resultPath = createWorktree(process.cwd(), branch, path);
    return { path: resultPath };
  }, 'git:worktree-create'));

  ipcMain.handle('git:worktree-remove', wrapHandler((...args: unknown[]) => {
    const path = args[1] as string;
    if (!path) throw new Error('Worktree path is required');
    removeWorktree(process.cwd(), path);
    return true;
  }));

  // =========================================================================
  // Tasks
  // =========================================================================

  ipcMain.handle('tasks:list', wrapHandler(() => {
    return getTasks();
  }));

  ipcMain.handle('tasks:create', wrapHandler((...args: unknown[]) => {
    const params = args[1] as {
      title?: string;
      description?: string;
      priority?: string;
      agentId?: string;
    } | undefined;
    const taskId = randomUUID();
    createTask({
      id: taskId,
      title: params?.title,
      description: params?.description,
      priority: params?.priority,
      agentId: params?.agentId,
    });
    return { taskId };
  }, 'tasks:create'));

  ipcMain.handle('tasks:update', wrapHandler((...args: unknown[]) => {
    const id = args[1] as string;
    const updates = args[2] as Partial<{
      title: string;
      description: string;
      status: string;
      priority: string;
      agent_id: string;
      session_id: string;
      branch: string;
      worktree_path: string;
    }>;
    updateTask(id, updates);
    return true;
  }, 'tasks:update'));

  ipcMain.handle('tasks:delete', wrapHandler((...args: unknown[]) => {
    const id = args[1] as string;
    deleteTask(id);
    return true;
  }));

  ipcMain.handle('tasks:start', wrapHandler((...args: unknown[]) => {
    const params = args[1] as {
      id: string;
      title: string;
      agentType?: 'coding' | 'requirements' | 'design' | 'testing';
    };
    if (!params?.id || !params?.title) throw new Error('id and title are required');

    const safeId = params.id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
    const safeTitle = params.title.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
    const branch = `task/${safeId || 'issue'}-${safeTitle || 'work'}`;
    const worktreeRoot = join(process.cwd(), '.claw-worktrees');
    mkdirSync(worktreeRoot, { recursive: true });
    const worktreePath = join(worktreeRoot, safeId || randomUUID().slice(0, 8));

    if (!existsSync(worktreePath)) {
      try {
        createWorktree(process.cwd(), branch, worktreePath);
      } catch (err) {
        if (!existsSync(worktreePath)) {
          throw err;
        }
      }
    }

    const sessionId = randomUUID();
    createChatSession({
      id: sessionId,
      title: params.title,
      agentId: params.agentType ?? 'coding',
      taskId: params.id,
      workDirectory: worktreePath,
    });

    return { sessionId, branch, worktreePath };
  }, 'tasks:start'));

  // =========================================================================
  // Schedule
  // =========================================================================

  ipcMain.handle('schedule:list', wrapHandler(() => {
    return getScheduledTasks();
  }));

  ipcMain.handle('schedule:create', wrapHandler((...args: unknown[]) => {
    const params = args[1] as {
      name?: string;
      scheduleType?: 'cron' | 'interval' | 'once';
      scheduleExpr?: string;
      agentType?: string;
      prompt?: string;
      workDirectory?: string;
      enabled?: boolean;
      nextRun?: string;
    } | undefined;
    const id = randomUUID();
    createScheduledTask({
      id,
      name: params?.name,
      scheduleType: params?.scheduleType,
      scheduleExpr: params?.scheduleExpr,
      agentType: params?.agentType,
      prompt: params?.prompt,
      workDirectory: params?.workDirectory,
      enabled: params?.enabled,
      nextRun: params?.nextRun,
    });
    return { id };
  }));

  ipcMain.handle('schedule:toggle', wrapHandler((...args: unknown[]) => {
    const id = args[1] as string;
    const enabled = args[2] as boolean;
    updateScheduledTask(id, { enabled: enabled ? 1 : 0 });
    return true;
  }));

  ipcMain.handle('schedule:delete', wrapHandler((...args: unknown[]) => {
    const id = args[1] as string;
    deleteScheduledTask(id);
    return true;
  }));

  ipcMain.handle('schedule:logs', wrapHandler((...args: unknown[]) => {
    const taskId = args[1] as string;
    return getTaskRunLogs(taskId);
  }));

  // =========================================================================
  // Skills
  // =========================================================================

  ipcMain.handle('skills:search', wrapHandler(async (...args: unknown[]) => {
    const query = args[1] as string;
    if (!query?.trim()) return [];
    return searchClawHub(query);
  }, 'skills:search'));

  ipcMain.handle('skills:install', wrapHandler(async (...args: unknown[]) => {
    const skillId = args[1] as string;
    if (!skillId) throw new Error('Skill ID is required');

    // Try to fetch manifest from ClawHub
    const manifest = await downloadSkillManifest(skillId);
    if (!manifest) throw new Error(`Skill manifest not found: ${skillId}`);

    // Enforce security scan before install.
    const findings = scanSource(
      JSON.stringify(manifest, null, 2),
      `clawhub:${skillId}:manifest.json`,
    );
    const critical = findings.filter((f) => f.severity === 'critical');
    if (critical.length > 0) {
      throw new Error(`Skill install blocked by security scan (${critical.length} critical findings)`);
    }

    const skillDir = join(app.getPath('userData'), 'skills', skillId);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

    skillRegistry.install(manifest, 'clawhub');
    return true;
  }));

  ipcMain.handle('skills:uninstall', wrapHandler((...args: unknown[]) => {
    const id = args[1] as string;
    skillRegistry.uninstall(id);
    const skillDir = join(app.getPath('userData'), 'skills', id);
    if (existsSync(skillDir)) {
      rmSync(skillDir, { recursive: true, force: true });
    }
    return true;
  }));

  ipcMain.handle('skills:list', wrapHandler(() => {
    return skillRegistry.getAll().map((manifest) => ({
      ...manifest,
      installed: true,
    }));
  }));

  ipcMain.handle('skills:scan', wrapHandler(async (...args: unknown[]) => {
    const dirPath = args[1] as string;
    if (!dirPath) throw new Error('Skill directory path is required');
    const { scanDirectoryWithSummary } = await import('../security/skill-scanner.js');
    return scanDirectoryWithSummary(dirPath);
  }));

  // =========================================================================
  // Channels
  // =========================================================================

  ipcMain.handle('channels:config', wrapHandler((...args: unknown[]) => {
    // Frontend sends (channelType, config) as separate args
    const channelType = args[1] as string;
    const config = args[2] as Record<string, unknown> | undefined;
    if (!channelType) throw new Error('channelType is required');
    setChannelState({
      id: channelType,
      channelType,
      config: config ? JSON.stringify(config) : undefined,
      status: 'configured',
    });
    if (config) {
      setSetting(`channel:${channelType}:config`, JSON.stringify(config));
    }
    if (channelType === 'qq' || channelType === 'feishu' || channelType === 'feishu2') {
      registerOrUpdateChannel(channelType, config ?? undefined);
    }
    return true;
  }, 'channels:config'));

  ipcMain.handle('channels:test', wrapHandler(async (...args: unknown[]) => {
    const channelType = args[1] as string;
    const manager = getChannelManager();
    const channel = manager.getChannel(channelType);
    if (!channel) {
      return { connected: false, error: `Channel ${channelType} is not registered` };
    }

    if (channel.status === 'connected') {
      return { connected: true };
    }

    try {
      await manager.start(channelType);
      return { connected: manager.getStatus(channelType) === 'connected' };
    } catch (err) {
      return { connected: false, error: err instanceof Error ? err.message : String(err) };
    }
  }));

  // =========================================================================
  // Approval
  // =========================================================================

  ipcMain.handle('approval:response', wrapHandler((...args: unknown[]) => {
    const approvalId = args[1] as string;
    const approved = args[2] as boolean;
    const remember = args[3] as { pattern: string } | undefined;
    resolveApproval(approvalId, approved, remember);
    return true;
  }));

  ipcMain.handle('approval:mode:get', wrapHandler(() => {
    return getApprovalMode();
  }));

  ipcMain.handle('approval:mode:set', wrapHandler((...args: unknown[]) => {
    const mode = args[1] as 'suggest' | 'auto-edit' | 'full-auto';
    setApprovalMode(mode);
    return true;
  }));

  // =========================================================================
  // File / Directory
  // =========================================================================

  ipcMain.handle('file:open', wrapHandler(async (...args: unknown[]) => {
    const filePath = args[1] as string;
    return shell.openPath(filePath);
  }, 'file:open'));

  ipcMain.handle('directory:select', wrapHandler(async () => {
    return dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  }));

  // =========================================================================
  // Board (Kanban)
  // =========================================================================

  ipcMain.handle('board:states', wrapHandler(() => {
    return getBoardStates();
  }));

  ipcMain.handle('board:transitions', wrapHandler(() => {
    return getBoardTransitions();
  }));

  ipcMain.handle('board:issues:list', wrapHandler((...args: unknown[]) => {
    const filters = args[1] as { stateId?: string; priority?: string; issueType?: string; parentId?: string } | undefined;
    return getBoardIssues(filters ?? undefined);
  }));

  ipcMain.handle('board:issues:get', wrapHandler((...args: unknown[]) => {
    const id = args[1] as string;
    return getBoardIssue(id) ?? null;
  }));

  ipcMain.handle('board:issues:create', wrapHandler((...args: unknown[]) => {
    const params = args[1] as {
      title: string;
      description?: string;
      stateId: string;
      priority?: string;
      assignee?: string;
      labels?: string[];
      parentId?: string;
      estimatePoints?: number;
      startDate?: string;
      targetDate?: string;
      issueType?: string;
    };
    if (!params?.title || !params?.stateId) throw new Error('title and stateId are required');
    const id = randomUUID();
    createBoardIssue({ id, ...params });
    return { id };
  }, 'board:issues:create'));

  ipcMain.handle('board:issues:update', wrapHandler((...args: unknown[]) => {
    const id = args[1] as string;
    const updates = args[2] as Record<string, unknown>;
    if (!id) throw new Error('Issue id is required');
    updateBoardIssue(id, updates);
    return true;
  }));

  ipcMain.handle('board:issues:move', wrapHandler((...args: unknown[]) => {
    const id = args[1] as string;
    const targetStateId = args[2] as string;
    const sortOrder = (args[3] as number) ?? 0;
    if (!id || !targetStateId) throw new Error('id and targetStateId are required');
    moveBoardIssue(id, targetStateId, sortOrder);
    return true;
  }));

  ipcMain.handle('board:issues:delete', wrapHandler((...args: unknown[]) => {
    const id = args[1] as string;
    if (!id) throw new Error('Issue id is required');
    deleteBoardIssue(id);
    return true;
  }));

  ipcMain.handle('board:issues:start', wrapHandler((...args: unknown[]) => {
    const params = args[1] as {
      id: string;
      title: string;
      agentType?: 'coding' | 'requirements' | 'design' | 'testing';
    };
    if (!params?.id || !params?.title) throw new Error('id and title are required');
    const safeId = params.id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
    const safeTitle = params.title.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
    const branch = `task/${safeId || 'issue'}-${safeTitle || 'work'}`;
    const worktreeRoot = join(process.cwd(), '.claw-worktrees');
    mkdirSync(worktreeRoot, { recursive: true });
    const worktreePath = join(worktreeRoot, safeId || randomUUID().slice(0, 8));

    if (!existsSync(worktreePath)) {
      try {
        createWorktree(process.cwd(), branch, worktreePath);
      } catch (err) {
        if (!existsSync(worktreePath)) {
          throw err;
        }
      }
    }

    const sessionId = randomUUID();
    createChatSession({
      id: sessionId,
      title: params.title,
      agentId: params.agentType ?? 'coding',
      taskId: params.id,
      workDirectory: worktreePath,
    });

    return { sessionId, branch, worktreePath };
  }));

  // =========================================================================
  // Channels (extended)
  // =========================================================================

  // =========================================================================
  // Orchestrator (Multi-Agent Pipeline)
  // =========================================================================

  ipcMain.handle('orchestrator:execute', wrapHandler(async (...args: unknown[]) => {
    const pipeline = args[1] as AgentPipeline;
    if (!pipeline?.id || !pipeline?.steps) throw new Error('Invalid pipeline');

    const orchestrator = getOrchestrator();
    if (orchestrator.isRunning(pipeline.id)) {
      throw new Error(`Pipeline ${pipeline.id} is already running`);
    }

    // Fire-and-forget, stream progress via webContents
    orchestrator.executePipeline(pipeline, (progress) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('orchestrator:progress', progress);
      }
    }).catch((err) => {
      console.error('[Orchestrator] Pipeline failed:', err);
    });

    return { pipelineId: pipeline.id };
  }));

  ipcMain.handle('orchestrator:cancel', wrapHandler((...args: unknown[]) => {
    const pipelineId = args[1] as string;
    getOrchestrator().cancelPipeline(pipelineId);
    return true;
  }));

  ipcMain.handle('orchestrator:status', wrapHandler((...args: unknown[]) => {
    const pipelineId = args[1] as string;
    return { running: getOrchestrator().isRunning(pipelineId) };
  }));

  ipcMain.handle('channels:list', wrapHandler(() => {
    const manager = getChannelManager();
    const channels = manager.getAllChannels();
    return channels.map(ch => ({
      id: ch.id,
      type: ch.type,
      status: ch.status,
      configured: ch.id === 'qq'
        ? Boolean((getChannelState('qq') as { config?: string | null } | undefined)?.config)
        : ch.id === 'feishu'
          ? Boolean((getChannelState('feishu') as { config?: string | null } | undefined)?.config)
          : ch.id === 'feishu2'
            ? Boolean((getChannelState('feishu2') as { config?: string | null } | undefined)?.config)
            : false,
    }));
  }));

  ipcMain.handle('channels:start', wrapHandler(async (...args: unknown[]) => {
    const channelId = args[1] as string;
    if (!channelId) throw new Error('channelId is required');
    const manager = getChannelManager();
    await manager.start(channelId);
    return { started: true };
  }, 'channels:start'));

  ipcMain.handle('channels:stop', wrapHandler(async (...args: unknown[]) => {
    const channelId = args[1] as string;
    if (!channelId) throw new Error('channelId is required');
    const manager = getChannelManager();
    await manager.stop(channelId);
    return { stopped: true };
  }, 'channels:stop'));

  // =========================================================================
  // Memory
  // =========================================================================

  ipcMain.handle('memory:search', wrapHandler(async (...args: unknown[]) => {
    const options = args[1] as SearchOptions;
    if (!options?.query) throw new Error('query is required');

    // Try to create embedding adapter from first available provider
    let adapter = null;
    try {
      const providers = registry.getAll().filter((p) => p.status === 'available');
      for (const provider of providers) {
        const key = (await getApiKey(provider.id)) ?? null;
        adapter = createEmbeddingAdapter(provider, key);
        if (adapter) break;
      }
    } catch { /* best-effort */ }

    return searchMemory(options, adapter);
  }, 'memory:search'));

  ipcMain.handle('memory:stats', wrapHandler(() => {
    return getMemoryStats();
  }));

  ipcMain.handle('memory:config:get', wrapHandler(() => {
    return getMemoryConfig();
  }));

  ipcMain.handle('memory:config:set', wrapHandler((...args: unknown[]) => {
    const key = args[1] as string;
    const value = args[2] as string | number | boolean;
    if (!key) throw new Error('key is required');
    setMemoryConfigValue(key, value);
    return true;
  }, 'memory:config:set'));

  ipcMain.handle('memory:delete', wrapHandler((...args: unknown[]) => {
    const chunkId = args[1] as string;
    if (!chunkId) throw new Error('chunkId is required');
    deleteMemoryChunk(chunkId);
    return true;
  }, 'memory:delete'));

  ipcMain.handle('memory:delete-session', wrapHandler((...args: unknown[]) => {
    const sessionId = args[1] as string;
    if (!sessionId) throw new Error('sessionId is required');
    deleteSessionMemory(sessionId);
    return true;
  }, 'memory:delete-session'));

  ipcMain.handle('memory:reindex', wrapHandler(async () => {
    // Find chunks without embeddings and generate them
    const chunks = getChunksWithoutEmbeddings(100);
    if (chunks.length === 0) return { indexed: 0 };

    let adapter = null;
    try {
      const providers = registry.getAll().filter((p) => p.status === 'available');
      for (const provider of providers) {
        const key = (await getApiKey(provider.id)) ?? null;
        adapter = createEmbeddingAdapter(provider, key);
        if (adapter) break;
      }
    } catch { /* best-effort */ }

    if (!adapter) return { indexed: 0, reason: 'no embedding provider available' };

    const texts = chunks.map((c) => c.content);
    const embeddings = await adapter.embed(texts);

    let indexed = 0;
    for (let i = 0; i < chunks.length; i++) {
      const embedding = embeddings[i];
      const chunk = chunks[i];
      if (embedding && chunk) {
        updateChunkEmbedding(chunk.id, embeddingToBuffer(embedding));
        indexed++;
      }
    }

    return { indexed };
  }));

}
