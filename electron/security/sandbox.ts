/**
 * Sandbox Configuration
 * Defines security boundaries for container execution
 * and generates enforcement arguments for Docker/Apple Container
 */

export interface SandboxConfig {
  allowNetwork: boolean;
  allowShell: boolean;
  allowFileWrite: boolean;
  workDirectoryOnly: boolean;
  maxMemoryMb: number;
  maxCpuPercent: number;
  timeoutMs: number;
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  allowNetwork: false,
  allowShell: true,
  allowFileWrite: true,
  workDirectoryOnly: true,
  maxMemoryMb: 2048,
  maxCpuPercent: 80,
  timeoutMs: 10 * 60 * 1000,
};

export const STRICT_SANDBOX_CONFIG: SandboxConfig = {
  allowNetwork: false,
  allowShell: false,
  allowFileWrite: false,
  workDirectoryOnly: true,
  maxMemoryMb: 512,
  maxCpuPercent: 50,
  timeoutMs: 5 * 60 * 1000,
};

export function mergeSandboxConfig(base: SandboxConfig, overrides: Partial<SandboxConfig>): SandboxConfig {
  return { ...base, ...overrides };
}

/**
 * Build Docker CLI arguments that enforce the sandbox limits.
 * These are injected between `docker run` and the image name.
 */
export function buildSandboxArgs(config: SandboxConfig): string[] {
  const args: string[] = [];

  // Memory limit
  args.push('--memory', `${config.maxMemoryMb}m`);
  // Prevent memory swap to avoid circumventing the limit
  args.push('--memory-swap', `${config.maxMemoryMb}m`);

  // CPU limit (Docker expects fractional CPUs, e.g. 0.8 for 80%)
  const cpuFraction = Math.max(0.1, config.maxCpuPercent / 100);
  args.push('--cpus', cpuFraction.toFixed(2));

  // Network isolation
  if (!config.allowNetwork) {
    args.push('--network', 'none');
  }

  // Run as non-root user (uid 1000) per requirements §2.6
  args.push('--user', '1000:1000');

  // Read-only root filesystem when file writes are disallowed
  if (!config.allowFileWrite) {
    args.push('--read-only');
    // Provide a writable /tmp for processes that need it
    args.push('--tmpfs', '/tmp:rw,noexec,nosuid,size=64m');
  }

  // Drop all capabilities and add back only what is needed
  args.push('--cap-drop', 'ALL');
  // Restrict syscalls
  args.push('--security-opt', 'no-new-privileges');

  // PID limit to prevent fork bombs
  args.push('--pids-limit', '256');

  return args;
}
