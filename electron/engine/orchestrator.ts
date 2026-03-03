/**
 * Multi-Agent Orchestrator
 * Supports sequential, parallel, and conditional agent pipelines
 */
import { createAgentExecutor } from './agent-executor.js';
import type { AgentExecuteOptions } from './agent-executor.js';
import type { CodingAgentEvent } from '../providers/types.js';

// ── Types ──────────────────────────────────────────────────────────

export type AgentStepType = 'coding' | 'requirements' | 'design' | 'testing';
export type MergeStrategy = 'all' | 'fastest' | 'consensus';
export type PipelineStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface AgentStep {
  id: string;
  agentType: AgentStepType;
  providerId?: string;
  modelId?: string;
  prompt: string;
  input: 'user' | 'previous_step' | 'parallel_merge';
  condition?: string;
}

export interface ParallelGroup {
  id: string;
  agents: AgentStep[];
  mergeStrategy: MergeStrategy;
}

export interface AgentPipeline {
  id: string;
  name: string;
  steps: Array<AgentStep | ParallelGroup>;
  workDirectory: string;
}

export interface StepResult {
  stepId: string;
  status: StepStatus;
  output: string;
  durationMs: number;
  error?: string;
}

export interface PipelineProgress {
  pipelineId: string;
  status: PipelineStatus;
  currentStepIndex: number;
  results: StepResult[];
  startedAt: number;
}

type ProgressCallback = (progress: PipelineProgress) => void;

// ── Helpers ─────────────────────────────────────────────────────────

function isParallelGroup(step: AgentStep | ParallelGroup): step is ParallelGroup {
  return 'agents' in step && Array.isArray(step.agents);
}

function evaluateCondition(condition: string | undefined, previousOutput: string): boolean {
  if (!condition) return true;
  // Simple condition evaluation: check if previous output contains keyword
  const lower = previousOutput.toLowerCase();
  const condLower = condition.toLowerCase();

  if (condLower.startsWith('contains:')) {
    return lower.includes(condLower.slice('contains:'.length).trim());
  }
  if (condLower.startsWith('not_empty')) {
    return previousOutput.trim().length > 0;
  }
  if (condLower === 'always') return true;
  if (condLower === 'never') return false;

  // Default: treat as contains check
  return lower.includes(condLower);
}

// ── Orchestrator ────────────────────────────────────────────────────

export class Orchestrator {
  private executor = createAgentExecutor();
  private activePipelines = new Map<string, { cancel: () => void }>();

  async executePipeline(
    pipeline: AgentPipeline,
    onProgress: ProgressCallback,
  ): Promise<PipelineProgress> {
    const progress: PipelineProgress = {
      pipelineId: pipeline.id,
      status: 'running',
      currentStepIndex: 0,
      results: [],
      startedAt: Date.now(),
    };

    let cancelled = false;
    this.activePipelines.set(pipeline.id, {
      cancel: () => { cancelled = true; },
    });

    let previousOutput = '';

    try {
      for (let i = 0; i < pipeline.steps.length; i++) {
        if (cancelled) {
          progress.status = 'cancelled';
          break;
        }

        progress.currentStepIndex = i;
        onProgress({ ...progress });

        const step = pipeline.steps[i]!;

        if (isParallelGroup(step)) {
          const results = await this.executeParallelGroup(
            step, pipeline.workDirectory, previousOutput, onProgress,
          );
          progress.results.push(...results);
          previousOutput = this.mergeResults(results, step.mergeStrategy);
        } else {
          // Evaluate condition
          if (!evaluateCondition(step.condition, previousOutput)) {
            progress.results.push({
              stepId: step.id,
              status: 'skipped',
              output: '',
              durationMs: 0,
            });
            continue;
          }

          const result = await this.executeSingleStep(
            step, pipeline.workDirectory, previousOutput,
          );
          progress.results.push(result);

          if (result.status === 'failed') {
            progress.status = 'failed';
            onProgress({ ...progress });
            break;
          }

          previousOutput = result.output;
        }

        onProgress({ ...progress });
      }

      if (progress.status === 'running') {
        progress.status = 'completed';
      }
    } catch (err) {
      progress.status = 'failed';
      progress.results.push({
        stepId: `error-${Date.now()}`,
        status: 'failed',
        output: '',
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.activePipelines.delete(pipeline.id);
      onProgress({ ...progress });
    }

    return progress;
  }

  cancelPipeline(pipelineId: string): void {
    const pipeline = this.activePipelines.get(pipelineId);
    if (pipeline) {
      pipeline.cancel();
    }
  }

  isRunning(pipelineId: string): boolean {
    return this.activePipelines.has(pipelineId);
  }

  // ── Internal ────────────────────────────────────────────────────────

  private async executeSingleStep(
    step: AgentStep,
    workDirectory: string,
    previousOutput: string,
  ): Promise<StepResult> {
    const startTime = Date.now();
    let output = '';

    const prompt = step.input === 'previous_step'
      ? `Previous step output:\n${previousOutput}\n\nNow: ${step.prompt}`
      : step.prompt;

    try {
      await new Promise<void>((resolve, reject) => {
        const sessionId = `orch-${step.id}-${Date.now()}`;

        const options: AgentExecuteOptions = {
          sessionId,
          prompt,
          workDirectory,
          agentType: step.agentType,
          mode: step.providerId ? 'api' : 'cli',
          providerId: step.providerId,
          modelId: step.modelId,
          onEvent: (event: CodingAgentEvent) => {
            if (event.type === 'text_delta' && event.content) {
              output += event.content;
            }
            if (event.type === 'turn_end') {
              resolve();
            }
            if (event.type === 'error') {
              reject(new Error(event.errorMessage ?? 'Unknown error'));
            }
          },
        };

        this.executor.execute(options).catch(reject);
      });

      return {
        stepId: step.id,
        status: 'completed',
        output,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        stepId: step.id,
        status: 'failed',
        output,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async executeParallelGroup(
    group: ParallelGroup,
    workDirectory: string,
    previousOutput: string,
    _onProgress: ProgressCallback,
  ): Promise<StepResult[]> {
    const promises = group.agents.map((step) =>
      this.executeSingleStep(step, workDirectory, previousOutput),
    );

    switch (group.mergeStrategy) {
      case 'fastest': {
        const sessionIds = group.agents.map((step) => `orch-${step.id}-${Date.now()}`);
        const fastest = await Promise.race(promises);
        // Abort remaining agent sessions to free resources
        for (const sid of sessionIds) {
          this.executor.abort(sid).catch(() => { /* best-effort */ });
        }
        return [fastest];
      }
      case 'all':
      case 'consensus':
      default:
        return Promise.all(promises);
    }
  }

  private mergeResults(results: StepResult[], strategy: MergeStrategy): string {
    const completed = results.filter(r => r.status === 'completed');
    if (completed.length === 0) return '';

    switch (strategy) {
      case 'fastest':
        return completed[0]?.output ?? '';
      case 'consensus': {
        // Simple consensus: return most common output (or first if all different)
        const outputs = completed.map(r => r.output);
        const counts = new Map<string, number>();
        for (const o of outputs) {
          counts.set(o, (counts.get(o) ?? 0) + 1);
        }
        let maxCount = 0;
        let bestOutput = outputs[0] ?? '';
        for (const [output, count] of counts) {
          if (count > maxCount) {
            maxCount = count;
            bestOutput = output;
          }
        }
        return bestOutput;
      }
      case 'all':
      default:
        return completed.map((r, i) => `--- Agent ${i + 1} ---\n${r.output}`).join('\n\n');
    }
  }
}

/** Singleton orchestrator */
let orchestratorInstance: Orchestrator | null = null;

export function getOrchestrator(): Orchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new Orchestrator();
  }
  return orchestratorInstance;
}
