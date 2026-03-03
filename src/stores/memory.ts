import { create } from 'zustand';
import { ipc } from '../services/ipc';

// ── Types ──────────────────────────────────────────────────────────

export interface MemorySearchResult {
  chunkId: string;
  content: string;
  score: number;
  source: string;
  sessionId: string | null;
  createdAt: string;
}

export interface MemoryStats {
  totalChunks: number;
  totalSummaries: number;
  chunksWithEmbeddings: number;
  oldestChunkDate: string | null;
  newestChunkDate: string | null;
}

export interface MemoryConfig {
  compactRatio: number;
  keepRecentMessages: number;
  maxSearchResults: number;
  embeddingEnabled: boolean;
  vectorWeight: number;
  bm25Weight: number;
}

interface MemoryState {
  searchResults: MemorySearchResult[];
  stats: MemoryStats | null;
  config: MemoryConfig | null;
  isSearching: boolean;
  isReindexing: boolean;

  search: (query: string, sessionId?: string | null) => Promise<void>;
  loadStats: () => Promise<void>;
  loadConfig: () => Promise<void>;
  updateConfig: (key: string, value: string | number | boolean) => Promise<void>;
  deleteChunk: (chunkId: string) => Promise<void>;
  deleteSessionMemory: (sessionId: string) => Promise<void>;
  reindex: () => Promise<{ indexed: number }>;
}

// ── Store ───────────────────────────────────────────────────────────

export const useMemoryStore = create<MemoryState>((set, get) => ({
  searchResults: [],
  stats: null,
  config: null,
  isSearching: false,
  isReindexing: false,

  search: async (query, sessionId) => {
    set({ isSearching: true });
    try {
      const results = await ipc.memorySearch({
        query,
        sessionId: sessionId ?? null,
      });
      set({ searchResults: results });
    } catch (err) {
      console.error('[Memory] search failed:', err instanceof Error ? err.message : String(err));
      set({ searchResults: [] });
    } finally {
      set({ isSearching: false });
    }
  },

  loadStats: async () => {
    try {
      const stats = await ipc.memoryStats();
      set({ stats });
    } catch (err) {
      console.error('[Memory] loadStats failed:', err instanceof Error ? err.message : String(err));
    }
  },

  loadConfig: async () => {
    try {
      const config = await ipc.memoryConfigGet();
      set({ config });
    } catch (err) {
      console.error('[Memory] loadConfig failed:', err instanceof Error ? err.message : String(err));
    }
  },

  updateConfig: async (key, value) => {
    try {
      await ipc.memoryConfigSet(key, value);
      // Optimistic update
      const current = get().config;
      if (current) {
        set({ config: { ...current, [key]: value } });
      }
    } catch (err) {
      console.error('[Memory] updateConfig failed:', err instanceof Error ? err.message : String(err));
      throw err;
    }
  },

  deleteChunk: async (chunkId) => {
    try {
      await ipc.memoryDelete(chunkId);
      set((state) => ({
        searchResults: state.searchResults.filter((r) => r.chunkId !== chunkId),
      }));
    } catch (err) {
      console.error('[Memory] deleteChunk failed:', err instanceof Error ? err.message : String(err));
      throw err;
    }
  },

  deleteSessionMemory: async (sessionId) => {
    try {
      await ipc.memoryDeleteSession(sessionId);
      set((state) => ({
        searchResults: state.searchResults.filter((r) => r.sessionId !== sessionId),
      }));
    } catch (err) {
      console.error('[Memory] deleteSessionMemory failed:', err instanceof Error ? err.message : String(err));
      throw err;
    }
  },

  reindex: async () => {
    set({ isReindexing: true });
    try {
      const result = await ipc.memoryReindex();
      // Refresh stats after reindex
      await get().loadStats();
      return result;
    } catch (err) {
      console.error('[Memory] reindex failed:', err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      set({ isReindexing: false });
    }
  },
}));
