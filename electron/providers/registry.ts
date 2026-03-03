/**
 * Provider Registry
 * Built-in provider definitions and CRUD operations
 * Matches requirements §2.9.6 P0 Provider list
 */
import type { ProviderConfig, ModelDefinition } from './types.js';

const CAPS_ALL = { reasoning: true, vision: true, codeGen: true, toolUse: true };
const CAPS_CODE = { reasoning: true, vision: false, codeGen: true, toolUse: true };
const CAPS_REASON = { reasoning: true, vision: false, codeGen: false, toolUse: false };

const BUILTIN_PROVIDERS: ProviderConfig[] = [
  // --- Type B: API Key providers ---
  {
    id: 'anthropic',
    name: 'Anthropic',
    accessType: 'api-key',
    apiProtocol: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    envVar: 'ANTHROPIC_API_KEY',
    status: 'unconfigured',
    isBuiltin: true,
    icon: 'anthropic',
    models: [
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', contextWindow: 200000, maxOutputTokens: 32000, capabilities: CAPS_ALL, costPerMillionInput: 15, costPerMillionOutput: 75 },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 200000, maxOutputTokens: 16000, capabilities: CAPS_ALL, costPerMillionInput: 3, costPerMillionOutput: 15 },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', contextWindow: 200000, maxOutputTokens: 8192, capabilities: CAPS_ALL, costPerMillionInput: 0.8, costPerMillionOutput: 4 },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    accessType: 'api-key',
    apiProtocol: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    envVar: 'OPENAI_API_KEY',
    status: 'unconfigured',
    isBuiltin: true,
    icon: 'openai',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxOutputTokens: 16384, capabilities: CAPS_ALL, costPerMillionInput: 2.5, costPerMillionOutput: 10 },
      { id: 'o3', name: 'o3', contextWindow: 200000, maxOutputTokens: 100000, capabilities: CAPS_CODE, costPerMillionInput: 10, costPerMillionOutput: 40 },
      { id: 'o4-mini', name: 'o4-mini', contextWindow: 200000, maxOutputTokens: 100000, capabilities: CAPS_CODE, costPerMillionInput: 1.1, costPerMillionOutput: 4.4 },
    ],
  },
  {
    id: 'google',
    name: 'Google AI',
    accessType: 'api-key',
    apiProtocol: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envVar: 'GEMINI_API_KEY',
    status: 'unconfigured',
    isBuiltin: true,
    icon: 'google',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1000000, maxOutputTokens: 65536, capabilities: CAPS_ALL, costPerMillionInput: 1.25, costPerMillionOutput: 10 },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1000000, maxOutputTokens: 65536, capabilities: CAPS_ALL, costPerMillionInput: 0.15, costPerMillionOutput: 0.6 },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    accessType: 'api-key',
    apiProtocol: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    envVar: 'DEEPSEEK_API_KEY',
    status: 'unconfigured',
    isBuiltin: true,
    icon: 'deepseek',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3', contextWindow: 128000, maxOutputTokens: 8192, capabilities: CAPS_CODE, costPerMillionInput: 0.27, costPerMillionOutput: 1.1 },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1', contextWindow: 128000, maxOutputTokens: 8192, capabilities: CAPS_REASON, costPerMillionInput: 0.55, costPerMillionOutput: 2.19 },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    accessType: 'api-key',
    apiProtocol: 'ollama',
    baseUrl: 'http://localhost:11434',
    envVar: '',
    status: 'unconfigured',
    isBuiltin: true,
    icon: 'ollama',
    models: [], // populated dynamically via discovery
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    accessType: 'api-key',
    apiProtocol: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    envVar: 'OPENROUTER_API_KEY',
    status: 'unconfigured',
    isBuiltin: true,
    icon: 'openrouter',
    models: [
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', contextWindow: 200000, maxOutputTokens: 16000, capabilities: CAPS_ALL, costPerMillionInput: 3, costPerMillionOutput: 15 },
      { id: 'openai/gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxOutputTokens: 16384, capabilities: CAPS_ALL, costPerMillionInput: 2.5, costPerMillionOutput: 10 },
    ],
  },
];

// --- Type C: Coding Plan providers (per requirements §2.9.6) ---
const CODING_PLAN_PROVIDERS: ProviderConfig[] = [
  {
    id: 'dashscope-coding',
    name: '阿里云 Coding Plan',
    accessType: 'coding-plan',
    apiProtocol: 'openai-compatible',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    envVar: 'DASHSCOPE_API_KEY',
    status: 'unconfigured',
    isBuiltin: true,
    icon: 'aliyun',
    region: 'cn',
    models: [
      { id: 'qwen-coder', name: 'Qwen Coder', contextWindow: 131072, maxOutputTokens: 8192, capabilities: CAPS_CODE, costPerMillionInput: 0, costPerMillionOutput: 0 },
    ],
  },
  {
    id: 'kimi-coding',
    name: 'Kimi Coding Plan',
    accessType: 'coding-plan',
    apiProtocol: 'anthropic-messages',  // Note: Kimi uses Anthropic Messages API, NOT OpenAI compatible
    baseUrl: 'https://api.kimi.com/coding/',
    envVar: 'KIMI_API_KEY',
    status: 'unconfigured',
    isBuiltin: true,
    icon: 'kimi',
    region: 'cn',
    models: [
      { id: 'k2p5', name: 'Kimi K2.5', contextWindow: 262144, maxOutputTokens: 8192, capabilities: CAPS_CODE, costPerMillionInput: 0, costPerMillionOutput: 0 },
    ],
  },
  {
    id: 'zai-coding-global',
    name: '智谱 Coding Plan (全球)',
    accessType: 'coding-plan',
    apiProtocol: 'openai-compatible',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    envVar: 'ZAI_API_KEY',
    status: 'unconfigured',
    isBuiltin: true,
    icon: 'zhipu',
    region: 'global',
    models: [
      { id: 'glm-4.7', name: 'GLM 4.7', contextWindow: 128000, maxOutputTokens: 4096, capabilities: CAPS_CODE, costPerMillionInput: 0, costPerMillionOutput: 0 },
    ],
  },
  {
    id: 'zai-coding-cn',
    name: '智谱 Coding Plan (国内)',
    accessType: 'coding-plan',
    apiProtocol: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    envVar: 'ZAI_API_KEY',
    status: 'unconfigured',
    isBuiltin: true,
    icon: 'zhipu',
    region: 'cn',
    models: [
      { id: 'glm-4.7', name: 'GLM 4.7', contextWindow: 128000, maxOutputTokens: 4096, capabilities: CAPS_CODE, costPerMillionInput: 0, costPerMillionOutput: 0 },
    ],
  },
  {
    id: 'volcengine-coding-cn',
    name: '火山引擎 Coding Plan (国内)',
    accessType: 'coding-plan',
    apiProtocol: 'openai-compatible',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    envVar: 'VOLCANO_ENGINE_API_KEY',
    status: 'unconfigured',
    isBuiltin: true,
    icon: 'volcengine',
    region: 'cn',
    models: [
      { id: 'ark-code-latest', name: 'Ark Code Latest', contextWindow: 128000, maxOutputTokens: 4096, capabilities: CAPS_CODE, costPerMillionInput: 0, costPerMillionOutput: 0 },
      { id: 'doubao-seed-code', name: 'Doubao Seed Code', contextWindow: 128000, maxOutputTokens: 4096, capabilities: CAPS_CODE, costPerMillionInput: 0, costPerMillionOutput: 0 },
      { id: 'kimi-k2.5', name: 'Kimi K2.5', contextWindow: 262144, maxOutputTokens: 8192, capabilities: CAPS_CODE, costPerMillionInput: 0, costPerMillionOutput: 0 },
    ],
  },
  {
    id: 'volcengine-coding-overseas',
    name: '火山引擎 Coding Plan (海外)',
    accessType: 'coding-plan',
    apiProtocol: 'openai-compatible',
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/coding/v3',
    envVar: 'BYTEPLUS_API_KEY',
    status: 'unconfigured',
    isBuiltin: true,
    icon: 'volcengine',
    region: 'global',
    models: [
      { id: 'ark-code-latest', name: 'Ark Code Latest', contextWindow: 128000, maxOutputTokens: 4096, capabilities: CAPS_CODE, costPerMillionInput: 0, costPerMillionOutput: 0 },
      { id: 'doubao-seed-code', name: 'Doubao Seed Code', contextWindow: 128000, maxOutputTokens: 4096, capabilities: CAPS_CODE, costPerMillionInput: 0, costPerMillionOutput: 0 },
      { id: 'kimi-k2.5', name: 'Kimi K2.5', contextWindow: 262144, maxOutputTokens: 8192, capabilities: CAPS_CODE, costPerMillionInput: 0, costPerMillionOutput: 0 },
    ],
  },
  {
    id: 'minimax-coding',
    name: 'Minimax Coding Plan',
    accessType: 'coding-plan',
    apiProtocol: 'openai-compatible',
    baseUrl: 'https://api.minimax.chat/v1',
    envVar: 'MINIMAX_API_KEY',
    status: 'unconfigured',
    isBuiltin: true,
    icon: 'minimax',
    region: 'cn',
    models: [
      { id: 'MiniMax-M1', name: 'MiniMax M1', contextWindow: 1048576, maxOutputTokens: 131072, capabilities: CAPS_CODE, costPerMillionInput: 1.1, costPerMillionOutput: 8.8 },
      { id: 'MiniMax-T1', name: 'MiniMax T1', contextWindow: 1048576, maxOutputTokens: 131072, capabilities: CAPS_CODE, costPerMillionInput: 0, costPerMillionOutput: 0 },
    ],
  },
];

export class ProviderRegistry {
  private providers: Map<string, ProviderConfig>;

  constructor() {
    this.providers = new Map();
    for (const p of [...BUILTIN_PROVIDERS, ...CODING_PLAN_PROVIDERS]) {
      // Deep clone to prevent shared state between registry instances
      this.providers.set(p.id, { ...p, models: [...p.models] });
    }
  }

  getAll(): ProviderConfig[] {
    return Array.from(this.providers.values());
  }

  getById(id: string): ProviderConfig | undefined {
    return this.providers.get(id);
  }

  getEnabled(): ProviderConfig[] {
    return this.getAll().filter(p => p.status === 'available');
  }

  getByAccessType(type: ProviderConfig['accessType']): ProviderConfig[] {
    return this.getAll().filter(p => p.accessType === type);
  }

  add(provider: ProviderConfig): void {
    this.providers.set(provider.id, provider);
  }

  update(id: string, updates: Partial<ProviderConfig>): ProviderConfig | undefined {
    const existing = this.providers.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates, id };
    this.providers.set(id, updated);
    return updated;
  }

  remove(id: string): boolean {
    const provider = this.providers.get(id);
    if (provider?.isBuiltin) return false;
    return this.providers.delete(id);
  }

  updateModels(providerId: string, models: ModelDefinition[]): void {
    const provider = this.providers.get(providerId);
    if (provider) {
      provider.models = models;
    }
  }

  markAvailable(providerId: string, discoveredFrom: ProviderConfig['discoveredFrom']): void {
    const provider = this.providers.get(providerId);
    if (provider) {
      provider.status = 'available';
      provider.discoveredFrom = discoveredFrom;
    }
  }
}
