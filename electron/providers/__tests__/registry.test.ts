/**
 * Provider Registry Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '../registry.js';
import type { ProviderConfig } from '../types.js';

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  describe('initialization', () => {
    it('should load built-in providers on creation', () => {
      const providers = registry.getAll();
      expect(providers.length).toBeGreaterThan(0);

      // Check for known built-in providers
      const ids = providers.map((p) => p.id);
      expect(ids).toContain('anthropic');
      expect(ids).toContain('openai');
      expect(ids).toContain('google');
      expect(ids).toContain('ollama');
    });

    it('should have built-in providers in unconfigured state initially', () => {
      const provider = registry.getById('anthropic');
      expect(provider).toBeDefined();
      expect(provider?.status).toBe('unconfigured');
      expect(provider?.isBuiltin).toBe(true);
    });
  });

  describe('getById', () => {
    it('should return provider by id', () => {
      const provider = registry.getById('anthropic');
      expect(provider).toBeDefined();
      expect(provider?.id).toBe('anthropic');
      expect(provider?.name).toBe('Anthropic');
    });

    it('should return undefined for unknown provider', () => {
      const provider = registry.getById('unknown-provider');
      expect(provider).toBeUndefined();
    });
  });

  describe('getEnabled', () => {
    it('should return only available providers', () => {
      const enabled = registry.getEnabled();
      expect(enabled.every((p) => p.status === 'available')).toBe(true);
    });
  });

  describe('getByAccessType', () => {
    it('should filter providers by access type', () => {
      const apiKeyProviders = registry.getByAccessType('api-key');
      const localCliProviders = registry.getByAccessType('local-cli');
      const codingPlanProviders = registry.getByAccessType('coding-plan');

      expect(apiKeyProviders.length).toBeGreaterThan(0);
      expect(codingPlanProviders.length).toBeGreaterThan(0);
      // local-cli providers are detected at runtime
      expect(localCliProviders.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('add', () => {
    it('should add custom provider', () => {
      const customProvider: ProviderConfig = {
        id: 'custom-provider',
        name: 'Custom Provider',
        accessType: 'api-key',
        apiProtocol: 'openai-compatible',
        baseUrl: 'https://custom.example.com',
        envVar: 'CUSTOM_API_KEY',
        models: [],
        status: 'unconfigured',
        isBuiltin: false,
      };

      registry.add(customProvider);
      const retrieved = registry.getById('custom-provider');
      expect(retrieved).toEqual(customProvider);
    });
  });

  describe('update', () => {
    it('should update existing provider', () => {
      const updated = registry.update('anthropic', {
        status: 'available',
        discoveredFrom: 'env',
      });

      expect(updated).toBeDefined();
      expect(updated?.status).toBe('available');
      expect(updated?.discoveredFrom).toBe('env');
      // Other fields should be preserved
      expect(updated?.name).toBe('Anthropic');
    });

    it('should return undefined for non-existent provider', () => {
      const updated = registry.update('non-existent', { status: 'available' });
      expect(updated).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('should remove custom provider', () => {
      const customProvider: ProviderConfig = {
        id: 'removable-provider',
        name: 'Removable',
        accessType: 'api-key',
        apiProtocol: 'openai-compatible',
        baseUrl: 'https://example.com',
        envVar: 'KEY',
        models: [],
        status: 'unconfigured',
        isBuiltin: false,
      };

      registry.add(customProvider);
      expect(registry.getById('removable-provider')).toBeDefined();

      const removed = registry.remove('removable-provider');
      expect(removed).toBe(true);
      expect(registry.getById('removable-provider')).toBeUndefined();
    });

    it('should not remove built-in providers', () => {
      const removed = registry.remove('anthropic');
      expect(removed).toBe(false);
      expect(registry.getById('anthropic')).toBeDefined();
    });
  });

  describe('updateModels', () => {
    it('should update models for provider', () => {
      const newModels = [
        {
          id: 'new-model',
          name: 'New Model',
          contextWindow: 128000,
          maxOutputTokens: 4096,
          capabilities: { reasoning: true, vision: false, codeGen: true, toolUse: true },
          costPerMillionInput: 1.0,
          costPerMillionOutput: 2.0,
        },
      ];

      registry.updateModels('anthropic', newModels);
      const provider = registry.getById('anthropic');
      expect(provider?.models).toEqual(newModels);
    });
  });

  describe('markAvailable', () => {
    it('should mark provider as available', () => {
      registry.markAvailable('anthropic', 'env');
      const provider = registry.getById('anthropic');
      expect(provider?.status).toBe('available');
      expect(provider?.discoveredFrom).toBe('env');
    });
  });

  describe('model capabilities', () => {
    it('should have correct capabilities for Claude models', () => {
      const testRegistry = new ProviderRegistry();
      const anthropic = testRegistry.getById('anthropic');
      expect(anthropic).toBeDefined();
      expect(anthropic?.models.length).toBeGreaterThan(0);

      // Debug: print all model IDs
      const modelIds = anthropic?.models.map((m) => m.id);
      expect(modelIds).toContain('claude-opus-4-6');

      const opus = anthropic?.models.find((m) => m.id === 'claude-opus-4-6');
      expect(opus).toBeDefined();
      expect(opus?.capabilities.reasoning).toBe(true);
      expect(opus?.capabilities.vision).toBe(true);
      expect(opus?.capabilities.codeGen).toBe(true);
      expect(opus?.capabilities.toolUse).toBe(true);
    });

    it('should have correct context windows', () => {
      const testRegistry = new ProviderRegistry();
      const anthropic = testRegistry.getById('anthropic');
      const openai = testRegistry.getById('openai');

      expect(anthropic).toBeDefined();
      expect(openai).toBeDefined();

      const opus = anthropic?.models.find((m) => m.id === 'claude-opus-4-6');
      const gpt4o = openai?.models.find((m) => m.id === 'gpt-4o');

      expect(opus).toBeDefined();
      expect(gpt4o).toBeDefined();
      expect(opus?.contextWindow).toBe(200000);
      expect(gpt4o?.contextWindow).toBe(128000);
    });

    it('should have correct pricing information', () => {
      const testRegistry = new ProviderRegistry();
      const anthropic = testRegistry.getById('anthropic');
      expect(anthropic).toBeDefined();

      const opus = anthropic?.models.find((m) => m.id === 'claude-opus-4-6');
      expect(opus).toBeDefined();
      expect(opus?.costPerMillionInput).toBe(15);
      expect(opus?.costPerMillionOutput).toBe(75);
    });
  });

  describe('coding plan providers', () => {
    it('should include Chinese coding plan providers', () => {
      const providers = registry.getAll();
      const ids = providers.map((p) => p.id);

      expect(ids).toContain('dashscope-coding');
      expect(ids).toContain('kimi-coding');
      expect(ids).toContain('zai-coding-cn');
      expect(ids).toContain('volcengine-coding-cn');
    });

    it('should have region field for coding plan providers', () => {
      const dashscope = registry.getById('dashscope-coding');
      expect(dashscope?.region).toBe('cn');

      const zaiGlobal = registry.getById('zai-coding-global');
      expect(zaiGlobal?.region).toBe('global');
    });
  });
});
