/**
 * Context Builder
 * Assembles agent prompt context by injecting relevant memories.
 * Mirrors CoPaw CoPawInMemoryMemory — loads summaries + cross-session search results.
 */
import { getLatestSessionSummary, getMemoryConfig, listPreferenceObservations } from './memory-store.js';
import { searchMemory } from './memory-search.js';
import type { EmbeddingAdapter, ContextBuildResult, MemorySearchResult } from './types.js';

// ---------------------------------------------------------------------------
// Rough token estimation (4 chars ≈ 1 token for English, 2 chars ≈ 1 for CJK)
// ---------------------------------------------------------------------------

export function estimateTokens(text: string): number {
  // Simple heuristic: count chars, divide by 3.5 (balances EN/CJK)
  return Math.ceil(text.length / 3.5);
}

// ---------------------------------------------------------------------------
// Context Builder
// ---------------------------------------------------------------------------

export async function buildAgentContext(params: {
  sessionId: string;
  currentPrompt: string;
  maxTokens: number;
  embeddingAdapter: EmbeddingAdapter | null;
}): Promise<ContextBuildResult> {
  const { sessionId, currentPrompt, maxTokens, embeddingAdapter } = params;
  const config = getMemoryConfig();

  let tokensBudgetUsed = 0;
  const parts: string[] = [];
  let summaryIncluded = false;
  let memoriesInjected = 0;

  // 1. Load latest compaction summary for this session
  const summary = getLatestSessionSummary(sessionId);
  if (summary) {
    const summaryTokens = estimateTokens(summary.content);
    if (tokensBudgetUsed + summaryTokens <= maxTokens * 0.4) {
      parts.push(
        '<previous-summary>\n' +
        summary.content + '\n' +
        '</previous-summary>',
      );
      tokensBudgetUsed += summaryTokens;
      summaryIncluded = true;
    }
  }

  // 1.5 Inject persistent user preferences from memory graph.
  const preferenceRows = listPreferenceObservations({ sessionId, limit: 8 });
  if (preferenceRows.length > 0) {
    const lines: string[] = [];
    let prefTokens = 0;
    const prefBudget = Math.floor(maxTokens * 0.25);
    for (const pref of preferenceRows) {
      const line = `- ${pref.content}`;
      const t = estimateTokens(line);
      if (prefTokens + t > prefBudget) break;
      lines.push(line);
      prefTokens += t;
    }
    if (lines.length > 0) {
      parts.push(
        '<user-preferences>\n' +
        lines.join('\n') + '\n' +
        '</user-preferences>',
      );
      tokensBudgetUsed += prefTokens;
    }
  }

  // 2. Search cross-session relevant memories
  const remainingBudget = maxTokens - tokensBudgetUsed;
  if (remainingBudget > 200) {
    let memories: MemorySearchResult[];
    try {
      memories = await searchMemory(
        {
          query: currentPrompt,
          maxResults: config.maxSearchResults,
          minScore: 0.1,
          sessionId: null, // cross-session search
        },
        embeddingAdapter,
      );
    } catch {
      memories = [];
    }

    if (memories.length > 0) {
      const memoryLines: string[] = [];
      let memoryTokens = 0;

      for (const mem of memories) {
        const lineTokens = estimateTokens(mem.content);
        if (memoryTokens + lineTokens > remainingBudget * 0.5) break;

        memoryLines.push(`- [${mem.source}] ${mem.content}`);
        memoryTokens += lineTokens;
        memoriesInjected++;
      }

      if (memoryLines.length > 0) {
        parts.push(
          '<relevant-memories>\n' +
          memoryLines.join('\n') + '\n' +
          '</relevant-memories>',
        );
        tokensBudgetUsed += memoryTokens;
      }
    }
  }

  const systemPrefix = parts.length > 0 ? parts.join('\n\n') + '\n\n' : '';

  return {
    systemPrefix,
    tokensBudgetUsed,
    memoriesInjected,
    summaryIncluded,
  };
}
