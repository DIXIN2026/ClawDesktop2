/**
 * Agent Executor
 * Unified CLI / API dual-mode dispatch for coding agent sessions.
 */

import type { CodingAgentEvent } from '../providers/types.js';
import { getCliRunner } from '../providers/cli-agents/runner.js';
import { streamAnthropicMessages } from '../providers/adapters/anthropic.js';
import type { AnthropicContentBlock, AnthropicStreamEvent } from '../providers/adapters/anthropic.js';
import { streamOpenAICompatible } from '../providers/adapters/openai-compat.js';
import type { OpenAIContentPart, OpenAIStreamChunk } from '../providers/adapters/openai-compat.js';
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
import { BrowserWindow } from 'electron';
import { startPreviewServer } from '../agents/design-preview.js';
import { buildAgentContext } from '../memory/context-builder.js';
import {
  indexConversationMessage,
  shouldCompact,
  compactSession,
  generateEmbeddingsForChunks,
} from '../memory/compaction-engine.js';
import { getChunk, updateChunkEmbedding, getMemoryConfig } from '../memory/memory-store.js';
import type { EmbeddingAdapter } from '../memory/types.js';
import {
  getMessageBus,
  createAgentId,
  type AgentType,
} from './message-bus.js';

const PREVIEW_SCREENSHOT_WIDTH = 1365;
const PREVIEW_SCREENSHOT_HEIGHT = 900;
const PREVIEW_SCREENSHOT_TIMEOUT_MS = 20_000;
const COMPACTION_SYSTEM_PROMPT = 'You are a conversation summarizer. Return only a concise factual summary that preserves key decisions, technical context, user preferences, constraints, and next actions.';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function capturePreviewScreenshot(previewUrl: string): Promise<{
  mimeType: string;
  data: string;
  width: number;
  height: number;
}> {
  if (!/^https?:\/\//i.test(previewUrl)) {
    throw new Error(`Unsupported preview URL for screenshot: ${previewUrl}`);
  }

  const win = new BrowserWindow({
    show: false,
    width: PREVIEW_SCREENSHOT_WIDTH,
    height: PREVIEW_SCREENSHOT_HEIGHT,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  try {
    await withTimeout(win.loadURL(previewUrl), PREVIEW_SCREENSHOT_TIMEOUT_MS, 'Preview load');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1200));
    const image = await withTimeout(
      win.webContents.capturePage(),
      PREVIEW_SCREENSHOT_TIMEOUT_MS,
      'Preview capture',
    );
    const resized = image.resize({ width: 1280, quality: 'good' });
    const jpeg = resized.toJPEG(82);
    const size = resized.getSize();

    return {
      mimeType: 'image/jpeg',
      data: jpeg.toString('base64'),
      width: size.width,
      height: size.height,
    };
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}

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
  attachments?: Array<{
    type: 'image';
    mimeType: string;
    data: string;
    name?: string;
    size?: number;
  }>;
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
  respondClarification(
    clarificationId: string,
    answers: Record<string, string>,
    sessionId?: string,
  ): boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAgentExecutor(): AgentExecutor {
  const activeSessions = new Map<string, ActiveSession>();
  const bus = getMessageBus();
  const pendingClarifications = new Map<string, {
    sessionId: string;
    questions: string[];
    resolve: (answers: Record<string, string>) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  const CLARIFICATION_TIMEOUT_MS = 5 * 60 * 1000;

  function normalizeClarificationAnswers(
    questions: string[],
    answers: Record<string, string>,
  ): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const question of questions) {
      const answer = answers[question];
      if (typeof answer !== 'string') continue;
      const trimmed = answer.trim();
      if (trimmed.length === 0) continue;
      normalized[question] = trimmed;
    }
    return normalized;
  }

  function clearClarificationsForSession(sessionId: string): void {
    for (const [clarificationId, pending] of pendingClarifications.entries()) {
      if (pending.sessionId !== sessionId) continue;
      clearTimeout(pending.timer);
      pending.resolve({});
      pendingClarifications.delete(clarificationId);
    }
  }

  function requestClarification(params: {
    sessionId: string;
    questions: string[];
    onEvent: (event: CodingAgentEvent) => void;
    signal?: AbortSignal;
  }): Promise<Record<string, string>> {
    const { sessionId, questions, onEvent, signal } = params;
    if (questions.length === 0) return Promise.resolve({});

    const clarificationId = `clarification-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const requestedAt = Date.now();
    const clarificationExpiresAt = requestedAt + CLARIFICATION_TIMEOUT_MS;
    onEvent({
      type: 'clarification_req',
      clarificationId,
      questions,
      clarificationExpiresAt,
      timestamp: requestedAt,
    });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const pending = pendingClarifications.get(clarificationId);
        if (!pending) return;
        pendingClarifications.delete(clarificationId);
        resolve({});
      }, CLARIFICATION_TIMEOUT_MS);

      pendingClarifications.set(clarificationId, {
        sessionId,
        questions,
        resolve,
        timer,
      });

      signal?.addEventListener('abort', () => {
        const pending = pendingClarifications.get(clarificationId);
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingClarifications.delete(clarificationId);
        pending.resolve({});
      }, { once: true });
    });
  }

  async function execute(options: AgentExecuteOptions): Promise<void> {
    const { sessionId, mode, agentType } = options;

    if (activeSessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is already running`);
    }

    const agentId = createAgentId(agentType, sessionId);
    bus.register({
      id: agentId,
      type: agentType as AgentType,
      capabilities: [],
      status: 'busy',
      sessionId,
    });

    const abortController = new AbortController();
    const session: ActiveSession = { abortController };
    activeSessions.set(sessionId, session);

    try {
      if (agentType !== 'coding' && mode === 'api') {
        await executeSpecializedAgent(options, abortController.signal, { requestClarification });
      } else if (mode === 'cli') {
        await executeCliMode(options, session);
      } else {
        await executeApiMode(options, abortController.signal);
      }
    } finally {
      clearClarificationsForSession(sessionId);
      activeSessions.delete(sessionId);
      bus.unregister(agentId);
    }
  }

  async function abort(sessionId: string): Promise<void> {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    clearSessionTimers(session);
    session.abortController.abort();
    clearClarificationsForSession(sessionId);
    if (session.runner) {
      await session.runner.abort();
    }
    activeSessions.delete(sessionId);
  }

  function isRunning(sessionId: string): boolean {
    return activeSessions.has(sessionId);
  }

  function respondClarification(
    clarificationId: string,
    answers: Record<string, string>,
    sessionId?: string,
  ): boolean {
    const pending = pendingClarifications.get(clarificationId);
    if (!pending) return false;
    if (sessionId && pending.sessionId !== sessionId) return false;

    clearTimeout(pending.timer);
    pendingClarifications.delete(clarificationId);
    pending.resolve(normalizeClarificationAnswers(pending.questions, answers));
    return true;
  }

  return { execute, abort, isRunning, respondClarification };
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
    sessionId, prompt, workDirectory, cliBackend, onEvent, modelId, embeddingAdapter,
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
  const newChunkIds: string[] = [];
  const userChunkId = tryIndexMessage(sessionId, prompt, 'user');
  if (userChunkId) {
    newChunkIds.push(userChunkId);
  }
  let assistantOutput = '';
  let assistantIndexed = false;

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

      if (event.type === 'text_delta' && event.content) {
        assistantOutput += event.content;
      }
      onEvent(event);

      // Auto-snapshot on turn_end
      if (event.type === 'turn_end') {
        if (!assistantIndexed && assistantOutput.trim().length > 0) {
          const assistantChunkId = tryIndexMessage(sessionId, assistantOutput, 'assistant');
          if (assistantChunkId) {
            newChunkIds.push(assistantChunkId);
          }
          assistantIndexed = true;
        }
        trySnapshot(workDirectory, onEvent);
      }
    }
  } finally {
    clearSessionTimers(session);
    if (!assistantIndexed && assistantOutput.trim().length > 0) {
      const assistantChunkId = tryIndexMessage(sessionId, assistantOutput, 'assistant');
      if (assistantChunkId) {
        newChunkIds.push(assistantChunkId);
      }
    }
    tryAsyncMemoryOps(sessionId, 8192, embeddingAdapter ?? null, newChunkIds);
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
    apiProtocol, baseUrl, apiKey, modelId, embeddingAdapter, attachments = [],
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
  const newChunkIds: string[] = [];
  const userChunkId = tryIndexMessage(sessionId, prompt, 'user');
  if (userChunkId) {
    newChunkIds.push(userChunkId);
  }
  let assistantOutput = '';
  const forwardEvent = (event: CodingAgentEvent) => {
    if (event.type === 'text_delta' && event.content) {
      assistantOutput += event.content;
    }
    onEvent(event);
  };
  const imageAttachments = attachments.filter((att) =>
    att.type === 'image'
    && typeof att.mimeType === 'string'
    && typeof att.data === 'string'
    && att.mimeType.startsWith('image/')
    && att.data.length > 0,
  );

  switch (apiProtocol) {
    case 'anthropic-messages': {
      const userContent = buildAnthropicUserContent(enrichedPrompt, imageAttachments);
      await streamFromAnthropic(baseUrl, apiKey ?? '', modelId, userContent, signal, forwardEvent);
      break;
    }
    case 'openai-compatible': {
      const userContent = buildOpenAIUserContent(enrichedPrompt, imageAttachments);
      await streamFromOpenAI(baseUrl, apiKey ?? '', modelId, userContent, signal, forwardEvent);
      break;
    }
    case 'ollama':
      if (imageAttachments.length > 0) {
        forwardEvent({
          type: 'error',
          errorMessage: 'Ollama API mode does not support image attachments in this build',
          timestamp: Date.now(),
        });
        return;
      }
      await streamFromOllama(baseUrl, modelId, enrichedPrompt, signal, forwardEvent);
      break;
    default:
      forwardEvent({
        type: 'error',
        errorMessage: `Unknown API protocol: ${apiProtocol as string}`,
        timestamp: Date.now(),
      });
      return;
  }

  if (assistantOutput.trim().length > 0) {
    const assistantChunkId = tryIndexMessage(sessionId, assistantOutput, 'assistant');
    if (assistantChunkId) {
      newChunkIds.push(assistantChunkId);
    }
  }

  // Auto-snapshot on turn_end
  trySnapshot(workDirectory, forwardEvent);

  // --- Memory: async compaction check + embedding generation ---
  const summarizeForCompaction = createCompactionSummarizeFn(options);
  tryAsyncMemoryOps(sessionId, 8192, embeddingAdapter ?? null, newChunkIds, summarizeForCompaction);
}

function buildAnthropicUserContent(
  prompt: string,
  attachments: Array<{ mimeType: string; data: string }>,
): string | AnthropicContentBlock[] {
  if (attachments.length === 0) {
    return prompt;
  }
  const blocks: AnthropicContentBlock[] = [];
  if (prompt.trim().length > 0) {
    blocks.push({ type: 'text', text: prompt });
  }
  for (const attachment of attachments) {
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: attachment.mimeType,
        data: attachment.data,
      },
    });
  }
  return blocks;
}

function buildOpenAIUserContent(
  prompt: string,
  attachments: Array<{ mimeType: string; data: string }>,
): string | OpenAIContentPart[] {
  if (attachments.length === 0) {
    return prompt;
  }
  const parts: OpenAIContentPart[] = [];
  if (prompt.trim().length > 0) {
    parts.push({ type: 'text', text: prompt });
  }
  for (const attachment of attachments) {
    parts.push({
      type: 'image_url',
      image_url: {
        url: `data:${attachment.mimeType};base64,${attachment.data}`,
      },
    });
  }
  return parts;
}

type LLMCallParams = {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: LLMMessageContent }>;
};

type LLMImagePart = {
  type: 'image';
  mimeType: string;
  data: string;
};

type LLMTextPart = {
  type: 'text';
  text: string;
};

type LLMMessageContent = string | Array<LLMTextPart | LLMImagePart>;

function toAnthropicContent(content: LLMMessageContent): string | AnthropicContentBlock[] {
  if (typeof content === 'string') {
    return content;
  }
  const blocks: AnthropicContentBlock[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text.length > 0) {
        blocks.push({ type: 'text', text: part.text });
      }
      continue;
    }
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: part.mimeType,
        data: part.data,
      },
    });
  }
  if (blocks.length === 1 && blocks[0]?.type === 'text' && typeof blocks[0].text === 'string') {
    return blocks[0].text;
  }
  return blocks;
}

function toOpenAIContent(content: LLMMessageContent): string | OpenAIContentPart[] {
  if (typeof content === 'string') {
    return content;
  }
  const parts: OpenAIContentPart[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text.length > 0) {
        parts.push({ type: 'text', text: part.text });
      }
      continue;
    }
    parts.push({
      type: 'image_url',
      image_url: {
        url: `data:${part.mimeType};base64,${part.data}`,
      },
    });
  }
  if (parts.length === 1 && parts[0]?.type === 'text') {
    return parts[0].text;
  }
  return parts;
}

function hasImagePart(content: LLMMessageContent): boolean {
  return Array.isArray(content) && content.some((part) => part.type === 'image');
}

function flattenContentToText(content: LLMMessageContent): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .map((part) => (part.type === 'text' ? part.text : '[image attachment omitted for ollama]'))
    .join('\n');
}

function createLLMCaller(options: AgentExecuteOptions): (params: LLMCallParams) => AsyncIterable<string> {
  const { apiProtocol, baseUrl, apiKey, modelId } = options;
  if (!apiProtocol || !baseUrl || !modelId) {
    throw new Error('Specialized agents require API mode with apiProtocol/baseUrl/modelId');
  }

  return async function* callLLM(params: LLMCallParams): AsyncIterable<string> {
    switch (apiProtocol) {
      case 'anthropic-messages': {
        const messages = params.messages.map((msg) => ({
          role: msg.role,
          content: toAnthropicContent(msg.content),
        }));
        const stream = streamAnthropicMessages(baseUrl, apiKey ?? '', {
          model: modelId,
          system: params.system,
          messages,
          maxTokens: 8192,
          enableCaching: true,
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
          ...params.messages.map((msg) => ({
            role: msg.role,
            content: toOpenAIContent(msg.content),
          })),
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
        if (params.messages.some((m) => hasImagePart(m.content))) {
          throw new Error('Ollama API mode does not support image attachments in this build');
        }
        const userContent = params.messages
          .map((m) => `${m.role}: ${flattenContentToText(m.content)}`)
          .join('\n\n');
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

function createCompactionSummarizeFn(
  options: AgentExecuteOptions,
): ((prompt: string) => Promise<string>) | null {
  if (!options.apiProtocol || !options.baseUrl || !options.modelId) return null;
  const callLLM = createLLMCaller(options);
  return async (prompt: string) => {
    let summary = '';
    for await (const delta of callLLM({
      system: COMPACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    })) {
      summary += delta;
    }
    return summary.trim();
  };
}

async function executeSpecializedAgent(
  options: AgentExecuteOptions,
  signal: AbortSignal,
  helpers?: {
    requestClarification: (params: {
      sessionId: string;
      questions: string[];
      onEvent: (event: CodingAgentEvent) => void;
      signal?: AbortSignal;
    }) => Promise<Record<string, string>>;
  },
): Promise<void> {
  const {
    sessionId,
    agentType,
    prompt,
    workDirectory,
    onEvent,
    embeddingAdapter,
    attachments = [],
  } = options;
  const callLLM = createLLMCaller(options);
  const summarizeForCompaction = createCompactionSummarizeFn(options);
  const imageAttachments = attachments.filter((att) =>
    att.type === 'image'
    && typeof att.mimeType === 'string'
    && typeof att.data === 'string'
    && att.mimeType.startsWith('image/')
    && att.data.length > 0,
  );
  const newChunkIds: string[] = [];
  const userChunkId = tryIndexMessage(sessionId, prompt, 'user');
  if (userChunkId) {
    newChunkIds.push(userChunkId);
  }
  let assistantOutput = '';
  const forwardEvent = (event: CodingAgentEvent) => {
    if (event.type === 'text_delta' && event.content) {
      assistantOutput += event.content;
    }
    onEvent(event);
  };

  if (agentType === 'requirements') {
    const agent = new RequirementsAgent(prompt, {
      onEvent: forwardEvent,
      onStepChange: () => {},
      onClarificationNeeded: async (questions) => {
        return (helpers?.requestClarification ?? (async () => ({})))({
          sessionId,
          questions,
          onEvent: forwardEvent,
          signal,
        });
      },
      callLLM,
      initialAttachments: imageAttachments,
    });
    signal.addEventListener('abort', () => agent.abort(), { once: true });
    await agent.run();
    if (assistantOutput.trim().length > 0) {
      const assistantChunkId = tryIndexMessage(sessionId, assistantOutput, 'assistant');
      if (assistantChunkId) {
        newChunkIds.push(assistantChunkId);
      }
    }
    trySnapshot(workDirectory, forwardEvent);
    tryAsyncMemoryOps(sessionId, 8192, embeddingAdapter ?? null, newChunkIds, summarizeForCompaction);
    return;
  }

  if (agentType === 'design') {
    const agent = new DesignAgent(prompt, {
      onEvent: forwardEvent,
      onPassChange: () => {},
      callLLM,
      initialAttachments: imageAttachments,
      writeFile: async (relativePath, content) => {
        const outputRoot = resolve(workDirectory, 'src/generated');
        const targetPath = resolve(outputRoot, relativePath);
        const relativeTarget = relative(outputRoot, targetPath);
        if (relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
          throw new Error(`Invalid design output path: ${relativePath}`);
        }
        await mkdir(resolve(targetPath, '..'), { recursive: true });
        await writeFile(targetPath, content, 'utf-8');
      },
      startPreview: async () => startPreviewServer(workDirectory),
      capturePreviewScreenshot: async (previewUrl) => capturePreviewScreenshot(previewUrl),
    });
    signal.addEventListener('abort', () => agent.abort(), { once: true });
    await agent.run();
    if (assistantOutput.trim().length > 0) {
      const assistantChunkId = tryIndexMessage(sessionId, assistantOutput, 'assistant');
      if (assistantChunkId) {
        newChunkIds.push(assistantChunkId);
      }
    }
    trySnapshot(workDirectory, forwardEvent);
    tryAsyncMemoryOps(sessionId, 8192, embeddingAdapter ?? null, newChunkIds, summarizeForCompaction);
    return;
  }

  if (agentType === 'testing') {
    const agent = new TestingAgent({
      onEvent: forwardEvent,
      onStepChange: () => {},
      callLLM,
      initialAttachments: imageAttachments,
      workDirectory,
    });
    signal.addEventListener('abort', () => agent.abort(), { once: true });
    await agent.run();
    if (assistantOutput.trim().length > 0) {
      const assistantChunkId = tryIndexMessage(sessionId, assistantOutput, 'assistant');
      if (assistantChunkId) {
        newChunkIds.push(assistantChunkId);
      }
    }
    trySnapshot(workDirectory, forwardEvent);
    tryAsyncMemoryOps(sessionId, 8192, embeddingAdapter ?? null, newChunkIds, summarizeForCompaction);
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
  userContent: string | AnthropicContentBlock[],
  signal: AbortSignal,
  onEvent: (event: CodingAgentEvent) => void,
  systemPrompt?: string,
): Promise<void> {
  const stream: AsyncIterable<AnthropicStreamEvent> = streamAnthropicMessages(baseUrl, apiKey, {
    model,
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 8192,
    system: systemPrompt,
    enableCaching: true,
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
    
    if (chunk.type === 'message_delta' && chunk.usage) {
      const cacheCreated = chunk.usage.cache_creation_input_tokens ?? 0;
      const cacheRead = chunk.usage.cache_read_input_tokens ?? 0;
      if (cacheCreated > 0 || cacheRead > 0) {
        console.log(`[PromptCaching] created: ${cacheCreated}, read: ${cacheRead}`);
      }
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
  userContent: string | OpenAIContentPart[],
  signal: AbortSignal,
  onEvent: (event: CodingAgentEvent) => void,
): Promise<void> {
  const stream: AsyncIterable<OpenAIStreamChunk> = streamOpenAICompatible(baseUrl, apiKey, {
    model,
    messages: [{ role: 'user', content: userContent }],
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
  summarizeForCompaction?: ((prompt: string) => Promise<string>) | null,
): void {
  // Fire-and-forget: compaction check
  (async () => {
    try {
      if (shouldCompact(sessionId, maxContextTokens)) {
        await compactSession(
          sessionId,
          maxContextTokens,
          summarizeForCompaction ?? (async (prompt) => {
            console.warn('[Memory] Compaction triggered without summarize callback — using truncation fallback');
            return prompt.slice(0, 500);
          }),
        );
      }
    } catch (err) {
      console.warn('[Memory] Compaction failed:', err instanceof Error ? err.message : String(err));
    }
  })();

  // Fire-and-forget: generate embeddings for new chunks
  const memoryConfig = getMemoryConfig();
  if (memoryConfig.embeddingEnabled && embeddingAdapter?.isAvailable() && newChunkIds.length > 0) {
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
