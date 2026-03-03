/**
 * Compaction Engine
 * Token-aware session compaction — mirrors CoPaw MemoryCompactionHook.
 *
 * When a session's message token count exceeds (maxTokens × compactRatio × 0.9),
 * it summarizes older messages via the configured LLM and stores the result.
 */
import { randomUUID } from 'crypto';
import { getSessionMessages } from '../utils/db.js';
import {
  insertMemorySummary,
  insertMemoryChunk,
  getMemoryConfig,
} from './memory-store.js';
import { estimateTokens } from './context-builder.js';
import type { CompactionResult } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback to invoke the LLM for summarization */
export type SummarizeFn = (prompt: string) => Promise<string>;

// ---------------------------------------------------------------------------
// Compaction check
// ---------------------------------------------------------------------------

export function shouldCompact(sessionId: string, maxContextTokens: number): boolean {
  const config = getMemoryConfig();
  const messages = getSessionMessages(sessionId);

  let totalTokens = 0;
  for (const msg of messages) {
    totalTokens += estimateTokens(msg.content);
  }

  const threshold = maxContextTokens * config.compactRatio * 0.9;
  return totalTokens > threshold;
}

// ---------------------------------------------------------------------------
// Compaction execution
// ---------------------------------------------------------------------------

const COMPACTION_PROMPT_TEMPLATE = `You are a conversation summarizer. Summarize the following conversation into a concise summary that preserves:
1. Key decisions and conclusions
2. Important facts and preferences mentioned
3. Technical details and context that may be needed later
4. Action items or next steps

Keep the summary factual and well-structured. Use bullet points for clarity.
Do NOT include any preamble — start directly with the summary content.

<conversation>
{MESSAGES}
</conversation>`;

export async function compactSession(
  sessionId: string,
  maxContextTokens: number,
  summarizeFn: SummarizeFn,
): Promise<CompactionResult> {
  const config = getMemoryConfig();
  const messages = getSessionMessages(sessionId);

  if (messages.length === 0) {
    return { compacted: false, summaryId: null, originalTokens: 0, compactedTokens: 0 };
  }

  // Calculate total tokens
  let totalTokens = 0;
  for (const msg of messages) {
    totalTokens += estimateTokens(msg.content);
  }

  const threshold = maxContextTokens * config.compactRatio * 0.9;
  if (totalTokens <= threshold) {
    return { compacted: false, summaryId: null, originalTokens: totalTokens, compactedTokens: 0 };
  }

  // Separate system messages from compactable messages
  const keepRecent = config.keepRecentMessages;
  const compactableMessages = messages.filter((m) => m.role !== 'system');

  // Keep the most recent N messages, compact the rest
  const toCompact = compactableMessages.slice(0, Math.max(0, compactableMessages.length - keepRecent));

  if (toCompact.length === 0) {
    return { compacted: false, summaryId: null, originalTokens: totalTokens, compactedTokens: 0 };
  }

  // Build conversation text for summarization
  const conversationText = toCompact
    .map((m) => `[${m.role}]: ${m.content}`)
    .join('\n\n');

  const prompt = COMPACTION_PROMPT_TEMPLATE.replace('{MESSAGES}', conversationText);

  // Call LLM for summarization
  const summaryContent = await summarizeFn(prompt);

  if (!summaryContent || summaryContent.trim().length === 0) {
    return { compacted: false, summaryId: null, originalTokens: totalTokens, compactedTokens: 0 };
  }

  const summaryId = randomUUID();
  const compactedTokens = estimateTokens(summaryContent);
  const sourceMessageIds = toCompact.map((m) => m.id).join(',');

  // Store summary
  insertMemorySummary({
    id: summaryId,
    sessionId,
    summaryType: 'compaction',
    content: summaryContent,
    sourceMessageIds,
  });

  // Also store as a memory chunk for cross-session search
  insertMemoryChunk({
    id: `chunk-${summaryId}`,
    sessionId,
    source: 'compaction',
    content: summaryContent,
    tokenCount: compactedTokens,
  });

  return {
    compacted: true,
    summaryId,
    originalTokens: totalTokens,
    compactedTokens,
  };
}

// ---------------------------------------------------------------------------
// Async indexing helper — index new conversation content into memory
// ---------------------------------------------------------------------------

export function indexConversationMessage(
  sessionId: string,
  content: string,
  role: 'user' | 'assistant',
): string {
  const chunkId = randomUUID();
  const tokenCount = estimateTokens(content);

  // Only index messages with meaningful content
  if (content.trim().length < 10) return chunkId;

  insertMemoryChunk({
    id: chunkId,
    sessionId,
    source: 'conversation',
    content: `[${role}]: ${content}`,
    tokenCount,
  });

  return chunkId;
}

// ---------------------------------------------------------------------------
// Async embedding generation
// ---------------------------------------------------------------------------

export async function generateEmbeddingsForChunks(
  chunkIds: string[],
  embedFn: (texts: string[]) => Promise<Float32Array[]>,
  getChunkContent: (id: string) => string | undefined,
  updateEmbedding: (chunkId: string, embedding: Buffer) => void,
): Promise<number> {
  const texts: string[] = [];
  const validIds: string[] = [];

  for (const id of chunkIds) {
    const content = getChunkContent(id);
    if (content) {
      texts.push(content);
      validIds.push(id);
    }
  }

  if (texts.length === 0) return 0;

  const embeddings = await embedFn(texts);

  for (let i = 0; i < validIds.length; i++) {
    const embedding = embeddings[i];
    if (embedding) {
      updateEmbedding(validIds[i]!, Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength));
    }
  }

  return validIds.length;
}
