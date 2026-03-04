/**
 * Memory Store Tests
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
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
  getMemoryStats,
  searchByBM25,
} from '../memory-store.js';
import { embeddingToBuffer } from '../embedding-adapter.js';

describe('memory-store', () => {
  const testSessionId = `test-session-${randomUUID()}`;

  describe('insertMemoryChunk', () => {
    it('should insert a new memory chunk', () => {
      const chunkId = randomUUID();

      insertMemoryChunk({
        id: chunkId,
        sessionId: testSessionId,
        source: 'conversation',
        content: 'Test conversation message',
        tokenCount: 10,
      });

      const chunk = getChunk(chunkId);
      expect(chunk).not.toBeUndefined();
      expect(chunk?.id).toBe(chunkId);
      expect(chunk?.sessionId).toBe(testSessionId);
      expect(chunk?.content).toBe('[user]: Test conversation message');
      expect(chunk?.source).toBe('conversation');
    });

    it('should insert chunk without session (global memory)', () => {
      const chunkId = randomUUID();

      insertMemoryChunk({
        id: chunkId,
        sessionId: null,
        source: 'user_note',
        content: 'Global knowledge note',
      });

      const chunk = getChunk(chunkId);
      expect(chunk).not.toBeUndefined();
      expect(chunk?.sessionId).toBeNull();
    });

    it('should default tokenCount to 0 when not specified', () => {
      const chunkId = randomUUID();

      insertMemoryChunk({
        id: chunkId,
        sessionId: testSessionId,
        source: 'conversation',
        content: 'Test message',
      });

      const chunk = getChunk(chunkId);
      expect(chunk?.tokenCount).toBe(0);
    });
  });

  describe('updateChunkEmbedding', () => {
    it('should update chunk with embedding', () => {
      const chunkId = randomUUID();

      insertMemoryChunk({
        id: chunkId,
        sessionId: testSessionId,
        source: 'conversation',
        content: 'Test message',
      });

      const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      const buffer = embeddingToBuffer(embedding);

      updateChunkEmbedding(chunkId, buffer);

      const chunk = getChunk(chunkId);
      expect(chunk?.embedding).not.toBeNull();
    });

    it('should not throw for non-existent chunk', () => {
      const fakeId = randomUUID();
      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      const buffer = embeddingToBuffer(embedding);

      // Should not throw
      expect(() => updateChunkEmbedding(fakeId, buffer)).not.toThrow();
    });
  });

  describe('getSessionChunks', () => {
    it('should return chunks for a session', () => {
      const sessionId = `test-session-${randomUUID()}`;

      // Insert multiple chunks
      for (let i = 0; i < 3; i++) {
        insertMemoryChunk({
          id: randomUUID(),
          sessionId,
          source: 'conversation',
          content: `Message ${i}`,
        });
      }

      const chunks = getSessionChunks(sessionId);
      expect(chunks.length).toBeGreaterThanOrEqual(3);
    });

    it('should return empty array for non-existent session', () => {
      const chunks = getSessionSessions('non-existent-session-12345');
      expect(chunks).toEqual([]);
    });
  });

  describe('getChunksWithEmbeddings', () => {
    it('should return only chunks with embeddings', () => {
      const sessionId = `test-session-${randomUUID()}`;

      // Insert chunk without embedding
      const chunkId1 = randomUUID();
      insertMemoryChunk({
        id: chunkId1,
        sessionId,
        source: 'conversation',
        content: 'No embedding',
      });

      // Insert chunk with embedding
      const chunkId2 = randomUUID();
      insertMemoryChunk({
        id: chunkId2,
        sessionId,
        source: 'conversation',
        content: 'With embedding',
      });
      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      updateChunkEmbedding(chunkId2, embeddingToBuffer(embedding));

      const chunksWithEmbeddings = getChunksWithEmbeddings();
      const ids = chunksWithEmbeddings.map(c => c.id);

      expect(ids).toContain(chunkId2);
      expect(ids).not.toContain(chunkId1);
    });

    it('should respect limit parameter', () => {
      const chunks = getChunksWithEmbeddings(5);
      expect(chunks.length).toBeLessThanOrEqual(5);
    });
  });

  describe('getChunksWithoutEmbeddings', () => {
    it('should return only chunks without embeddings', () => {
      const chunks = getChunksWithoutEmbeddings(100);
      // All returned chunks should have null embedding
      for (const chunk of chunks) {
        expect(chunk.embedding).toBeNull();
      }
    });

    it('should respect limit parameter', () => {
      const chunks = getChunksWithoutEmbeddings(5);
      expect(chunks.length).toBeLessThanOrEqual(5);
    });
  });

  describe('deleteMemoryChunk', () => {
    it('should delete a chunk and its FTS entry', () => {
      const chunkId = randomUUID();

      insertMemoryChunk({
        id: chunkId,
        sessionId: testSessionId,
        source: 'conversation',
        content: 'To be deleted',
      });

      expect(getChunk(chunkId)).not.toBeUndefined();

      deleteMemoryChunk(chunkId);

      expect(getChunk(chunkId)).toBeUndefined();
    });

    it('should not throw for non-existent chunk', () => {
      expect(() => deleteMemoryChunk('non-existent-id')).not.toThrow();
    });
  });

  describe('deleteSessionMemory', () => {
    it('should delete all chunks and summaries for a session', () => {
      const sessionId = `test-session-${randomUUID()}`;

      // Insert chunks
      for (let i = 0; i < 3; i++) {
        insertMemoryChunk({
          id: randomUUID(),
          sessionId,
          source: 'conversation',
          content: `Message ${i}`,
        });
      }

      // Insert summary
      insertMemorySummary({
        id: randomUUID(),
        sessionId,
        summaryType: 'compaction',
        content: 'Session summary',
      });

      expect(getSessionChunks(sessionId).length).toBeGreaterThanOrEqual(3);
      expect(getSessionSummaries(sessionId).length).toBeGreaterThanOrEqual(1);

      deleteSessionMemory(sessionId);

      expect(getSessionChunks(sessionId)).toEqual([]);
      expect(getSessionSummaries(sessionId)).toEqual([]);
    });
  });

  describe('Memory Summaries', () => {
    it('should insert and retrieve summaries', () => {
      const sessionId = `test-session-${randomUUID()}`;
      const summaryId = randomUUID();

      insertMemorySummary({
        id: summaryId,
        sessionId,
        summaryType: 'compaction',
        content: 'Test summary content',
        sourceMessageIds: 'msg1,msg2,msg3',
      });

      const summaries = getSessionSummaries(sessionId);
      expect(summaries.length).toBeGreaterThanOrEqual(1);

      const latest = getLatestSessionSummary(sessionId);
      expect(latest).not.toBeUndefined();
      expect(latest?.content).toBe('Test summary content');
      expect(latest?.summaryType).toBe('compaction');
    });

    it('should return summaries in descending order by date', () => {
      const sessionId = `test-session-${randomUUID()}`;

      // Insert summaries with small delay
      insertMemorySummary({
        id: randomUUID(),
        sessionId,
        summaryType: 'compaction',
        content: 'First summary',
      });

      insertMemorySummary({
        id: randomUUID(),
        sessionId,
        summaryType: 'daily',
        content: 'Second summary',
      });

      const summaries = getSessionSummaries(sessionId);
      expect(summaries.length).toBeGreaterThanOrEqual(2);

      // Should be sorted by created_at DESC
      for (let i = 1; i < summaries.length; i++) {
        expect(new Date(summaries[i - 1]!.createdAt).getTime()).toBeGreaterThanOrEqual(
          new Date(summaries[i]!.createdAt).getTime()
        );
      }
    });
  });

  describe('getMemoryStats', () => {
    it('should return memory statistics', () => {
      const stats = getMemoryStats();

      expect(stats).toHaveProperty('totalChunks');
      expect(stats).toHaveProperty('totalSummaries');
      expect(stats).toHaveProperty('chunksWithEmbeddings');
      expect(stats).toHaveProperty('oldestChunkDate');
      expect(stats).toHaveProperty('newestChunkDate');

      expect(typeof stats.totalChunks).toBe('number');
      expect(typeof stats.totalSummaries).toBe('number');
      expect(typeof stats.chunksWithEmbeddings).toBe('number');
    });
  });

  describe('searchByBM25', () => {
    it('should return search results', () => {
      // Insert a chunk first
      const chunkId = randomUUID();
      insertMemoryChunk({
        id: chunkId,
        sessionId: testSessionId,
        source: 'conversation',
        content: 'Unique search keyword xyz123abc',
      });

      // Search for it
      const results = searchByBM25('xyz123abc', 10);

      // Should find the chunk
      const found = results.find(r => r.chunkId === chunkId);
      expect(found).toBeDefined();
      expect(found?.score).toBeGreaterThan(0);
    });

    it('should handle empty query', () => {
      const results = searchByBM25('', 10);
      // May return empty or all results depending on FTS behavior
      expect(Array.isArray(results)).toBe(true);
    });
  });
});

// Helper function for TypeScript
declare function getSessionSessions(sessionId: string): unknown[];
