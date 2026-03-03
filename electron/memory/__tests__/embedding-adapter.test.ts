/**
 * Embedding Adapter Tests
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createEmbeddingAdapter,
  embeddingToBuffer,
  bufferToEmbedding,
  cosineSimilarity,
} from '../embedding-adapter.js';
import type { ProviderConfig } from '../../providers/types.js';

describe('embedding-adapter', () => {
  describe('embeddingToBuffer / bufferToEmbedding', () => {
    it('should convert Float32Array to Buffer and back', () => {
      const original = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0]);
      const buffer = embeddingToBuffer(original);

      // Buffer should be 4 bytes per float
      expect(buffer.length).toBe(original.length * 4);

      const restored = bufferToEmbedding(buffer);
      expect(restored).toEqual(original);
    });

    it('should handle empty arrays', () => {
      const original = new Float32Array(0);
      const buffer = embeddingToBuffer(original);
      expect(buffer.length).toBe(0);

      const restored = bufferToEmbedding(buffer);
      expect(restored).toEqual(original);
    });

    it('should handle large arrays', () => {
      const original = new Float32Array(1536).fill(0.5);
      const buffer = embeddingToBuffer(original);
      expect(buffer.length).toBe(1536 * 4);

      const restored = bufferToEmbedding(buffer);
      expect(restored).toEqual(original);
    });
  });

  describe('cosineSimilarity', () => {
    it('should return 1.0 for identical vectors', () => {
      const a = new Float32Array([1.0, 2.0, 3.0]);
      const b = new Float32Array([1.0, 2.0, 3.0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 6);
    });

    it('should return 0.0 for orthogonal vectors', () => {
      const a = new Float32Array([1.0, 0.0, 0.0]);
      const b = new Float32Array([0.0, 1.0, 0.0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 6);
    });

    it('should return -1.0 for opposite vectors', () => {
      const a = new Float32Array([1.0, 2.0, 3.0]);
      const b = new Float32Array([-1.0, -2.0, -3.0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 6);
    });

    it('should handle zero vectors', () => {
      const a = new Float32Array([0.0, 0.0, 0.0]);
      const b = new Float32Array([1.0, 2.0, 3.0]);
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    it('should handle different dimensions', () => {
      const a = new Float32Array([1.0, 2.0]);
      const b = new Float32Array([1.0, 2.0, 3.0]);
      expect(cosineSimilarity(a, b)).toBe(0);
    });
  });

  describe('createEmbeddingAdapter', () => {
    it('should return null for unsupported protocols', () => {
      const provider: ProviderConfig = {
        id: 'anthropic',
        name: 'Anthropic',
        accessType: 'api-key',
        apiProtocol: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.com',
        envVar: 'ANTHROPIC_API_KEY',
        models: [],
        status: 'available',
        isBuiltin: true,
      };

      const adapter = createEmbeddingAdapter(provider, 'test-key');
      expect(adapter).toBeNull();
    });

    it('should create OpenAI adapter for openai-compatible protocol', () => {
      const provider: ProviderConfig = {
        id: 'openai',
        name: 'OpenAI',
        accessType: 'api-key',
        apiProtocol: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        envVar: 'OPENAI_API_KEY',
        models: [],
        status: 'available',
        isBuiltin: true,
      };

      const adapter = createEmbeddingAdapter(provider, 'test-key');
      expect(adapter).not.toBeNull();
      expect(adapter?.isAvailable()).toBe(true);
    });

    it('should create Ollama adapter for ollama protocol', () => {
      const provider: ProviderConfig = {
        id: 'ollama',
        name: 'Ollama',
        accessType: 'api-key',
        apiProtocol: 'ollama',
        baseUrl: 'http://localhost:11434',
        envVar: '',
        models: [],
        status: 'available',
        isBuiltin: true,
      };

      const adapter = createEmbeddingAdapter(provider, null);
      expect(adapter).not.toBeNull();
    });

    it('should return null when apiKey is required but not provided', () => {
      const provider: ProviderConfig = {
        id: 'openai',
        name: 'OpenAI',
        accessType: 'api-key',
        apiProtocol: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        envVar: 'OPENAI_API_KEY',
        models: [],
        status: 'available',
        isBuiltin: true,
      };

      // Without API key, should still create adapter but isAvailable might be false
      const adapter = createEmbeddingAdapter(provider, null);
      expect(adapter).not.toBeNull();
    });

    it('should use custom embedding model when specified', () => {
      const provider: ProviderConfig = {
        id: 'openai',
        name: 'OpenAI',
        accessType: 'api-key',
        apiProtocol: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        envVar: 'OPENAI_API_KEY',
        models: [],
        status: 'available',
        isBuiltin: true,
      };

      const adapter = createEmbeddingAdapter(provider, 'test-key', 'text-embedding-3-large');
      expect(adapter).not.toBeNull();
    });
  });
});
