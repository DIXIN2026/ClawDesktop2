/**
 * Process Supervisor — Type definitions
 * Manages CLI process lifecycle with timeout and no-output detection.
 */

export type RunState = 'starting' | 'running' | 'exiting' | 'exited';

export type TerminationReason =
  | 'manual-cancel'
  | 'overall-timeout'
  | 'no-output-timeout'
  | 'spawn-error'
  | 'signal'
  | 'exit';

export interface RunRecord {
  runId: string;
  sessionId: string;
  backendId: string;
  scopeKey?: string;
  pid?: number;
  state: RunState;
  startedAtMs: number;
  lastOutputAtMs: number;
  terminationReason?: TerminationReason;
  exitCode?: number;
}

export interface RunExit {
  reason: TerminationReason;
  exitCode: number | null;
  exitSignal: string | null;
  durationMs: number;
  timedOut: boolean;
  noOutputTimedOut: boolean;
}

export interface ManagedRun {
  runId: string;
  pid: number | undefined;
  wait(): Promise<RunExit>;
  cancel(reason?: TerminationReason): void;
  touchOutput(): void;
}

export interface SupervisorSpawnInput {
  runId?: string;
  sessionId: string;
  backendId: string;
  scopeKey?: string;
  replaceExistingScope?: boolean;
  argv: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  noOutputTimeoutMs?: number;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
}

export interface ProcessSupervisor {
  spawn(input: SupervisorSpawnInput): ManagedRun;
  cancel(runId: string, reason?: TerminationReason): void;
  cancelScope(scopeKey: string): void;
  getRecord(runId: string): RunRecord | undefined;
  listActive(): RunRecord[];
}
