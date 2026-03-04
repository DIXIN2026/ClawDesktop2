/**
 * Memory Store — SQLite CRUD for memory_chunks, memory_summaries, memory_config
 * Uses the existing db.ts helpers (synchronous better-sqlite3).
 */
import { randomUUID } from 'node:crypto';
import { query, get, run, transaction } from '../utils/db.js';
import { DEFAULT_MEMORY_CONFIG } from './types.js';
import type {
  MemoryChunk,
  MemoryChunkSource,
  MemorySummary,
  SummaryType,
  MemoryConfig,
  MemoryStats,
  MemoryPreferenceObservation,
} from './types.js';

// ---------------------------------------------------------------------------
// Row types (match SQLite columns)
// ---------------------------------------------------------------------------

interface MemoryChunkRow {
  id: string;
  session_id: string | null;
  source: MemoryChunkSource;
  content: string;
  embedding: Buffer | null;
  token_count: number;
  created_at: string;
  updated_at: string;
}

interface MemorySummaryRow {
  id: string;
  session_id: string | null;
  summary_type: SummaryType;
  content: string;
  source_message_ids: string | null;
  created_at: string;
}

interface MemoryConfigRow {
  key: string;
  value: string;
  updated_at: string;
}

interface MemoryObservationRow {
  id: string;
  entity_id: string;
  content: string;
  category: 'preference' | 'fact' | 'constraint';
  confidence: number | null;
  source_chunk_id: string | null;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToChunk(row: MemoryChunkRow): MemoryChunk {
  return {
    id: row.id,
    sessionId: row.session_id,
    source: row.source,
    content: row.content,
    embedding: row.embedding,
    tokenCount: row.token_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSummary(row: MemorySummaryRow): MemorySummary {
  return {
    id: row.id,
    sessionId: row.session_id,
    summaryType: row.summary_type,
    content: row.content,
    sourceMessageIds: row.source_message_ids,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Memory Chunks
// ---------------------------------------------------------------------------

export function insertMemoryChunk(params: {
  id: string;
  sessionId: string | null;
  source: MemoryChunkSource;
  content: string;
  tokenCount?: number;
}): void {
  const now = new Date().toISOString();

  transaction(() => {
    run(
      `INSERT INTO memory_chunks (id, session_id, source, content, token_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [params.id, params.sessionId, params.source, params.content, params.tokenCount ?? 0, now, now],
    );

    // Sync FTS index
    run(
      'INSERT INTO memory_fts (content, chunk_id) VALUES (?, ?)',
      [params.content, params.id],
    );
  });
}

export function updateChunkEmbedding(chunkId: string, embedding: Buffer): void {
  const now = new Date().toISOString();
  run(
    'UPDATE memory_chunks SET embedding = ?, updated_at = ? WHERE id = ?',
    [embedding, now, chunkId],
  );
}

export function getChunk(chunkId: string): MemoryChunk | undefined {
  const row = get<MemoryChunkRow>('SELECT * FROM memory_chunks WHERE id = ?', [chunkId]);
  return row ? rowToChunk(row) : undefined;
}

export function getSessionChunks(sessionId: string): MemoryChunk[] {
  return query<MemoryChunkRow>(
    'SELECT * FROM memory_chunks WHERE session_id = ? ORDER BY created_at ASC',
    [sessionId],
  ).map(rowToChunk);
}

export function getChunksWithEmbeddings(limit?: number): MemoryChunk[] {
  const sql = limit
    ? 'SELECT * FROM memory_chunks WHERE embedding IS NOT NULL ORDER BY created_at DESC LIMIT ?'
    : 'SELECT * FROM memory_chunks WHERE embedding IS NOT NULL ORDER BY created_at DESC';
  const params = limit ? [limit] : [];
  return query<MemoryChunkRow>(sql, params).map(rowToChunk);
}

export function getChunksWithoutEmbeddings(limit: number): MemoryChunk[] {
  return query<MemoryChunkRow>(
    'SELECT * FROM memory_chunks WHERE embedding IS NULL ORDER BY created_at ASC LIMIT ?',
    [limit],
  ).map(rowToChunk);
}

export function deleteSessionMemory(sessionId: string): void {
  transaction(() => {
    // Delete FTS entries for this session's chunks
    run(
      `DELETE FROM memory_fts WHERE chunk_id IN (
        SELECT id FROM memory_chunks WHERE session_id = ?
      )`,
      [sessionId],
    );
    run('DELETE FROM memory_chunks WHERE session_id = ?', [sessionId]);
    run('DELETE FROM memory_summaries WHERE session_id = ?', [sessionId]);
  });
}

export function deleteMemoryChunk(chunkId: string): void {
  transaction(() => {
    run('DELETE FROM memory_fts WHERE chunk_id = ?', [chunkId]);
    run('DELETE FROM memory_chunks WHERE id = ?', [chunkId]);
  });
}

// ---------------------------------------------------------------------------
// Memory Summaries
// ---------------------------------------------------------------------------

export function insertMemorySummary(params: {
  id: string;
  sessionId: string | null;
  summaryType: SummaryType;
  content: string;
  sourceMessageIds?: string;
}): void {
  const now = new Date().toISOString();
  run(
    `INSERT INTO memory_summaries (id, session_id, summary_type, content, source_message_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [params.id, params.sessionId, params.summaryType, params.content, params.sourceMessageIds ?? null, now],
  );
}

export function getSessionSummaries(sessionId: string): MemorySummary[] {
  return query<MemorySummaryRow>(
    'SELECT * FROM memory_summaries WHERE session_id = ? ORDER BY created_at DESC',
    [sessionId],
  ).map(rowToSummary);
}

export function getLatestSessionSummary(sessionId: string): MemorySummary | undefined {
  const row = get<MemorySummaryRow>(
    'SELECT * FROM memory_summaries WHERE session_id = ? ORDER BY created_at DESC LIMIT 1',
    [sessionId],
  );
  return row ? rowToSummary(row) : undefined;
}

// ---------------------------------------------------------------------------
// FTS5 Search (BM25)
// ---------------------------------------------------------------------------

interface FtsMatchRow {
  chunk_id: string;
  rank: number;
}

export function searchByBM25(queryText: string, limit: number): Array<{ chunkId: string; score: number }> {
  // FTS5 match returns negative rank (more negative = better match)
  const rows = query<FtsMatchRow>(
    `SELECT chunk_id, rank FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?`,
    [queryText, limit],
  );

  return rows.map((row) => ({
    chunkId: row.chunk_id,
    // Convert negative rank to positive score (closer to 0 = better in FTS5)
    score: -row.rank,
  }));
}

// ---------------------------------------------------------------------------
// Memory Config
// ---------------------------------------------------------------------------

export function getMemoryConfig(): MemoryConfig {
  const rows = query<MemoryConfigRow>('SELECT * FROM memory_config');
  const config = { ...DEFAULT_MEMORY_CONFIG };

  for (const row of rows) {
    const key = row.key as keyof MemoryConfig;
    if (key in config) {
      try {
        const parsed: unknown = JSON.parse(row.value);
        // Type-safe assignment
        if (key === 'compactRatio' || key === 'vectorWeight' || key === 'bm25Weight') {
          if (typeof parsed === 'number') config[key] = parsed;
        } else if (key === 'keepRecentMessages' || key === 'maxSearchResults') {
          if (typeof parsed === 'number') config[key] = parsed;
        } else if (key === 'embeddingEnabled') {
          if (typeof parsed === 'boolean') config[key] = parsed;
        }
      } catch {
        // keep default
      }
    }
  }

  return config;
}

export function setMemoryConfigValue(key: string, value: string | number | boolean): void {
  const now = new Date().toISOString();
  const serialized = JSON.stringify(value);
  run(
    `INSERT INTO memory_config (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, serialized, now],
  );
}

// ---------------------------------------------------------------------------
// Knowledge Graph (User Preference Observations)
// ---------------------------------------------------------------------------

function rowToPreferenceObservation(row: MemoryObservationRow): MemoryPreferenceObservation {
  return {
    id: row.id,
    content: row.content,
    category: row.category,
    confidence: row.confidence ?? 0.5,
    sessionId: row.session_id,
    sourceChunkId: row.source_chunk_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ensureDefaultUserEntity(): string {
  const entityId = 'entity-user-default';
  const exists = get<{ id: string }>(
    'SELECT id FROM memory_entities WHERE id = ?',
    [entityId],
  );
  if (exists?.id) return entityId;

  const now = new Date().toISOString();
  run(
    `INSERT INTO memory_entities (id, name, entity_type, session_id, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [entityId, 'current-user', 'user', null, null, now, now],
  );
  return entityId;
}

export function upsertPreferenceObservation(params: {
  content: string;
  sessionId?: string | null;
  sourceChunkId?: string | null;
  confidence?: number;
}): string {
  const content = params.content.trim();
  if (!content) {
    throw new Error('Preference content is required');
  }
  const entityId = ensureDefaultUserEntity();
  const existing = get<{ id: string }>(
    `SELECT id FROM memory_observations
     WHERE entity_id = ? AND category = 'preference' AND lower(content) = lower(?)
     LIMIT 1`,
    [entityId, content],
  );

  const now = new Date().toISOString();
  const confidence = Number.isFinite(params.confidence) ? Math.max(0, Math.min(1, params.confidence as number)) : 0.7;

  if (existing?.id) {
    run(
      `UPDATE memory_observations
       SET confidence = CASE WHEN confidence IS NULL OR confidence < ? THEN ? ELSE confidence END,
           source_chunk_id = COALESCE(?, source_chunk_id),
           session_id = COALESCE(?, session_id),
           updated_at = ?
       WHERE id = ?`,
      [confidence, confidence, params.sourceChunkId ?? null, params.sessionId ?? null, now, existing.id],
    );
    return existing.id;
  }

  const id = randomUUID();
  run(
    `INSERT INTO memory_observations
      (id, entity_id, content, category, confidence, source_chunk_id, session_id, created_at, updated_at)
     VALUES (?, ?, ?, 'preference', ?, ?, ?, ?, ?)`,
    [id, entityId, content, confidence, params.sourceChunkId ?? null, params.sessionId ?? null, now, now],
  );
  return id;
}

export function listPreferenceObservations(options?: {
  sessionId?: string | null;
  limit?: number;
}): MemoryPreferenceObservation[] {
  const limit = Math.max(1, Math.min(options?.limit ?? 50, 500));

  let rows: MemoryObservationRow[];
  if (options?.sessionId) {
    rows = query<MemoryObservationRow>(
      `SELECT * FROM memory_observations
       WHERE category = 'preference' AND (session_id IS NULL OR session_id = ?)
       ORDER BY updated_at DESC
       LIMIT ?`,
      [options.sessionId, limit],
    );
  } else {
    rows = query<MemoryObservationRow>(
      `SELECT * FROM memory_observations
       WHERE category = 'preference'
       ORDER BY updated_at DESC
       LIMIT ?`,
      [limit],
    );
  }

  return rows.map(rowToPreferenceObservation);
}

export function deletePreferenceObservation(observationId: string): void {
  run('DELETE FROM memory_observations WHERE id = ?', [observationId]);
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function getMemoryStats(): MemoryStats {
  const totalChunks = get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM memory_chunks')?.cnt ?? 0;
  const totalSummaries = get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM memory_summaries')?.cnt ?? 0;
  const chunksWithEmbeddings = get<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM memory_chunks WHERE embedding IS NOT NULL',
  )?.cnt ?? 0;

  const oldest = get<{ d: string | null }>(
    'SELECT MIN(created_at) as d FROM memory_chunks',
  )?.d ?? null;
  const newest = get<{ d: string | null }>(
    'SELECT MAX(created_at) as d FROM memory_chunks',
  )?.d ?? null;
  const totalGraphEntities = get<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM memory_entities',
  )?.cnt ?? 0;
  const totalGraphRelations = get<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM memory_relations',
  )?.cnt ?? 0;
  const totalPreferenceObservations = get<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM memory_observations WHERE category = 'preference'`,
  )?.cnt ?? 0;

  return {
    totalChunks,
    totalSummaries,
    chunksWithEmbeddings,
    oldestChunkDate: oldest,
    newestChunkDate: newest,
    totalGraphEntities,
    totalGraphRelations,
    totalPreferenceObservations,
  };
}
