/**
 * Codex CLI Agent Runner
 * OpenAI Codex CLI with auto-sandbox (o4-mini)
 * Parses JSONL events from `codex exec --json <prompt>`
 */
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import type { CliAgentRunner, CodingAgentEvent } from '../types.js';
import { execSync } from 'child_process';
import { createSanitizedEnv } from '../../security/env-sanitizer.js';

export class CodexRunner implements CliAgentRunner {
  private process: ChildProcess | null = null;

  async detect(): Promise<{ installed: boolean; version?: string }> {
    try {
      const which = process.platform === 'win32' ? 'where' : 'which';
      execSync(`${which} codex`, { timeout: 5000 });
      const version = execSync('codex --version', { timeout: 5000, encoding: 'utf-8' }).trim();
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
    const args = ['exec', '--json'];

    if (params.model) {
      args.push('--model', params.model);
    }

    args.push(params.prompt);

    this.process = spawn('codex', args, {
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
      console.error('[ERROR] Failed to spawn codex CLI:', err.message);
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
          // Non-JSON output treated as text
          if (line.trim()) {
            yield { type: 'text_delta', content: line, timestamp: Date.now() };
          }
        }
      }
    }

    // Emit turn_end if process completed
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
      case 'message':
      case 'text':
        return { type: 'text_delta', content: String(raw.content ?? raw.text ?? ''), timestamp: now };

      case 'function_call':
      case 'tool_call':
        return {
          type: 'tool_start',
          toolName: String(raw.name ?? raw.function ?? ''),
          toolInput: (raw.arguments ?? raw.input ?? {}) as Record<string, unknown>,
          timestamp: now,
        };

      case 'function_call_output':
      case 'tool_call_output':
        return {
          type: 'tool_end',
          content: String(raw.output ?? ''),
          timestamp: now,
        };

      case 'file_change':
      case 'patch':
        return {
          type: 'file_changed',
          filePath: String(raw.path ?? raw.file ?? ''),
          diffContent: String(raw.diff ?? raw.patch ?? ''),
          timestamp: now,
        };

      case 'error':
        return { type: 'error', errorMessage: String(raw.message ?? raw.error ?? ''), timestamp: now };

      case 'done':
      case 'result':
        return { type: 'turn_end', content: String(raw.result ?? raw.summary ?? ''), timestamp: now };

      default:
        // Pass through unknown events as text_delta if they have content
        if (raw.content || raw.text) {
          return { type: 'text_delta', content: String(raw.content ?? raw.text ?? ''), timestamp: now };
        }
        return { type: 'text_delta', content: '', timestamp: now };
    }
  }
}
