/**
 * Provider Auto-Discovery
 * Scans environment variables, local services, and CLI tools
 * Per requirements §2.9.5
 */
import { execFileSync } from 'child_process';
import type { DiscoveredProvider, CliAgentBackend } from './types.js';
import { scanCliCredentials } from './cli-credentials.js';

// Environment variable → Provider ID mapping (per §2.9.5)
const ENV_KEY_MAP: Record<string, string> = {
  ANTHROPIC_API_KEY: 'anthropic',
  OPENAI_API_KEY: 'openai',
  GEMINI_API_KEY: 'google',
  DEEPSEEK_API_KEY: 'deepseek',
  OPENROUTER_API_KEY: 'openrouter',
  KIMI_API_KEY: 'kimi-coding',
  ZAI_API_KEY: 'zai-coding-global',
  DASHSCOPE_API_KEY: 'dashscope-coding',
  VOLCANO_ENGINE_API_KEY: 'volcengine-coding-cn',
  BYTEPLUS_API_KEY: 'volcengine-coding-overseas',
  MINIMAX_API_KEY: 'minimax-coding',
};

// CLI Agent definitions (per §2.9.6 Type A)
const CLI_AGENTS: Array<{ id: string; name: string; command: string }> = [
  { id: 'claude-code', name: 'Claude Code', command: 'claude' },
  { id: 'codex', name: 'Codex CLI', command: 'codex' },
  { id: 'opencode', name: 'OpenCode', command: 'opencode' },
  { id: 'gemini-cli', name: 'Gemini CLI', command: 'gemini' },
];

function scanEnvKeys(): DiscoveredProvider[] {
  const found: DiscoveredProvider[] = [];
  for (const [envVar, providerId] of Object.entries(ENV_KEY_MAP)) {
    if (process.env[envVar]) {
      found.push({
        providerId,
        source: 'env',
        details: `Found ${envVar} in environment`,
      });
    }
  }
  return found;
}

/** Model info returned by Ollama /api/tags */
interface OllamaTagModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

/** Discovered Ollama models from the local service */
export interface DiscoveredOllamaModels {
  version: string;
  models: OllamaTagModel[];
}

async function scanLocalServices(): Promise<{ providers: DiscoveredProvider[]; ollamaModels?: DiscoveredOllamaModels }> {
  const found: DiscoveredProvider[] = [];
  let ollamaModels: DiscoveredOllamaModels | undefined;

  // Check Ollama on localhost:11434
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch('http://localhost:11434/api/version', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (response.ok) {
      const data = await response.json() as { version: string };
      found.push({
        providerId: 'ollama',
        source: 'local-service',
        details: `Ollama v${data.version} running on localhost:11434`,
      });

      // Fetch available models
      try {
        const tagsController = new AbortController();
        const tagsTimeout = setTimeout(() => tagsController.abort(), 5000);
        const tagsResponse = await fetch('http://localhost:11434/api/tags', {
          signal: tagsController.signal,
        });
        clearTimeout(tagsTimeout);
        if (tagsResponse.ok) {
          const tagsData = await tagsResponse.json() as { models: OllamaTagModel[] };
          ollamaModels = { version: data.version, models: tagsData.models ?? [] };
        }
      } catch {
        // Failed to fetch models — Ollama detected but model list unavailable
      }
    }
  } catch {
    // Ollama not running
  }

  return { providers: found, ollamaModels };
}

function detectCliTool(command: string): { installed: boolean; version?: string } {
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    // Use execFileSync to avoid shell interpolation
    execFileSync(which, [command], { timeout: 5000, encoding: 'utf-8' });
    try {
      const version = execFileSync(command, ['--version'], { timeout: 5000, encoding: 'utf-8' }).trim();
      return { installed: true, version };
    } catch {
      return { installed: true };
    }
  } catch {
    return { installed: false };
  }
}

function scanCliTools(): CliAgentBackend[] {
  return CLI_AGENTS.map(agent => {
    const result = detectCliTool(agent.command);
    return {
      id: agent.id,
      name: agent.name,
      command: agent.command,
      installed: result.installed,
      version: result.version,
    };
  });
}

export interface DiscoveryResult {
  providers: DiscoveredProvider[];
  cliAgents: CliAgentBackend[];
  ollamaModels?: DiscoveredOllamaModels;
}

export async function runDiscovery(): Promise<DiscoveryResult> {
  const envProviders = scanEnvKeys();
  const localResult = await scanLocalServices();
  const cliAgents = scanCliTools();

  const cliDiscovered: DiscoveredProvider[] = cliAgents
    .filter(a => a.installed)
    .map(a => ({
      providerId: a.id,
      source: 'cli' as const,
      details: `${a.name} ${a.version ?? ''} found at ${a.command}`,
    }));

  // Scan CLI credentials (Claude Code, Codex, Qwen, MiniMax OAuth tokens)
  const cliCredentials = scanCliCredentials();

  return {
    providers: [...envProviders, ...localResult.providers, ...cliDiscovered, ...cliCredentials],
    cliAgents,
    ollamaModels: localResult.ollamaModels,
  };
}
