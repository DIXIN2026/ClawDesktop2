/**
 * Provider Auto-Discovery
 * Scans environment variables, local services, and CLI tools
 * Per requirements §2.9.5
 */
import { execFile } from 'child_process';
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
    const timeout = setTimeout(() => controller.abort(), 1200);
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
        const tagsTimeout = setTimeout(() => tagsController.abort(), 1800);
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

function runCommand(command: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, encoding: 'utf-8' }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const output = typeof stdout === 'string' ? stdout.trim() : String(stdout).trim();
      resolve(output.length > 0 ? output : null);
    });
  });
}

async function detectCliTool(command: string): Promise<{ installed: boolean; version?: string }> {
  const which = process.platform === 'win32' ? 'where' : 'which';
  const found = await runCommand(which, [command], 450);
  if (!found) {
    return { installed: false };
  }
  const version = await runCommand(command, ['--version'], 250);
  if (version) {
    return { installed: true, version };
  }
  return { installed: true };
}

async function scanCliTools(): Promise<CliAgentBackend[]> {
  return Promise.all(CLI_AGENTS.map(async (agent) => {
    const result = await detectCliTool(agent.command);
    return {
      id: agent.id,
      name: agent.name,
      command: agent.command,
      installed: result.installed,
      version: result.version,
    };
  }));
}

export interface DiscoveryResult {
  providers: DiscoveredProvider[];
  cliAgents: CliAgentBackend[];
  ollamaModels?: DiscoveredOllamaModels;
}

export async function runDiscovery(): Promise<DiscoveryResult> {
  const envProviders = scanEnvKeys();
  const [localResult, cliAgents] = await Promise.all([scanLocalServices(), scanCliTools()]);

  const cliDiscovered: DiscoveredProvider[] = cliAgents
    .filter(a => a.installed)
    .map(a => ({
      providerId: a.id,
      source: 'cli' as const,
      details: `${a.name} ${a.version ?? ''} found at ${a.command}`,
    }));

  // Scan CLI credentials (Claude Code, Codex, Qwen, MiniMax OAuth tokens)
  const cliCredentials = scanCliCredentials({ includeKeychain: false });

  return {
    providers: [...envProviders, ...localResult.providers, ...cliDiscovered, ...cliCredentials],
    cliAgents,
    ollamaModels: localResult.ollamaModels,
  };
}
