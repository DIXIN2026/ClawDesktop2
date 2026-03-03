/**
 * Provider Type Definitions
 * Three access types: Local CLI, API Key, Coding Plan
 */

export type ProviderAccessType = 'local-cli' | 'api-key' | 'coding-plan';

export type ApiProtocol = 'openai-compatible' | 'anthropic-messages' | 'ollama';

export type ProviderStatus = 'available' | 'unconfigured' | 'error';

export type DiscoveredFrom = 'env' | 'config' | 'cli-detect' | 'local-service' | 'manual' | 'cli-credential';

export interface ModelCapabilities {
  reasoning: boolean;
  vision: boolean;
  codeGen: boolean;
  toolUse: boolean;
}

export interface ModelDefinition {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: ModelCapabilities;
  costPerMillionInput: number;   // USD, Coding Plan = 0
  costPerMillionOutput: number;
}

export interface ProviderConfig {
  id: string;
  name: string;
  accessType: ProviderAccessType;
  apiProtocol: ApiProtocol;
  baseUrl: string;
  envVar: string;                // associated environment variable name
  models: ModelDefinition[];
  status: ProviderStatus;
  isBuiltin: boolean;
  discoveredFrom?: DiscoveredFrom;
  icon?: string;
  region?: 'global' | 'cn';
  config?: Record<string, unknown>; // extra configuration JSON
}

export interface CliAgentBackend {
  id: string;
  name: string;
  command: string;
  installed: boolean;
  version?: string;
}

export interface CodingAgentEvent {
  type: 'text_delta' | 'tool_start' | 'tool_output' | 'tool_end' | 'file_changed' | 'approval_req' | 'turn_end' | 'error';
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  filePath?: string;
  diffContent?: string;
  errorMessage?: string;
  timestamp: number;
}

export interface CliAgentRunner {
  detect(): Promise<{ installed: boolean; version?: string }>;
  execute(params: {
    prompt: string;
    workDirectory: string;
    sessionId?: string;
    model?: string;
    timeout?: number;
  }): AsyncIterable<CodingAgentEvent>;
  abort(): Promise<void>;
}

export interface AgentModelMapping {
  agentType: 'coding' | 'requirements' | 'design' | 'testing';
  providerId: string;
  modelId: string;
}

export interface DiscoveredProvider {
  providerId: string;
  source: 'env' | 'local-service' | 'cli' | 'cli-credential';
  details: string;
}
