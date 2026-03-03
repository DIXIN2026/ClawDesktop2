/**
 * Task Scheduler
 * Polls the scheduled_tasks table and executes due tasks.
 * Inspired by NanoClaw's task-scheduler pattern.
 */
import { CronExpressionParser } from 'cron-parser';
import {
  getScheduledTasks,
  updateScheduledTask,
  createTaskRunLog,
} from '../utils/db.js';
import type { ScheduledTaskRow } from '../utils/db.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskExecutionResult {
  status: string;
  result: string;
}

export interface TaskSchedulerConfig {
  /** Polling interval in ms. Defaults to 30000 (30s). */
  pollIntervalMs?: number;
  /** Callback to execute a task. Receives the task row, returns execution result. */
  executeTask: (task: ScheduledTaskRow) => Promise<TaskExecutionResult>;
}

// ---------------------------------------------------------------------------
// TaskScheduler
// ---------------------------------------------------------------------------

export class TaskScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly pollIntervalMs: number;
  private readonly executeTask: (task: ScheduledTaskRow) => Promise<TaskExecutionResult>;

  constructor(config: TaskSchedulerConfig) {
    this.pollIntervalMs = config.pollIntervalMs ?? 30_000;
    this.executeTask = config.executeTask;
  }

  /**
   * Start the polling loop.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Initial poll immediately
    void this.poll();

    this.intervalId = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    this.running = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Poll the database for due tasks and execute them.
   */
  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      const tasks = getScheduledTasks();
      const now = new Date();

      for (const task of tasks) {
        if (!task.enabled || !this.isDue(task, now)) continue;

        const startedAt = new Date().toISOString();
        const startTime = Date.now();
        let executionResult: TaskExecutionResult;

        try {
          executionResult = await this.executeTask(task);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          executionResult = { status: 'error', result: errorMsg };
        }

        const durationMs = Date.now() - startTime;
        const completedAt = new Date().toISOString();

        // Log the run
        createTaskRunLog({
          id: crypto.randomUUID(),
          taskId: task.id,
          status: executionResult.status,
          resultSummary: executionResult.result.slice(0, 500),
          durationMs,
          startedAt,
          completedAt,
        });

        // Update task: last_run, next_run, and for "once" tasks disable
        const lastRun = completedAt;
        const nextRun = this.calculateNextRun(task);

        const updates: Record<string, unknown> = {
          last_run: lastRun,
          next_run: nextRun,
        };

        if (task.schedule_type === 'once') {
          updates['enabled'] = 0;
        }

        updateScheduledTask(task.id, updates);
      }
    } catch (err) {
      // Do not let poll errors crash the scheduler
      console.error('[TaskScheduler] Poll error:', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Determine if a task is due for execution.
   */
  private isDue(task: ScheduledTaskRow, now: Date): boolean {
    // Disabled tasks are never due
    if (!task.enabled) return false;

    // If next_run is set, compare with now
    if (task.next_run) {
      const nextRunDate = new Date(task.next_run);
      return now >= nextRunDate;
    }

    // If no next_run is set, it's due (first run)
    return true;
  }

  /**
   * Calculate the next run time based on the schedule type.
   * Returns null for "once" tasks (they don't repeat).
   */
  private calculateNextRun(task: ScheduledTaskRow): string | null {
    const { schedule_type, schedule_expr } = task;

    if (!schedule_type || !schedule_expr) return null;

    switch (schedule_type) {
      case 'cron': {
        try {
          const interval = CronExpressionParser.parse(schedule_expr);
          return interval.next().toISOString();
        } catch {
          console.error(`[TaskScheduler] Invalid cron expression: ${schedule_expr}`);
          return null;
        }
      }

      case 'interval': {
        const ms = parseInt(schedule_expr, 10);
        if (Number.isNaN(ms) || ms <= 0) {
          console.error(`[TaskScheduler] Invalid interval: ${schedule_expr}`);
          return null;
        }
        return new Date(Date.now() + ms).toISOString();
      }

      case 'once': {
        // Once tasks do not repeat
        return null;
      }

      default:
        return null;
    }
  }
}
