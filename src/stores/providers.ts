import { create } from 'zustand';
import { ipc } from '../services/ipc';

interface ModelCapabilities {
  reasoning: boolean;
  vision: boolean;
  codeGen: boolean;
  toolUse: boolean;
}

interface ModelDefinition {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: ModelCapabilities;
  costPerMillionInput: number;
  costPerMillionOutput: number;
}

interface ProviderConfig {
  id: string;
  name: string;
  accessType: 'local-cli' | 'api-key' | 'coding-plan';
  apiProtocol: 'openai-compatible' | 'anthropic-messages' | 'ollama';
  baseUrl: string;
  envVar: string;
  models: ModelDefinition[];
  status: 'available' | 'unconfigured' | 'error';
  isBuiltin: boolean;
  icon?: string;
  region?: 'global' | 'cn';
}

interface CliAgentBackend {
  id: string;
  name: string;
  command: string;
  installed: boolean;
  version?: string;
}

interface DiscoveredProvider {
  providerId: string;
  source: 'env' | 'local-service' | 'cli';
  details: string;
}

interface AgentDefaultModel {
  agentType: 'coding' | 'requirements' | 'design' | 'testing';
  primaryModel: string;   // 'anthropic/claude-opus-4-6'
  fallbackModel: string;  // 'openai/gpt-4o'
  cliBackend?: string;    // 'claude-code' (coding agent only)
}

interface ProvidersState {
  providers: ProviderConfig[];
  cliAgents: CliAgentBackend[];
  discovered: DiscoveredProvider[];
  isDiscovering: boolean;
  selectedCliBackend: string | null;
  agentDefaults: AgentDefaultModel[];
  setProviders: (providers: ProviderConfig[]) => void;
  setCliAgents: (agents: CliAgentBackend[]) => void;
  setSelectedCliBackend: (id: string | null) => void;
  setAgentDefault: (agentType: AgentDefaultModel['agentType'], primaryModel: string, fallbackModel: string) => void;
  runDiscovery: () => Promise<void>;
}

const CAPS_ALL: ModelCapabilities = { reasoning: true, vision: true, codeGen: true, toolUse: true };
const CAPS_CODE: ModelCapabilities = { reasoning: true, vision: false, codeGen: true, toolUse: true };

// Built-in providers matching electron/providers/registry.ts
const BUILTIN_PROVIDERS: ProviderConfig[] = [
  // Type B: API Key
  {
    id: 'anthropic', name: 'Anthropic', accessType: 'api-key', apiProtocol: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com', envVar: 'ANTHROPIC_API_KEY', status: 'unconfigured', isBuiltin: true,
    models: [
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', contextWindow: 200000, maxOutputTokens: 32000, capabilities: CAPS_ALL, costPerMillionInput: 15, costPerMillionOutput: 75 },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 200000, maxOutputTokens: 16000, capabilities: CAPS_ALL, costPerMillionInput: 3, costPerMillionOutput: 15 },
    ],
  },
  {
    id: 'openai', name: 'OpenAI', accessType: 'api-key', apiProtocol: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1', envVar: 'OPENAI_API_KEY', status: 'unconfigured', isBuiltin: true,
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxOutputTokens: 16384, capabilities: CAPS_ALL, costPerMillionInput: 2.5, costPerMillionOutput: 10 },
    ],
  },
  {
    id: 'google', name: 'Google AI', accessType: 'api-key', apiProtocol: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', envVar: 'GEMINI_API_KEY', status: 'unconfigured', isBuiltin: true,
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1000000, maxOutputTokens: 65536, capabilities: CAPS_ALL, costPerMillionInput: 1.25, costPerMillionOutput: 10 },
    ],
  },
  {
    id: 'deepseek', name: 'DeepSeek', accessType: 'api-key', apiProtocol: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1', envVar: 'DEEPSEEK_API_KEY', status: 'unconfigured', isBuiltin: true,
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3', contextWindow: 128000, maxOutputTokens: 8192, capabilities: CAPS_CODE, costPerMillionInput: 0.27, costPerMillionOutput: 1.1 },
    ],
  },
  {
    id: 'ollama', name: 'Ollama (Local)', accessType: 'api-key', apiProtocol: 'ollama',
    baseUrl: 'http://localhost:11434', envVar: '', status: 'unconfigured', isBuiltin: true, models: [],
  },
  {
    id: 'openrouter', name: 'OpenRouter', accessType: 'api-key', apiProtocol: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1', envVar: 'OPENROUTER_API_KEY', status: 'unconfigured', isBuiltin: true, models: [],
  },
  // Type C: Coding Plans
  {
    id: 'dashscope-coding', name: '阿里云 Coding Plan', accessType: 'coding-plan', apiProtocol: 'openai-compatible',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1', envVar: 'DASHSCOPE_API_KEY', status: 'unconfigured', isBuiltin: true, region: 'cn',
    models: [{ id: 'qwen-coder', name: 'Qwen Coder', contextWindow: 131072, maxOutputTokens: 8192, capabilities: CAPS_CODE, costPerMillionInput: 0, costPerMillionOutput: 0 }],
  },
  {
    id: 'kimi-coding', name: 'Kimi Coding Plan', accessType: 'coding-plan', apiProtocol: 'anthropic-messages',
    baseUrl: 'https://api.kimi.com/coding/', envVar: 'KIMI_API_KEY', status: 'unconfigured', isBuiltin: true, region: 'cn',
    models: [{ id: 'k2p5', name: 'Kimi K2.5', contextWindow: 262144, maxOutputTokens: 8192, capabilities: CAPS_CODE, costPerMillionInput: 0, costPerMillionOutput: 0 }],
  },
  {
    id: 'zai-coding-global', name: '智谱 Coding Plan (全球)', accessType: 'coding-plan', apiProtocol: 'openai-compatible',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4', envVar: 'ZAI_API_KEY', status: 'unconfigured', isBuiltin: true, region: 'global',
    models: [{ id: 'glm-4.7', name: 'GLM 4.7', contextWindow: 128000, maxOutputTokens: 4096, capabilities: CAPS_CODE, costPerMillionInput: 0, costPerMillionOutput: 0 }],
  },
  {
    id: 'zai-coding-cn', name: '智谱 Coding Plan (国内)', accessType: 'coding-plan', apiProtocol: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', envVar: 'ZAI_API_KEY', status: 'unconfigured', isBuiltin: true, region: 'cn',
    models: [{ id: 'glm-4.7', name: 'GLM 4.7', contextWindow: 128000, maxOutputTokens: 4096, capabilities: CAPS_CODE, costPerMillionInput: 0, costPerMillionOutput: 0 }],
  },
  {
    id: 'volcengine-coding-cn', name: '火山引擎 Coding Plan (国内)', accessType: 'coding-plan', apiProtocol: 'openai-compatible',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3', envVar: 'VOLCANO_ENGINE_API_KEY', status: 'unconfigured', isBuiltin: true, region: 'cn',
    models: [
      { id: 'ark-code-latest', name: 'Ark Code Latest', contextWindow: 128000, maxOutputTokens: 4096, capabilities: CAPS_CODE, costPerMillionInput: 0, costPerMillionOutput: 0 },
    ],
  },
  {
    id: 'volcengine-coding-overseas', name: '火山引擎 Coding Plan (海外)', accessType: 'coding-plan', apiProtocol: 'openai-compatible',
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/coding/v3', envVar: 'BYTEPLUS_API_KEY', status: 'unconfigured', isBuiltin: true, region: 'global',
    models: [
      { id: 'ark-code-latest', name: 'Ark Code Latest', contextWindow: 128000, maxOutputTokens: 4096, capabilities: CAPS_CODE, costPerMillionInput: 0, costPerMillionOutput: 0 },
    ],
  },
];

// Agent model assignments — no defaults pre-selected, user must choose
const DEFAULT_AGENT_MODELS: AgentDefaultModel[] = [
  { agentType: 'coding', primaryModel: '', fallbackModel: '' },
  { agentType: 'requirements', primaryModel: '', fallbackModel: '' },
  { agentType: 'design', primaryModel: '', fallbackModel: '' },
  { agentType: 'testing', primaryModel: '', fallbackModel: '' },
];

export const useProvidersStore = create<ProvidersState>((set, get) => ({
  providers: BUILTIN_PROVIDERS,
  cliAgents: [],
  discovered: [],
  isDiscovering: false,
  selectedCliBackend: null,
  agentDefaults: DEFAULT_AGENT_MODELS,

  setProviders: (providers) => set({ providers }),
  setCliAgents: (agents) => set({ cliAgents: agents }),
  setSelectedCliBackend: (id) => {
    set({ selectedCliBackend: id });
    void ipc.setSetting('provider:selectedCliBackend', id ?? 'none');
  },

  setAgentDefault: (agentType, primaryModel, fallbackModel) => {
    set((state) => ({
      agentDefaults: state.agentDefaults.map((d) =>
        d.agentType === agentType ? { ...d, primaryModel, fallbackModel } : d,
      ),
    }));

    void ipc.setSetting(`agent:model:${agentType}`, primaryModel);
    if (primaryModel.includes('/')) {
      const [providerId, modelId] = primaryModel.split('/');
      if (providerId && modelId) {
        void ipc.setAgentModel(agentType, providerId, modelId);
      }
    }
  },

  runDiscovery: async () => {
    if (get().isDiscovering) {
      return;
    }
    set({ isDiscovering: true });
    try {
      const result = await ipc.discoverProviders();
      const agentTypes = ['coding', 'requirements', 'design', 'testing'] as const;
      const [savedCli, ...savedModels] = await Promise.all([
        ipc.getSetting('provider:selectedCliBackend'),
        ...agentTypes.map((agentType) => ipc.getSetting(`agent:model:${agentType}`)),
      ]);

      const defaults: AgentDefaultModel[] = agentTypes.map((agentType, index) => ({
        agentType,
        primaryModel: typeof savedModels[index] === 'string' ? savedModels[index] : '',
        fallbackModel: '',
      }));

      const cliAgents = (result.cliAgents ?? []) as CliAgentBackend[];
      const installedCli = cliAgents.filter((agent) => agent.installed);
      const savedCliBackend = typeof savedCli === 'string' && savedCli.length > 0 && savedCli !== 'none'
        ? savedCli
        : null;
      const selectedCliBackend = installedCli.some((agent) => agent.id === savedCliBackend)
        ? savedCliBackend
        : (installedCli[0]?.id ?? null);

      if (selectedCliBackend !== savedCliBackend) {
        void ipc.setSetting('provider:selectedCliBackend', selectedCliBackend ?? 'none');
      }

      set({
        discovered: (result.providers ?? []) as unknown as DiscoveredProvider[],
        cliAgents,
        selectedCliBackend,
        agentDefaults: defaults,
        isDiscovering: false,
      });
    } catch (err) {
      console.error('[ERROR] Provider discovery failed:', err instanceof Error ? err.message : String(err));
      set({ isDiscovering: false });
    }
  },
}));
