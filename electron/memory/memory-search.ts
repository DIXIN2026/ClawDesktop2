/**
 * Memory Search — Hybrid BM25 + Vector search
 * Mirrors CoPaw ReMeFb.memory_search() with configurable fusion weights.
 *
 * - BM25 via SQLite FTS5
 * - Vector via brute-force cosine similarity (< 10ms for < 10K chunks)
 * - Fusion: hybrid = vectorWeight * vectorScore + bm25Weight * bm25Score
 * - Falls back to pure BM25 when no embedding adapter is available
 */
import { searchByBM25, getChunksWithEmbeddings, getChunk, getMemoryConfig } from './memory-store.js';
import { cosineSimilarity, bufferToEmbedding } from './embedding-adapter.js';
import type { EmbeddingAdapter } from './types.js';
import type { MemorySearchResult, SearchOptions } from './types.js';

// ---------------------------------------------------------------------------
// Score normalization
// ---------------------------------------------------------------------------

function normalizeScores(scores: Map<string, number>): Map<string, number> {
  if (scores.size === 0) return scores;

  let max = -Infinity;
  let min = Infinity;

  for (const s of scores.values()) {
    if (s > max) max = s;
    if (s < min) min = s;
  }

  const range = max - min;
  if (range === 0) {
    // All scores equal → normalize to 1.0
    const result = new Map<string, number>();
    for (const key of scores.keys()) {
      result.set(key, 1.0);
    }
    return result;
  }

  const result = new Map<string, number>();
  for (const [key, val] of scores) {
    result.set(key, (val - min) / range);
  }
  return result;
}

// ---------------------------------------------------------------------------
// BM25 search
// ---------------------------------------------------------------------------

function bm25Search(query: string, limit: number): Map<string, number> {
  const scores = new Map<string, number>();

  try {
    const results = searchByBM25(query, limit * 3);
    for (const r of results) {
      scores.set(r.chunkId, r.score);
    }
  } catch {
    // FTS5 may not be available — return empty
  }

  return scores;
}

// ---------------------------------------------------------------------------
// Vector search
// ---------------------------------------------------------------------------

async function vectorSearch(
  adapter: EmbeddingAdapter,
  query: string,
  limit: number,
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();

  const [queryEmbedding] = await adapter.embed([query]);
  if (!queryEmbedding) return scores;

  // Load all chunks with embeddings (brute-force for < 10K, typically < 10ms)
  const chunks = getChunksWithEmbeddings(10_000);

  const scored: Array<{ id: string; similarity: number }> = [];
  for (const chunk of chunks) {
    if (!chunk.embedding) continue;
    const chunkEmbedding = bufferToEmbedding(chunk.embedding);
    const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);
    scored.push({ id: chunk.id, similarity });
  }

  // Sort by similarity descending, take top N
  scored.sort((a, b) => b.similarity - a.similarity);
  const topN = scored.slice(0, limit * 3);

  for (const item of topN) {
    scores.set(item.id, item.similarity);
  }

  return scores;
}

// ---------------------------------------------------------------------------
// Hybrid search
// ---------------------------------------------------------------------------

export async function searchMemory(
  options: SearchOptions,
  embeddingAdapter: EmbeddingAdapter | null,
): Promise<MemorySearchResult[]> {
  const config = getMemoryConfig();
  const maxResults = options.maxResults ?? config.maxSearchResults;
  const minScore = options.minScore ?? 0.1;

  // BM25 search
  const bm25Scores = bm25Search(options.query, maxResults);

  // Vector search (if adapter available)
  let vectorScores = new Map<string, number>();
  if (embeddingAdapter?.isAvailable()) {
    try {
      vectorScores = await vectorSearch(embeddingAdapter, options.query, maxResults);
    } catch (err) {
      console.warn('[Memory] Vector search failed, using BM25 only:', err instanceof Error ? err.message : String(err));
    }
  }

  // Normalize scores to [0, 1]
  const normBM25 = normalizeScores(bm25Scores);
  const normVector = normalizeScores(vectorScores);

  // Collect all unique chunk IDs
  const allChunkIds = new Set<string>([...normBM25.keys(), ...normVector.keys()]);

  // Compute hybrid scores
  const hybridScores: Array<{ chunkId: string; score: number }> = [];
  const useHybrid = normVector.size > 0;
  const vw = useHybrid ? config.vectorWeight : 0;
  const bw = useHybrid ? config.bm25Weight : 1;

  for (const chunkId of allChunkIds) {
    const bScore = normBM25.get(chunkId) ?? 0;
    const vScore = normVector.get(chunkId) ?? 0;
    const hybrid = vw * vScore + bw * bScore;
    if (hybrid >= minScore) {
      hybridScores.push({ chunkId, score: hybrid });
    }
  }

  // Sort by score descending
  hybridScores.sort((a, b) => b.score - a.score);
  const topResults = hybridScores.slice(0, maxResults);

  // Hydrate results with chunk data
  const results: MemorySearchResult[] = [];
  for (const { chunkId, score } of topResults) {
    const chunk = getChunk(chunkId);
    if (!chunk) continue;

    // Filter by sessionId if specified
    if (options.sessionId !== undefined && options.sessionId !== null) {
      if (chunk.sessionId !== options.sessionId) continue;
    }

    results.push({
      chunkId: chunk.id,
      content: chunk.content,
      score,
      source: chunk.source,
      sessionId: chunk.sessionId,
      createdAt: chunk.createdAt,
    });
  }

  return results;
}
