/**
 * Memory Module — Public API
 * CoPaw-style dual-layer memory for ClawDesktop2.
 */

export type {
  MemoryChunk,
  MemoryChunkSource,
  MemorySummary,
  SummaryType,
  MemorySearchResult,
  SearchOptions,
  ContextBuildResult,
  CompactionResult,
  MemoryConfig,
  EmbeddingAdapter,
  MemoryStats,
  MemoryPreferenceObservation,
} from './types.js';

export { DEFAULT_MEMORY_CONFIG } from './types.js';

export {
  insertMemoryChunk,
  updateChunkEmbedding,
  getChunk,
  getSessionChunks,
  getChunksWithEmbeddings,
  getChunksWithoutEmbeddings,
  deleteSessionMemory,
  deleteMemoryChunk,
  insertMemorySummary,
  getSessionSummaries,
  getLatestSessionSummary,
  searchByBM25,
  getMemoryConfig,
  setMemoryConfigValue,
  getMemoryStats,
  upsertPreferenceObservation,
  listPreferenceObservations,
  deletePreferenceObservation,
} from './memory-store.js';

export {
  createEmbeddingAdapter,
  embeddingToBuffer,
  bufferToEmbedding,
  cosineSimilarity,
} from './embedding-adapter.js';

export { searchMemory } from './memory-search.js';

export { buildAgentContext, estimateTokens } from './context-builder.js';

export {
  shouldCompact,
  compactSession,
  indexConversationMessage,
  generateEmbeddingsForChunks,
} from './compaction-engine.js';

export type { SummarizeFn } from './compaction-engine.js';
