/**
 * Memory Module — Zod v4 schemas & TypeScript types
 * Mirrors CoPaw dual-layer memory concepts (in-memory context + persistent search).
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Memory Chunk
// ---------------------------------------------------------------------------

export const MemoryChunkSourceSchema = z.enum([
  'conversation',
  'summary',
  'user_note',
  'compaction',
]);

export type MemoryChunkSource = z.infer<typeof MemoryChunkSourceSchema>;

export const MemoryChunkSchema = z.object({
  id: z.string(),
  sessionId: z.string().nullable(),
  source: MemoryChunkSourceSchema,
  content: z.string(),
  embedding: z.instanceof(Buffer).nullable().optional(),
  tokenCount: z.number().int().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type MemoryChunk = z.infer<typeof MemoryChunkSchema>;

// ---------------------------------------------------------------------------
// Memory Summary
// ---------------------------------------------------------------------------

export const SummaryTypeSchema = z.enum(['compaction', 'daily', 'session_end']);

export type SummaryType = z.infer<typeof SummaryTypeSchema>;

export const MemorySummarySchema = z.object({
  id: z.string(),
  sessionId: z.string().nullable(),
  summaryType: SummaryTypeSchema,
  content: z.string(),
  sourceMessageIds: z.string().nullable().optional(),
  createdAt: z.string(),
});

export type MemorySummary = z.infer<typeof MemorySummarySchema>;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface MemorySearchResult {
  chunkId: string;
  content: string;
  score: number;
  source: MemoryChunkSource;
  sessionId: string | null;
  createdAt: string;
}

export interface SearchOptions {
  query: string;
  maxResults?: number;
  minScore?: number;
  sessionId?: string | null;
}

// ---------------------------------------------------------------------------
// Context Builder
// ---------------------------------------------------------------------------

export interface ContextBuildResult {
  systemPrefix: string;
  tokensBudgetUsed: number;
  memoriesInjected: number;
  summaryIncluded: boolean;
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

export interface CompactionResult {
  compacted: boolean;
  summaryId: string | null;
  originalTokens: number;
  compactedTokens: number;
}

// ---------------------------------------------------------------------------
// Memory Config
// ---------------------------------------------------------------------------

export const MemoryConfigSchema = z.object({
  compactRatio: z.number().min(0).max(1).default(0.7),
  keepRecentMessages: z.number().int().min(1).default(10),
  maxSearchResults: z.number().int().min(1).default(5),
  embeddingEnabled: z.boolean().default(true),
  vectorWeight: z.number().min(0).max(1).default(0.7),
  bm25Weight: z.number().min(0).max(1).default(0.3),
});

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  compactRatio: 0.7,
  keepRecentMessages: 10,
  maxSearchResults: 5,
  embeddingEnabled: true,
  vectorWeight: 0.7,
  bm25Weight: 0.3,
};

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

export interface EmbeddingAdapter {
  isAvailable(): boolean;
  embed(texts: string[]): Promise<Float32Array[]>;
  getDimensions(): number;
}

// ---------------------------------------------------------------------------
// Memory Stats (for IPC / UI)
// ---------------------------------------------------------------------------

export interface MemoryStats {
  totalChunks: number;
  totalSummaries: number;
  chunksWithEmbeddings: number;
  oldestChunkDate: string | null;
  newestChunkDate: string | null;
}
