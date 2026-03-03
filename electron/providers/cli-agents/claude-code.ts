/**
 * Claude Code CLI Agent Runner
 * Executes `claude --output-format stream-json -p <prompt> --cwd <dir>`
 */
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import type { CliAgentRunner, CodingAgentEvent } from '../types.js';
import { execSync } from 'child_process';
import { createSanitizedEnv } from '../../security/env-sanitizer.js';

export class ClaudeCodeRunner implements CliAgentRunner {
  private process: ChildProcess | null = null;

  async detect(): Promise<{ installed: boolean; version?: string }> {
    try {
      const which = process.platform === 'win32' ? 'where' : 'which';
      execSync(`${which} claude`, { timeout: 5000 });
      const version = execSync('claude --version', { timeout: 5000, encoding: 'utf-8' }).trim();
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
    const args = [
      '--output-format', 'stream-json',
      '-p', params.prompt,
      '--cwd', params.workDirectory,
    ];

    if (params.sessionId) {
      args.push('--resume', params.sessionId);
    }

    if (params.model) {
      args.push('--model', params.model);
    }

    this.process = spawn('claude', args, {
      cwd: params.workDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: createSanitizedEnv(),
    });

    const proc = this.process;
    let buffer = '';

    const lines: string[] = [];
    let resolveLine: (() => void) | null = null;
    let done = false;

    proc.stderr?.resume(); // drain stderr to prevent stalling
    proc.on('error', (err) => {
      console.error('[ERROR] Failed to spawn claude CLI:', err.message);
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

    let emittedTurnEnd = false;

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
          const mapped = this.mapToEvent(event);
          if (mapped.type === 'turn_end') emittedTurnEnd = true;
          yield mapped;
        } catch {
          // Skip non-JSON lines
        }
      }
    }

    // Guarantee turn_end so the consuming loop never hangs
    if (!emittedTurnEnd) {
      yield { type: 'turn_end' as const, content: '', timestamp: Date.now() };
    }
  }

  async abort(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  private mapToEvent(raw: Record<string, unknown>): CodingAgentEvent {
    const type = raw.type as string;
    const subtype = raw.subtype as string | undefined;
    const now = Date.now();

    switch (type) {
      case 'assistant':
        if (subtype === 'tool_use') {
          return {
            type: 'tool_start',
            toolName: String(raw.name ?? ''),
            toolInput: (raw.input ?? {}) as Record<string, unknown>,
            timestamp: now,
          };
        }
        return { type: 'text_delta', content: String(raw.message ?? raw.content ?? ''), timestamp: now };

      case 'tool_use':
        return {
          type: 'tool_start',
          toolName: String(raw.name ?? ''),
          toolInput: (raw.input ?? {}) as Record<string, unknown>,
          timestamp: now,
        };

      case 'tool_result':
        // Detect file changes from tool results
        if (this.isFileChangeTool(raw)) {
          return {
            type: 'file_changed',
            filePath: String((raw.input as Record<string, unknown>)?.file_path ?? ''),
            diffContent: String(raw.output ?? ''),
            timestamp: now,
          };
        }
        return { type: 'tool_end', content: String(raw.output ?? ''), timestamp: now };

      case 'result':
        return {
          type: 'turn_end',
          content: String(raw.result ?? raw.message ?? ''),
          timestamp: now,
        };

      case 'error':
        return { type: 'error', errorMessage: String(raw.error ?? raw.message ?? ''), timestamp: now };

      default:
        if (raw.content || raw.message) {
          return { type: 'text_delta', content: String(raw.content ?? raw.message ?? ''), timestamp: now };
        }
        return { type: 'text_delta', content: '', timestamp: now };
    }
  }

  /** Check if a tool_result corresponds to a file modification tool */
  private isFileChangeTool(raw: Record<string, unknown>): boolean {
    const toolName = String(raw.name ?? raw.tool_name ?? '');
    const fileChangeTools = new Set(['Write', 'Edit', 'MultiEdit', 'write_file', 'edit_file', 'create_file']);
    return fileChangeTools.has(toolName);
  }
}
