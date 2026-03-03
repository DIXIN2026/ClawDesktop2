/**
 * Container Runtime Abstraction
 * Detects and abstracts Docker / Apple Container runtimes
 */
import { execSync, execFile } from 'child_process';

export type ContainerRuntimeType = 'docker' | 'apple-container';

interface ContainerRuntime {
  type: ContainerRuntimeType;
  bin: string;
  available: boolean;
  version?: string;
}

let cachedRuntime: ContainerRuntime | null = null;

function checkCommand(cmd: string): { available: boolean; version?: string } {
  try {
    const output = execSync(`${cmd} --version`, { timeout: 5000, encoding: 'utf-8' });
    return { available: true, version: output.trim() };
  } catch {
    return { available: false };
  }
}

export function detectRuntime(): ContainerRuntime {
  if (cachedRuntime) return cachedRuntime;

  // On macOS, check for Apple Container first
  if (process.platform === 'darwin') {
    const apple = checkCommand('container');
    if (apple.available) {
      cachedRuntime = { type: 'apple-container', bin: 'container', available: true, version: apple.version };
      return cachedRuntime;
    }
  }

  // Default: Docker
  const docker = checkCommand('docker');
  cachedRuntime = { type: 'docker', bin: 'docker', available: docker.available, version: docker.version };
  return cachedRuntime;
}

export function getContainerBin(): string {
  return detectRuntime().bin;
}

export function isContainerAvailable(): boolean {
  return detectRuntime().available;
}

export function readonlyMountArgs(hostPath: string, containerPath: string): string[] {
  const runtime = detectRuntime();
  if (runtime.type === 'apple-container') {
    return ['--mount', `type=bind,source=${hostPath},target=${containerPath},readonly`];
  }
  return ['-v', `${hostPath}:${containerPath}:ro`];
}

/**
 * Safely stop a container using execFile (no shell interpolation).
 * Validates containerName to prevent argument injection.
 */
export function stopContainer(containerName: string): Promise<void> {
  // Validate container name: only allow alphanumeric, dash, underscore, dot
  if (!/^[\w.-]+$/.test(containerName)) {
    return Promise.reject(new Error(`Invalid container name: ${containerName}`));
  }
  const bin = getContainerBin();
  return new Promise((resolve, reject) => {
    execFile(bin, ['stop', containerName], { timeout: 15000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * List running containers matching a name prefix.
 */
export function listContainers(prefix: string): Promise<string[]> {
  if (!/^[\w.-]+$/.test(prefix)) {
    return Promise.reject(new Error(`Invalid container prefix: ${prefix}`));
  }
  const bin = getContainerBin();
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ['ps', '-q', '--filter', `name=${prefix}`, '--format', '{{.Names}}'],
      { timeout: 10000 },
      (err, stdout) => {
        if (err) {
          reject(err);
        } else {
          const names = stdout.trim().split('\n').filter(Boolean);
          resolve(names);
        }
      },
    );
  });
}

const CONTAINER_PREFIX = 'clawdesktop-';

/**
 * Stop orphaned containers left behind by a crash or abnormal exit.
 * Returns the number of containers cleaned up.
 */
export async function cleanupOrphans(): Promise<number> {
  let names: string[];
  try {
    names = await listContainers(CONTAINER_PREFIX);
  } catch {
    // Runtime not available or no containers — nothing to clean
    return 0;
  }

  let cleaned = 0;
  for (const name of names) {
    try {
      await stopContainer(name);
      cleaned++;
      console.log(`[CLEANUP] Stopped orphan container: ${name}`);
    } catch (err) {
      console.warn(
        `[CLEANUP] Failed to stop orphan container ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return cleaned;
}

export function resetCache(): void {
  cachedRuntime = null;
}
