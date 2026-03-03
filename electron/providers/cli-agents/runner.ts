/**
 * Unified CLI Agent Runner Interface
 * Supports 4 CLI backends per requirements §2.9.6 Type A
 */
import type { CliAgentRunner } from '../types.js';
import { ClaudeCodeRunner } from './claude-code.js';
import { CodexRunner } from './codex.js';
import { OpenCodeRunner } from './opencode.js';
import { GeminiCliRunner } from './gemini-cli.js';

const runners: Record<string, () => CliAgentRunner> = {
  'claude-code': () => new ClaudeCodeRunner(),
  'codex': () => new CodexRunner(),
  'opencode': () => new OpenCodeRunner(),
  'gemini-cli': () => new GeminiCliRunner(),
};

export function getCliRunner(backendId: string): CliAgentRunner | undefined {
  const factory = runners[backendId];
  return factory?.();
}

export function getSupportedBackends(): string[] {
  return Object.keys(runners);
}
