import { create } from 'zustand';
import { ipc } from '../services/ipc';

// ── Types ──────────────────────────────────────────────────────────

export type AgentType = 'coding' | 'requirements' | 'design' | 'testing';

export interface AgentConfig {
  id: string;
  name: string;
  type: AgentType;
  systemPrompt?: string;
  skills: string[];
  status: 'idle' | 'running' | 'error';
  defaultModel?: { providerId: string; modelId: string };
}

interface AgentsState {
  agents: AgentConfig[];
  currentAgentType: AgentType;

  loadAgents: () => Promise<void>;
  setCurrentAgentType: (type: AgentType) => void;
  updateAgent: (id: string, updates: Partial<AgentConfig>) => Promise<void>;
  setAgentModel: (agentType: string, providerId: string, modelId: string) => Promise<void>;
}

// ── Preset agents ──────────────────────────────────────────────────

const PRESET_AGENTS: AgentConfig[] = [
  {
    id: 'agent-coding',
    name: 'Coding Agent',
    type: 'coding',
    systemPrompt: 'You are an expert software engineer. Write clean, well-tested code.',
    skills: ['file-edit', 'terminal', 'browser', 'git'],
    status: 'idle',
  },
  {
    id: 'agent-requirements',
    name: 'Requirements Agent',
    type: 'requirements',
    systemPrompt: 'You are a product manager. Analyze requirements, write specs, and break down tasks.',
    skills: ['file-edit', 'browser'],
    status: 'idle',
  },
  {
    id: 'agent-design',
    name: 'Design Agent',
    type: 'design',
    systemPrompt: 'You are a UI/UX designer. Create design specs, review layouts, and suggest improvements.',
    skills: ['file-edit', 'browser'],
    status: 'idle',
  },
  {
    id: 'agent-testing',
    name: 'Testing Agent',
    type: 'testing',
    systemPrompt: 'You are a QA engineer. Write tests, find bugs, and validate functionality.',
    skills: ['file-edit', 'terminal', 'browser'],
    status: 'idle',
  },
];

// ── Store ───────────────────────────────────────────────────────────

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: PRESET_AGENTS,
  currentAgentType: 'coding',

  loadAgents: async () => {
    try {
      const remote = (await ipc.listAgents()) as AgentConfig[];
      if (remote.length > 0) {
        set({ agents: remote });
      }
    } catch {
      // Keep presets on failure
    }
  },

  setCurrentAgentType: (type) => set({ currentAgentType: type }),

  updateAgent: async (id, updates) => {
    try {
      await ipc.updateAgent(id, updates as Record<string, unknown>);
      set((state) => ({
        agents: state.agents.map((a) => (a.id === id ? { ...a, ...updates } : a)),
      }));
    } catch (err) {
      console.error('[Agents] updateAgent failed:', err instanceof Error ? err.message : String(err));
      throw err;
    }
  },

  setAgentModel: async (agentType, providerId, modelId) => {
    try {
      await ipc.setAgentModel(agentType, providerId, modelId);
      set((state) => ({
        agents: state.agents.map((a) =>
          a.type === agentType ? { ...a, defaultModel: { providerId, modelId } } : a,
        ),
      }));
    } catch (err) {
      console.error('[Agents] setAgentModel failed:', err instanceof Error ? err.message : String(err));
      throw err;
    }
  },
}));
