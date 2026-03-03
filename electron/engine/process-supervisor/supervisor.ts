/**
 * Process Supervisor — Core implementation
 * Wraps child_process.spawn with overall timeout, no-output watchdog, and graceful shutdown.
 */
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import type {
  ProcessSupervisor,
  SupervisorSpawnInput,
  ManagedRun,
  RunRecord,
  RunExit,
  TerminationReason,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 600_000;      // 10 minutes
const DEFAULT_NO_OUTPUT_MS = 180_000;     // 3 minutes
const GRACEFUL_KILL_DELAY_MS = 5_000;     // 5 seconds SIGTERM → SIGKILL

interface ActiveEntry {
  managedRun: ManagedRun;
  record: RunRecord;
  process: ChildProcess;
  overallTimer: ReturnType<typeof setTimeout> | null;
  watchdogTimer: ReturnType<typeof setTimeout> | null;
  forceKillTimer: ReturnType<typeof setTimeout> | null;
  resolve: (exit: RunExit) => void;
}

export function createProcessSupervisor(): ProcessSupervisor {
  const active = new Map<string, ActiveEntry>();

  function spawnProcess(input: SupervisorSpawnInput): ManagedRun {
    const runId = input.runId ?? randomUUID();
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const noOutputTimeoutMs = input.noOutputTimeoutMs ?? DEFAULT_NO_OUTPUT_MS;
    const now = Date.now();

    // If replaceExistingScope, cancel all runs in this scope first
    if (input.scopeKey && input.replaceExistingScope) {
      cancelScope(input.scopeKey);
    }

    const record: RunRecord = {
      runId,
      sessionId: input.sessionId,
      backendId: input.backendId,
      scopeKey: input.scopeKey,
      state: 'starting',
      startedAtMs: now,
      lastOutputAtMs: now,
    };

    let resolveWait: (exit: RunExit) => void;
    const waitPromise = new Promise<RunExit>((r) => { resolveWait = r; });

    const [command, ...args] = input.argv;
    if (!command) {
      record.state = 'exited';
      record.terminationReason = 'spawn-error';
      const exit: RunExit = {
        reason: 'spawn-error',
        exitCode: null,
        exitSignal: null,
        durationMs: 0,
        timedOut: false,
        noOutputTimedOut: false,
      };
      const managedRun: ManagedRun = {
        runId,
        pid: undefined,
        wait: () => Promise.resolve(exit),
        cancel: () => {},
        touchOutput: () => {},
      };
      return managedRun;
    }

    const child = spawn(command, args, {
      cwd: input.cwd,
      env: input.env ? { ...process.env, ...input.env } : undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    record.pid = child.pid;
    record.state = 'running';

    const entry: ActiveEntry = {
      managedRun: undefined as unknown as ManagedRun,
      record,
      process: child,
      overallTimer: null,
      watchdogTimer: null,
      forceKillTimer: null,
      resolve: resolveWait!,
    };

    function touchOutput(): void {
      record.lastOutputAtMs = Date.now();
      resetWatchdog();
    }

    function resetWatchdog(): void {
      if (entry.watchdogTimer) clearTimeout(entry.watchdogTimer);
      if (noOutputTimeoutMs > 0 && record.state === 'running') {
        entry.watchdogTimer = setTimeout(() => {
          terminateRun(runId, 'no-output-timeout');
        }, noOutputTimeoutMs);
      }
    }

    function cancelRun(reason?: TerminationReason): void {
      terminateRun(runId, reason ?? 'manual-cancel');
    }

    const managedRun: ManagedRun = {
      runId,
      pid: child.pid,
      wait: () => waitPromise,
      cancel: cancelRun,
      touchOutput,
    };
    entry.managedRun = managedRun;
    active.set(runId, entry);

    // Wire stdout/stderr
    child.stdout?.on('data', (chunk: Buffer) => {
      touchOutput();
      input.onStdout?.(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      touchOutput();
      input.onStderr?.(chunk);
    });

    // Overall timeout
    if (timeoutMs > 0) {
      entry.overallTimer = setTimeout(() => {
        terminateRun(runId, 'overall-timeout');
      }, timeoutMs);
    }

    // Start watchdog
    resetWatchdog();

    // Handle spawn error
    child.on('error', (err) => {
      console.error(`[ProcessSupervisor] Spawn error for ${runId}:`, err.message);
      cleanupAndResolve(runId, 'spawn-error', null, null);
    });

    // Handle exit
    child.on('exit', (code, signal) => {
      const reason = record.terminationReason ?? (signal ? 'signal' : 'exit');
      cleanupAndResolve(runId, reason, code, signal);
    });

    return managedRun;
  }

  function terminateRun(runId: string, reason: TerminationReason): void {
    const entry = active.get(runId);
    if (!entry || entry.record.state === 'exiting' || entry.record.state === 'exited') return;

    entry.record.state = 'exiting';
    entry.record.terminationReason = reason;

    // Graceful: SIGTERM first
    try {
      entry.process.kill('SIGTERM');
    } catch {
      // Process already dead
    }

    // Force kill after grace period
    entry.forceKillTimer = setTimeout(() => {
      try {
        if (!entry.process.killed) {
          entry.process.kill('SIGKILL');
        }
      } catch {
        // Already dead
      }
    }, GRACEFUL_KILL_DELAY_MS);
  }

  function cleanupAndResolve(
    runId: string,
    reason: TerminationReason,
    exitCode: number | null,
    exitSignal: string | null,
  ): void {
    const entry = active.get(runId);
    if (!entry) return;

    // Clear all timers
    if (entry.overallTimer) clearTimeout(entry.overallTimer);
    if (entry.watchdogTimer) clearTimeout(entry.watchdogTimer);
    if (entry.forceKillTimer) clearTimeout(entry.forceKillTimer);

    entry.record.state = 'exited';
    entry.record.terminationReason = entry.record.terminationReason ?? reason;
    entry.record.exitCode = exitCode ?? undefined;

    const exit: RunExit = {
      reason: entry.record.terminationReason,
      exitCode,
      exitSignal,
      durationMs: Date.now() - entry.record.startedAtMs,
      timedOut: entry.record.terminationReason === 'overall-timeout',
      noOutputTimedOut: entry.record.terminationReason === 'no-output-timeout',
    };

    active.delete(runId);
    entry.resolve(exit);
  }

  function cancel(runId: string, reason?: TerminationReason): void {
    terminateRun(runId, reason ?? 'manual-cancel');
  }

  function cancelScope(scopeKey: string): void {
    for (const [runId, entry] of active) {
      if (entry.record.scopeKey === scopeKey) {
        terminateRun(runId, 'manual-cancel');
      }
    }
  }

  function getRecord(runId: string): RunRecord | undefined {
    return active.get(runId)?.record;
  }

  function listActive(): RunRecord[] {
    return Array.from(active.values()).map((e) => ({ ...e.record }));
  }

  return { spawn: spawnProcess, cancel, cancelScope, getRecord, listActive };
}
