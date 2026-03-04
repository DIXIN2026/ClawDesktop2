/**
 * Embedding Adapter
 * Adapts the existing ProviderRegistry to produce text embeddings.
 * - OpenAI-compatible providers → /v1/embeddings
 * - Ollama providers → /api/embeddings
 * - Anthropic → no embedding API, returns null (degrades to pure BM25)
 */
import type { EmbeddingAdapter } from './types.js';
import type { ProviderConfig, ApiProtocol } from '../providers/types.js';

// ---------------------------------------------------------------------------
// OpenAI-compatible adapter
// ---------------------------------------------------------------------------

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

function createOpenAIAdapter(baseUrl: string, apiKey: string, model: string): EmbeddingAdapter {
  let dimensions = 0;

  return {
    isAvailable: () => true,

    getDimensions: () => dimensions,

    async embed(texts: string[]): Promise<Float32Array[]> {
      const url = `${baseUrl.replace(/\/+$/, '')}/embeddings`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ input: texts, model }),
      });

      if (!response.ok) {
        throw new Error(`Embedding request failed: ${response.status} ${response.statusText}`);
      }

      const result = (await response.json()) as OpenAIEmbeddingResponse;

      // Sort by index to maintain input order
      const sorted = result.data.sort((a, b) => a.index - b.index);

      return sorted.map((item) => {
        const arr = new Float32Array(item.embedding);
        if (dimensions === 0) dimensions = arr.length;
        return arr;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Ollama adapter
// ---------------------------------------------------------------------------

interface OllamaEmbeddingResponse {
  embedding?: number[];
  embeddings?: number[][];
}

function createOllamaAdapter(baseUrl: string, model: string): EmbeddingAdapter {
  let dimensions = 0;
  let available: boolean | null = null;

  return {
    isAvailable: () => {
      if (available !== null) return available;
      // Probe lazily via real embedding requests to avoid sync/async mismatch.
      return true;
    },

    getDimensions: () => dimensions,

    async embed(texts: string[]): Promise<Float32Array[]> {
      const url = `${baseUrl.replace(/\/+$/, '')}/api/embeddings`;
      const results: Float32Array[] = [];

      // Ollama embeddings API processes one text at a time
      for (const text of texts) {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt: text }),
            signal: AbortSignal.timeout(30000),
          });

          if (!response.ok) {
            console.warn(`[OllamaAdapter] Embedding failed: ${response.status} ${response.statusText}`);
            available = false;
            // Return zero vector on failure
            results.push(new Float32Array(dimensions || 768));
            continue;
          }

          const result = (await response.json()) as OllamaEmbeddingResponse;
          const embedding = result.embedding ?? result.embeddings?.[0];

          if (!embedding) {
            console.warn('[OllamaAdapter] No embedding returned');
            available = false;
            results.push(new Float32Array(dimensions || 768));
            continue;
          }

          const arr = new Float32Array(embedding);
          available = true;
          if (dimensions === 0) dimensions = arr.length;
          results.push(arr);
        } catch (err) {
          console.warn('[OllamaAdapter] Request failed:', err instanceof Error ? err.message : String(err));
          available = false;
          results.push(new Float32Array(dimensions || 768));
        }
      }

      return results;
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Default embedding model IDs per protocol */
const DEFAULT_EMBEDDING_MODELS: Partial<Record<ApiProtocol, string>> = {
  'openai-compatible': 'text-embedding-3-small',
  'ollama': 'nomic-embed-text',
};

/**
 * Create an EmbeddingAdapter from a ProviderConfig.
 * Returns null if the provider does not support embeddings (e.g. Anthropic).
 */
export function createEmbeddingAdapter(
  provider: ProviderConfig,
  apiKey: string | null,
  embeddingModel?: string,
): EmbeddingAdapter | null {
  const model = embeddingModel ?? DEFAULT_EMBEDDING_MODELS[provider.apiProtocol];

  switch (provider.apiProtocol) {
    case 'openai-compatible': {
      if (!model) return null;
      return createOpenAIAdapter(provider.baseUrl, apiKey ?? '', model);
    }
    case 'ollama': {
      if (!model) return null;
      return createOllamaAdapter(provider.baseUrl, model);
    }
    case 'anthropic-messages':
      // Anthropic does not provide an embedding API
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Serialization helpers for SQLite BLOB storage
// ---------------------------------------------------------------------------

export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

export function bufferToEmbedding(buf: Buffer): Float32Array {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
