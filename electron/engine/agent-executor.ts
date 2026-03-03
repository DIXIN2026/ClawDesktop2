/**
 * Agent Executor
 * Unified CLI / API dual-mode dispatch for coding agent sessions.
 */

import type { CodingAgentEvent } from '../providers/types.js';
import { getCliRunner } from '../providers/cli-agents/runner.js';
import { streamAnthropicMessages } from '../providers/adapters/anthropic.js';
import type { AnthropicStreamEvent } from '../providers/adapters/anthropic.js';
import { streamOpenAICompatible } from '../providers/adapters/openai-compat.js';
import type { OpenAIStreamChunk } from '../providers/adapters/openai-compat.js';
import { streamOllamaGenerate } from '../providers/adapters/ollama.js';
import type { OllamaGenerateChunk } from '../providers/adapters/ollama.js';
import { RequirementsAgent } from '../agents/requirements-agent.js';
import { DesignAgent } from '../agents/design-agent.js';
import { TestingAgent } from '../agents/testing-agent.js';
import { createSnapshot } from './git-ops.js';
import { createApprovalRequest } from '../security/approval.js';
import type { ApprovalAction } from '../security/approval.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { isAbsolute, resolve, relative } from 'node:path';
import { startPreviewServer } from '../agents/design-preview.js';
import { buildAgentContext } from '../memory/context-builder.js';
import {
  indexConversationMessage,
  shouldCompact,
  compactSession,
  generateEmbeddingsForChunks,
} from '../memory/compaction-engine.js';
import { getChunk, updateChunkEmbedding } from '../memory/memory-store.js';
import type { EmbeddingAdapter } from '../memory/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentExecuteOptions {
  sessionId: string;
  prompt: string;
  workDirectory: string;
  agentType: 'coding' | 'requirements' | 'design' | 'testing';
  mode: 'cli' | 'api';
  cliBackend?: string; // 'claude-code' | 'codex' | 'opencode' | 'gemini-cli'
  providerId?: string;
  modelId?: string;
  apiKey?: string;
  baseUrl?: string;
  apiProtocol?: 'anthropic-messages' | 'openai-compatible' | 'ollama';
  embeddingAdapter?: EmbeddingAdapter | null;
  /** Overall timeout in ms (default: 600_000 = 10 min) */
  timeoutMs?: number;
  /** No-output watchdog timeout in ms (default: 180_000 = 3 min) */
  noOutputTimeoutMs?: number;
  onEvent: (event: CodingAgentEvent) => void;
}

interface ActiveSession {
  abortController: AbortController;
  runner?: { abort(): Promise<void> };
  overallTimer?: ReturnType<typeof setTimeout>;
  watchdogInterval?: ReturnType<typeof setInterval>;
}

export interface AgentExecutor {
  execute(options: AgentExecuteOptions): Promise<void>;
  abort(sessionId: string): Promise<void>;
  isRunning(sessionId: string): boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAgentExecutor(): AgentExecutor {
  const activeSessions = new Map<string, ActiveSession>();

  async function execute(options: AgentExecuteOptions): Promise<void> {
    const { sessionId, mode, agentType } = options;

    if (activeSessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is already running`);
    }

    const abortController = new AbortController();
    const session: ActiveSession = { abortController };
    activeSessions.set(sessionId, session);

    try {
      if (agentType !== 'coding' && mode === 'api') {
        await executeSpecializedAgent(options, abortController.signal);
      } else if (mode === 'cli') {
        await executeCliMode(options, session);
      } else {
        await executeApiMode(options, abortController.signal);
      }
    } finally {
      activeSessions.delete(sessionId);
    }
  }

  async function abort(sessionId: string): Promise<void> {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    clearSessionTimers(session);
    session.abortController.abort();
    if (session.runner) {
      await session.runner.abort();
    }
    activeSessions.delete(sessionId);
  }

  function isRunning(sessionId: string): boolean {
    return activeSessions.has(sessionId);
  }

  return { execute, abort, isRunning };
}

// ---------------------------------------------------------------------------
// CLI mode
// ---------------------------------------------------------------------------

const DEFAULT_CLI_TIMEOUT_MS = 600_000;       // 10 minutes
const DEFAULT_NO_OUTPUT_TIMEOUT_MS = 180_000;  // 3 minutes
const WATCHDOG_CHECK_INTERVAL_MS = 5_000;      // 5 seconds

async function executeCliMode(
  options: AgentExecuteOptions,
  session: ActiveSession,
): Promise<void> {
  const {
    sessionId, prompt, workDirectory, cliBackend, onEvent, modelId,
    timeoutMs = DEFAULT_CLI_TIMEOUT_MS,
    noOutputTimeoutMs = DEFAULT_NO_OUTPUT_TIMEOUT_MS,
  } = options;
  const backendId = cliBackend ?? 'claude-code';
  const runner = getCliRunner(backendId);

  if (!runner) {
    onEvent({
      type: 'error',
      errorMessage: `CLI backend "${backendId}" is not supported or not found`,
      timestamp: Date.now(),
    });
    return;
  }

  session.runner = runner;

  const events = runner.execute({
    prompt,
    workDirectory,
    sessionId,
    model: modelId,
  });

  let lastEventAt = Date.now();

  // Overall timeout: abort the session after timeoutMs
  if (timeoutMs > 0) {
    session.overallTimer = setTimeout(() => {
      if (!session.abortController.signal.aborted) {
        onEvent({
          type: 'error',
          errorMessage: `CLI session timed out after ${Math.round(timeoutMs / 1000)}s`,
          timestamp: Date.now(),
        });
        session.abortController.abort();
        runner.abort().catch(() => {});
      }
    }, timeoutMs);
  }

  // No-output watchdog: check every 5s if output has stalled
  if (noOutputTimeoutMs > 0) {
    session.watchdogInterval = setInterval(() => {
      const silentMs = Date.now() - lastEventAt;
      if (silentMs >= noOutputTimeoutMs && !session.abortController.signal.aborted) {
        onEvent({
          type: 'error',
          errorMessage: `CLI session killed: no output for ${Math.round(silentMs / 1000)}s`,
          timestamp: Date.now(),
        });
        session.abortController.abort();
        runner.abort().catch(() => {});
      }
    }, WATCHDOG_CHECK_INTERVAL_MS);
  }

  try {
    for await (const event of events) {
      if (session.abortController.signal.aborted) break;

      // Touch watchdog on every event
      lastEventAt = Date.now();

      // Intercept tool_start events for approval
      if (event.type === 'tool_start' && event.toolName && event.toolInput) {
        const approved = await checkToolApproval(sessionId, event.toolName, event.toolInput, workDirectory, onEvent);
        if (!approved) {
          onEvent({
            type: 'tool_end',
            content: '[Denied by user]',
            timestamp: Date.now(),
          });
          continue;
        }
      }

      onEvent(event);

      // Auto-snapshot on turn_end
      if (event.type === 'turn_end') {
        trySnapshot(workDirectory, onEvent);
      }
    }
  } finally {
    clearSessionTimers(session);
  }
}

// ---------------------------------------------------------------------------
// API mode
// ---------------------------------------------------------------------------

async function executeApiMode(
  options: AgentExecuteOptions,
  signal: AbortSignal,
): Promise<void> {
  const {
    sessionId, prompt, workDirectory, onEvent,
    apiProtocol, baseUrl, apiKey, modelId, embeddingAdapter,
  } = options;

  if (!apiProtocol || !baseUrl || !modelId) {
    onEvent({
      type: 'error',
      errorMessage: 'API mode requires apiProtocol, baseUrl, and modelId',
      timestamp: Date.now(),
    });
    return;
  }

  // --- Memory: inject context before LLM call ---
  let enrichedPrompt = prompt;
  try {
    const memoryContext = await buildAgentContext({
      sessionId,
      currentPrompt: prompt,
      maxTokens: 4096,
      embeddingAdapter: embeddingAdapter ?? null,
    });
    if (memoryContext.systemPrefix) {
      enrichedPrompt = memoryContext.systemPrefix + prompt;
    }
  } catch (err) {
    console.warn('[Memory] Context build failed:', err instanceof Error ? err.message : String(err));
  }

  // --- Index user message asynchronously ---
  const userChunkId = tryIndexMessage(sessionId, prompt, 'user');

  switch (apiProtocol) {
    case 'anthropic-messages':
      await streamFromAnthropic(baseUrl, apiKey ?? '', modelId, enrichedPrompt, signal, onEvent);
      break;
    case 'openai-compatible':
      await streamFromOpenAI(baseUrl, apiKey ?? '', modelId, enrichedPrompt, signal, onEvent);
      break;
    case 'ollama':
      await streamFromOllama(baseUrl, modelId, enrichedPrompt, signal, onEvent);
      break;
    default:
      onEvent({
        type: 'error',
        errorMessage: `Unknown API protocol: ${apiProtocol as string}`,
        timestamp: Date.now(),
      });
      return;
  }

  // Auto-snapshot on turn_end
  trySnapshot(workDirectory, onEvent);

  // --- Memory: async compaction check + embedding generation ---
  tryAsyncMemoryOps(sessionId, 8192, embeddingAdapter ?? null, userChunkId ? [userChunkId] : []);
}

type LLMCallParams = {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
};

function createLLMCaller(options: AgentExecuteOptions): (params: LLMCallParams) => AsyncIterable<string> {
  const { apiProtocol, baseUrl, apiKey, modelId } = options;
  if (!apiProtocol || !baseUrl || !modelId) {
    throw new Error('Specialized agents require API mode with apiProtocol/baseUrl/modelId');
  }

  return async function* callLLM(params: LLMCallParams): AsyncIterable<string> {
    switch (apiProtocol) {
      case 'anthropic-messages': {
        const stream = streamAnthropicMessages(baseUrl, apiKey ?? '', {
          model: modelId,
          system: params.system,
          messages: params.messages,
          maxTokens: 8192,
        });
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
            yield chunk.delta.text;
          }
        }
        return;
      }
      case 'openai-compatible': {
        const messages = [
          { role: 'system' as const, content: params.system },
          ...params.messages,
        ];
        const stream = streamOpenAICompatible(baseUrl, apiKey ?? '', {
          model: modelId,
          messages,
          maxTokens: 8192,
        });
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) yield delta;
        }
        return;
      }
      case 'ollama': {
        const userContent = params.messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');
        const prompt = `${params.system}\n\n${userContent}`;
        const stream = streamOllamaGenerate(baseUrl, modelId, prompt);
        for await (const chunk of stream) {
          if (chunk.response) yield chunk.response;
        }
        return;
      }
      default:
        throw new Error(`Unsupported API protocol: ${apiProtocol as string}`);
    }
  };
}

async function executeSpecializedAgent(
  options: AgentExecuteOptions,
  signal: AbortSignal,
): Promise<void> {
  const { agentType, prompt, workDirectory, onEvent } = options;
  const callLLM = createLLMCaller(options);

  if (agentType === 'requirements') {
    const agent = new RequirementsAgent(prompt, {
      onEvent,
      onStepChange: () => {},
      onClarificationNeeded: async (questions) => {
        const answers: Record<string, string> = {};
        for (const q of questions) {
          answers[q] = '待补充';
        }
        return answers;
      },
      callLLM,
    });
    signal.addEventListener('abort', () => agent.abort(), { once: true });
    await agent.run();
    trySnapshot(workDirectory, onEvent);
    return;
  }

  if (agentType === 'design') {
    const agent = new DesignAgent(prompt, {
      onEvent,
      onPassChange: () => {},
      callLLM,
      writeFile: async (relativePath, content) => {
        const outputRoot = resolve(workDirectory, 'src/generated');
        const targetPath = resolve(outputRoot, relativePath);
        if (!targetPath.startsWith(outputRoot + '/')) {
          throw new Error(`Invalid design output path: ${relativePath}`);
        }
        await mkdir(resolve(targetPath, '..'), { recursive: true });
        await writeFile(targetPath, content, 'utf-8');
      },
      startPreview: async () => startPreviewServer(workDirectory),
    });
    signal.addEventListener('abort', () => agent.abort(), { once: true });
    await agent.run();
    trySnapshot(workDirectory, onEvent);
    return;
  }

  if (agentType === 'testing') {
    const agent = new TestingAgent({
      onEvent,
      onStepChange: () => {},
      callLLM,
      workDirectory,
    });
    signal.addEventListener('abort', () => agent.abort(), { once: true });
    await agent.run();
    trySnapshot(workDirectory, onEvent);
    return;
  }

  await executeApiMode(options, signal);
}

// ---------------------------------------------------------------------------
// Adapter bridges
// ---------------------------------------------------------------------------

async function streamFromAnthropic(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  signal: AbortSignal,
  onEvent: (event: CodingAgentEvent) => void,
): Promise<void> {
  const stream: AsyncIterable<AnthropicStreamEvent> = streamAnthropicMessages(baseUrl, apiKey, {
    model,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 8192,
  });

  for await (const chunk of stream) {
    if (signal.aborted) break;

    if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
      onEvent({
        type: 'text_delta',
        content: chunk.delta.text,
        timestamp: Date.now(),
      });
    }
  }

  if (!signal.aborted) {
    onEvent({ type: 'turn_end', timestamp: Date.now() });
  }
}

async function streamFromOpenAI(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  signal: AbortSignal,
  onEvent: (event: CodingAgentEvent) => void,
): Promise<void> {
  const stream: AsyncIterable<OpenAIStreamChunk> = streamOpenAICompatible(baseUrl, apiKey, {
    model,
    messages: [{ role: 'user', content: prompt }],
  });

  for await (const chunk of stream) {
    if (signal.aborted) break;

    const delta = chunk.choices[0]?.delta;
    if (delta?.content) {
      onEvent({
        type: 'text_delta',
        content: delta.content,
        timestamp: Date.now(),
      });
    }
  }

  if (!signal.aborted) {
    onEvent({ type: 'turn_end', timestamp: Date.now() });
  }
}

async function streamFromOllama(
  baseUrl: string,
  model: string,
  prompt: string,
  signal: AbortSignal,
  onEvent: (event: CodingAgentEvent) => void,
): Promise<void> {
  const stream: AsyncIterable<OllamaGenerateChunk> = streamOllamaGenerate(baseUrl, model, prompt);

  for await (const chunk of stream) {
    if (signal.aborted) break;

    if (chunk.response) {
      onEvent({
        type: 'text_delta',
        content: chunk.response,
        timestamp: Date.now(),
      });
    }
  }

  if (!signal.aborted) {
    onEvent({ type: 'turn_end', timestamp: Date.now() });
  }
}

// ---------------------------------------------------------------------------
// Approval integration
// ---------------------------------------------------------------------------

/** Tool names that require approval before execution */
const APPROVAL_REQUIRED_TOOLS: Record<string, ApprovalAction> = {
  'Bash': 'shell-command',
  'bash': 'shell-command',
  'shell': 'shell-command',
  'execute_command': 'shell-command',
  'run_command': 'shell-command',
  'terminal': 'shell-command',
};

async function checkToolApproval(
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  workDirectory: string,
  onEvent: (event: CodingAgentEvent) => void,
): Promise<boolean> {
  const outsidePath = findOutsideWorkspacePath(toolName, toolInput, workDirectory);
  if (outsidePath) {
    const details = `Tool: ${toolName}\nPath: ${outsidePath}\nReason: write outside workspace`;
    const { waitForApproval } = createApprovalRequest(sessionId, 'file-write-outside', details, outsidePath);
    onEvent({
      type: 'approval_req',
      toolName,
      toolInput,
      content: details,
      timestamp: Date.now(),
    });
    const approved = await waitForApproval;
    if (!approved) return false;
  }

  const action = APPROVAL_REQUIRED_TOOLS[toolName];
  if (!action) return true; // No approval needed

  const command = String(toolInput.command ?? toolInput.cmd ?? toolInput.script ?? '');
  const details = `Tool: ${toolName}\nCommand: ${command}`;

  const { waitForApproval } = createApprovalRequest(sessionId, action, details, command);

  // Emit approval_req event so the UI shows the dialog
  onEvent({
    type: 'approval_req',
    toolName,
    toolInput,
    content: details,
    timestamp: Date.now(),
  });

  return waitForApproval;
}

function findOutsideWorkspacePath(
  toolName: string,
  toolInput: Record<string, unknown>,
  workDirectory: string,
): string | null {
  const candidates = collectPathCandidates(toolInput);
  const command = String(toolInput.command ?? toolInput.cmd ?? toolInput.script ?? '');
  if (command) {
    candidates.push(...extractPathsFromCommand(command));
  }
  if (!isLikelyFileWriteTool(toolName) && candidates.length === 0) return null;
  for (const candidate of candidates) {
    const absolute = isAbsolute(candidate)
      ? resolve(candidate)
      : resolve(workDirectory, candidate);
    if (!isWithinWorkspace(workDirectory, absolute)) {
      return absolute;
    }
  }
  return null;
}

function isLikelyFileWriteTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return (
    lower.includes('write') ||
    lower.includes('edit') ||
    lower.includes('create') ||
    lower.includes('delete') ||
    lower.includes('move') ||
    lower.includes('rename')
  );
}

function isWithinWorkspace(workDirectory: string, targetPath: string): boolean {
  const root = resolve(workDirectory);
  const target = resolve(targetPath);
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function collectPathCandidates(input: Record<string, unknown>): string[] {
  const keys = new Set([
    'path', 'file', 'file_path', 'filepath', 'target_path', 'targetPath', 'output_path', 'outputPath',
  ]);
  const results: string[] = [];

  const walk = (value: unknown, depth: number) => {
    if (depth > 4 || value == null) return;
    if (typeof value === 'string') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === 'string' && keys.has(k) && v.trim().length > 0) {
          results.push(v.trim());
        } else {
          walk(v, depth + 1);
        }
      }
    }
  };

  walk(input, 0);
  return results;
}

function extractPathsFromCommand(command: string): string[] {
  const matches = command.match(/(?:^|\s)(\/[^\s"'`]+)/g) ?? [];
  return matches.map((m) => m.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Timer cleanup
// ---------------------------------------------------------------------------

function clearSessionTimers(session: ActiveSession): void {
  if (session.overallTimer) {
    clearTimeout(session.overallTimer);
    session.overallTimer = undefined;
  }
  if (session.watchdogInterval) {
    clearInterval(session.watchdogInterval);
    session.watchdogInterval = undefined;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trySnapshot(
  workDirectory: string,
  onEvent: (event: CodingAgentEvent) => void,
): void {
  try {
    createSnapshot(workDirectory);
  } catch (err) {
    onEvent({
      type: 'error',
      errorMessage: `Git snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
      timestamp: Date.now(),
    });
  }
}

// ---------------------------------------------------------------------------
// Memory helpers (best-effort, never block agent execution)
// ---------------------------------------------------------------------------

function tryIndexMessage(
  sessionId: string,
  content: string,
  role: 'user' | 'assistant',
): string | null {
  try {
    return indexConversationMessage(sessionId, content, role);
  } catch {
    return null;
  }
}

function tryAsyncMemoryOps(
  sessionId: string,
  maxContextTokens: number,
  embeddingAdapter: EmbeddingAdapter | null,
  newChunkIds: string[],
): void {
  // Fire-and-forget: compaction check
  (async () => {
    try {
      if (shouldCompact(sessionId, maxContextTokens)) {
        // Simple summarize function that calls the same LLM
        // This is a best-effort compaction — use a simple fetch-based call
        await compactSession(sessionId, maxContextTokens, async (prompt) => {
          // Compaction uses a minimal prompt; caller should provide a real summarize fn
          // For now, return the first 500 chars as a basic fallback
          console.warn('[Memory] Compaction triggered but no LLM callback configured — using truncation fallback');
          return prompt.slice(0, 500);
        });
      }
    } catch (err) {
      console.warn('[Memory] Compaction failed:', err instanceof Error ? err.message : String(err));
    }
  })();

  // Fire-and-forget: generate embeddings for new chunks
  if (embeddingAdapter?.isAvailable() && newChunkIds.length > 0) {
    (async () => {
      try {
        await generateEmbeddingsForChunks(
          newChunkIds,
          (texts) => embeddingAdapter.embed(texts),
          (id) => getChunk(id)?.content,
          updateChunkEmbedding,
        );
      } catch (err) {
        console.warn('[Memory] Embedding generation failed:', err instanceof Error ? err.message : String(err));
      }
    })();
  }
}
