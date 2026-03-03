/**
 * Container Runner
 * Spawns agent containers and parses sentinel-marked output streams
 * Adapted from NanoClaw's container-runner
 */
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { getContainerBin, readonlyMountArgs, stopContainer } from './container-runtime.js';
import { DEFAULT_SANDBOX_CONFIG, buildSandboxArgs, mergeSandboxConfig } from '../security/sandbox.js';
import type { SandboxConfig } from '../security/sandbox.js';
import { validateMount, validateContainerPath } from './mount-security.js';

const OUTPUT_START_MARKER = '---CLAWDESKTOP_OUTPUT_START---';
const OUTPUT_END_MARKER = '---CLAWDESKTOP_OUTPUT_END---';

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  resumeAt?: string;
  workDirectory: string;
  secrets?: Record<string, string>;
  agentType?: 'coding' | 'requirements' | 'design' | 'testing';
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

/** Unified event stream that both CLI and API modes produce */
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

export interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB

export function buildContainerArgs(
  mounts: VolumeMount[],
  containerName: string,
  image: string,
  sandboxConfig?: Partial<SandboxConfig>,
): string[] {
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];

  // Enforce sandbox limits (memory, CPU, network, capabilities)
  const sandbox = sandboxConfig
    ? mergeSandboxConfig(DEFAULT_SANDBOX_CONFIG, sandboxConfig)
    : DEFAULT_SANDBOX_CONFIG;
  args.push(...buildSandboxArgs(sandbox));

  // Pass host timezone
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  args.push('-e', `TZ=${tz}`);

  for (const mount of mounts) {
    // Validate each mount against security policy
    const validation = validateMount(mount.hostPath);
    if (!validation.valid) {
      console.warn(`[MOUNT BLOCKED] ${mount.hostPath}: ${validation.reason}`);
      continue;
    }

    // Validate container-side target path
    const containerValidation = validateContainerPath(mount.containerPath);
    if (!containerValidation.valid) {
      console.warn(`[MOUNT BLOCKED] container path ${mount.containerPath}: ${containerValidation.reason}`);
      continue;
    }

    if (mount.readonly) {
      args.push(...readonlyMountArgs(mount.hostPath, mount.containerPath));
    } else {
      args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
    }
  }

  args.push(image);
  return args;
}

export interface RunContainerOptions {
  containerName: string;
  image: string;
  mounts: VolumeMount[];
  input: ContainerInput;
  timeoutMs?: number;
  onEvent?: (event: CodingAgentEvent) => void;
  onProcess?: (proc: ChildProcess) => void;
}

export async function runContainer(options: RunContainerOptions): Promise<ContainerOutput> {
  const {
    containerName,
    image,
    mounts,
    input,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onEvent,
    onProcess,
  } = options;

  const bin = getContainerBin();
  const containerArgs = buildContainerArgs(mounts, containerName, image);

  return new Promise((resolve) => {
    const container = spawn(bin, containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    onProcess?.(container);

    let stdout = '';
    let stdoutTruncated = false;

    // Inject input via stdin (secrets never written to disk)
    container.stdin.on('error', (err) => {
      console.warn('[WARN] Container stdin write error:', err.message);
    });
    container.stdin.write(JSON.stringify(input));
    container.stdin.end();

    // Stream-parse sentinel markers
    let parseBuffer = '';
    let newSessionId: string | undefined;
    let hadOutput = false;

    container.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();

      if (!stdoutTruncated) {
        const remaining = MAX_OUTPUT_SIZE - stdout.length;
        if (chunk.length > remaining) {
          stdout += chunk.slice(0, remaining);
          stdoutTruncated = true;
        } else {
          stdout += chunk;
        }
      }

      // Parse sentinel markers
      parseBuffer += chunk;
      let startIdx: number;
      while ((startIdx = parseBuffer.indexOf(OUTPUT_START_MARKER)) !== -1) {
        const endIdx = parseBuffer.indexOf(OUTPUT_END_MARKER, startIdx);
        if (endIdx === -1) break;

        const jsonStr = parseBuffer
          .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
          .trim();
        parseBuffer = parseBuffer.slice(endIdx + OUTPUT_END_MARKER.length);

        try {
          const parsed: ContainerOutput = JSON.parse(jsonStr);
          if (parsed.newSessionId) {
            newSessionId = parsed.newSessionId;
          }
          hadOutput = true;
          resetTimeout();
          onEvent?.({
            type: 'text_delta',
            content: parsed.result ?? '',
            timestamp: Date.now(),
          });
        } catch (parseErr) {
          console.error(
            `[ERROR] Failed to parse container sentinel output. ` +
            `Raw (first 500 chars): ${jsonStr.slice(0, 500)}`,
            parseErr instanceof Error ? parseErr.message : String(parseErr),
          );
          resetTimeout();
        }
      }
    });

    let stderrOutput = '';
    container.stderr.on('data', (data: Buffer) => {
      if (stderrOutput.length < 10000) {
        stderrOutput += data.toString().slice(0, 10000 - stderrOutput.length);
      }
    });

    let timedOut = false;

    const killOnTimeout = () => {
      timedOut = true;
      stopContainer(containerName).catch(() => {
        container.kill('SIGKILL');
      });
    };

    let timeout = setTimeout(killOnTimeout, timeoutMs);

    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(killOnTimeout, timeoutMs);
    };

    container.on('close', (code) => {
      clearTimeout(timeout);

      if (timedOut) {
        if (hadOutput) {
          resolve({ status: 'success', result: null, newSessionId });
        } else {
          resolve({ status: 'error', result: null, error: `Container timed out after ${timeoutMs}ms` });
        }
        return;
      }

      if (code !== 0) {
        const errDetail = stderrOutput ? `. Stderr: ${stderrOutput.slice(0, 2000)}` : '';
        resolve({
          status: 'error',
          result: null,
          error: `Container exited with code ${code}${errDetail}`,
        });
        return;
      }

      // Parse last sentinel marker from accumulated output
      try {
        const sIdx = stdout.lastIndexOf(OUTPUT_START_MARKER);
        const eIdx = stdout.lastIndexOf(OUTPUT_END_MARKER);

        if (sIdx !== -1 && eIdx !== -1 && eIdx > sIdx) {
          const jsonLine = stdout.slice(sIdx + OUTPUT_START_MARKER.length, eIdx).trim();
          const output: ContainerOutput = JSON.parse(jsonLine);
          resolve(output);
        } else {
          resolve({ status: 'success', result: null, newSessionId });
        }
      } catch (err) {
        resolve({
          status: 'error',
          result: null,
          error: `Failed to parse container output: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    container.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        status: 'error',
        result: null,
        error: `Container spawn error: ${err.message}`,
      });
    });
  });
}
