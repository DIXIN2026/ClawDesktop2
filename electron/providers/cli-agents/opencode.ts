/**
 * OpenCode CLI Agent Runner
 * Parses JSONL events from `opencode run --output json`
 */
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import type { CliAgentRunner, CodingAgentEvent } from '../types.js';
import { execSync } from 'child_process';
import { createSanitizedEnv } from '../../security/env-sanitizer.js';

export class OpenCodeRunner implements CliAgentRunner {
  private process: ChildProcess | null = null;

  async detect(): Promise<{ installed: boolean; version?: string }> {
    try {
      const which = process.platform === 'win32' ? 'where' : 'which';
      execSync(`${which} opencode`, { timeout: 5000 });
      const version = execSync('opencode --version', { timeout: 5000, encoding: 'utf-8' }).trim();
      return { installed: true, version };
    } catch {
      return { installed: false };
    }
  }

  async *execute(params: {
    prompt: string;
    workDirectory: string;
    sessionId?: string;
    model?: string;
    timeout?: number;
  }): AsyncIterable<CodingAgentEvent> {
    const args = ['run', '--output', 'json'];

    if (params.model) {
      args.push('--model', params.model);
    }

    // OpenCode supports --provider flag
    args.push(params.prompt);

    this.process = spawn('opencode', args, {
      cwd: params.workDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: createSanitizedEnv(),
    });

    const proc = this.process;
    let buffer = '';
    const lines: string[] = [];
    let resolveLine: (() => void) | null = null;
    let done = false;

    proc.stderr?.resume();
    proc.on('error', (err) => {
      console.error('[ERROR] Failed to spawn opencode CLI:', err.message);
      done = true;
      resolveLine?.();
    });

    proc.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const line of parts) {
        if (line.trim()) {
          lines.push(line);
          resolveLine?.();
        }
      }
    });

    proc.on('close', () => {
      done = true;
      resolveLine?.();
    });

    while (!done || lines.length > 0) {
      if (lines.length === 0) {
        await new Promise<void>(resolve => {
          resolveLine = resolve;
        });
      }

      while (lines.length > 0) {
        const line = lines.shift()!;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          yield this.mapToEvent(event);
        } catch {
          // Skip non-JSON lines
        }
      }
    }

    yield { type: 'turn_end', timestamp: Date.now() };
  }

  async abort(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  private mapToEvent(raw: Record<string, unknown>): CodingAgentEvent {
    const type = raw.type as string;
    const now = Date.now();

    switch (type) {
      case 'text':
      case 'assistant':
      case 'content':
        return { type: 'text_delta', content: String(raw.content ?? raw.text ?? ''), timestamp: now };

      case 'tool_use':
      case 'tool_call':
        return {
          type: 'tool_start',
          toolName: String(raw.name ?? raw.tool ?? ''),
          toolInput: (raw.input ?? raw.arguments ?? {}) as Record<string, unknown>,
          timestamp: now,
        };

      case 'tool_result':
      case 'tool_output':
        return {
          type: 'tool_end',
          content: String(raw.output ?? raw.content ?? ''),
          timestamp: now,
        };

      case 'file_changed':
      case 'file_edit':
        return {
          type: 'file_changed',
          filePath: String(raw.path ?? raw.file ?? ''),
          diffContent: String(raw.diff ?? ''),
          timestamp: now,
        };

      case 'error':
        return { type: 'error', errorMessage: String(raw.message ?? raw.error ?? ''), timestamp: now };

      case 'done':
      case 'result':
      case 'complete':
        return { type: 'turn_end', content: String(raw.result ?? raw.summary ?? ''), timestamp: now };

      default:
        if (raw.content) {
          return { type: 'text_delta', content: String(raw.content), timestamp: now };
        }
        return { type: 'text_delta', content: '', timestamp: now };
    }
  }
}
