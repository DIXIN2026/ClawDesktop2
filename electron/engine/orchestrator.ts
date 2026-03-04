/**
 * Multi-Agent Orchestrator
 * Supports sequential, parallel, and conditional agent pipelines
 */
import { createAgentExecutor } from './agent-executor.js';
import type { AgentExecuteOptions } from './agent-executor.js';
import type { CodingAgentEvent } from '../providers/types.js';
import {
  getMessageBus,
  createAgentId,
  type AgentId,
  type AgentMessage,
} from './message-bus.js';

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

interface HandoffPayload {
  pipelineId: string;
  stepId: string;
  agentType: AgentStepType | 'orchestrator';
  sessionId: string;
  status: StepStatus;
  summary: string;
  outputExcerpt: string;
  artifacts: string[];
  durationMs: number;
  timestamp: number;
}

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

function sanitizeIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'step';
}

function createPipelineStepSessionId(
  pipelineId: string,
  stepId: string,
  stepIndex: number,
  parallelIndex?: number,
): string {
  const base = `orch-${sanitizeIdPart(pipelineId)}-${sanitizeIdPart(stepId)}-${stepIndex}`;
  return parallelIndex === undefined ? base : `${base}-${parallelIndex}`;
}

function summarizeOutput(output: string, maxLen = 1200): string {
  const text = output.trim().replace(/\s+/g, ' ');
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function excerptOutput(output: string, maxLen = 8000): string {
  if (output.length <= maxLen) return output;
  return `${output.slice(0, maxLen)}\n...[truncated]`;
}

function extractArtifacts(output: string, maxItems = 12): string[] {
  const regex = /(?:^|[\s"'`(])((?:\.{1,2}\/|\/)?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.[A-Za-z0-9._-]{1,12})(?=$|[\s"'`),;:])/gm;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of output.matchAll(regex)) {
    const candidate = (match[1] ?? '').trim();
    if (!candidate || candidate.length > 240 || !candidate.includes('.')) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
    if (out.length >= maxItems) break;
  }
  return out;
}

function isHandoffPayload(payload: unknown): payload is HandoffPayload {
  if (!payload || typeof payload !== 'object') return false;
  const rec = payload as Record<string, unknown>;
  return typeof rec.pipelineId === 'string'
    && typeof rec.stepId === 'string'
    && typeof rec.agentType === 'string'
    && typeof rec.sessionId === 'string'
    && typeof rec.status === 'string'
    && typeof rec.summary === 'string'
    && typeof rec.outputExcerpt === 'string'
    && Array.isArray(rec.artifacts);
}

// ── Orchestrator ────────────────────────────────────────────────────

export class Orchestrator {
  private executor = createAgentExecutor();
  private bus = getMessageBus();
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

    const orchestratorAgentId = createAgentId('orchestrator', pipeline.id);
    const plannedAgents = this.collectStepAgentRegistrations(pipeline);
    this.bus.register({
      id: orchestratorAgentId,
      type: 'orchestrator',
      capabilities: ['pipeline-orchestration', 'handoff-routing'],
      status: 'busy',
      sessionId: pipeline.id,
    });
    for (const planned of plannedAgents) {
      this.bus.register({
        id: planned.agentId,
        type: planned.step.agentType,
        capabilities: ['task-execution', 'handoff-consumer'],
        status: 'idle',
        sessionId: planned.sessionId,
      });
    }

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
        const nextAgentIds = this.getNextAgentIds(pipeline, i);

        if (isParallelGroup(step)) {
          const results = await this.executeParallelGroup(
            step,
            pipeline.id,
            i,
            pipeline.workDirectory,
            previousOutput,
            orchestratorAgentId,
            nextAgentIds,
            onProgress,
          );
          progress.results.push(...results);
          previousOutput = this.mergeResults(results, step.mergeStrategy);
          if (previousOutput.trim().length > 0 && nextAgentIds.length > 0) {
            const merged: StepResult = {
              stepId: `parallel:${step.id}`,
              status: 'completed',
              output: previousOutput,
              durationMs: results.reduce((acc, r) => acc + r.durationMs, 0),
            };
            this.publishHandoff({
              fromAgentId: orchestratorAgentId,
              nextAgentIds,
              pipelineId: pipeline.id,
              stepId: merged.stepId,
              agentType: 'orchestrator',
              sessionId: pipeline.id,
              result: merged,
            });
          }
        } else {
          const sessionId = createPipelineStepSessionId(pipeline.id, step.id, i);
          const stepAgentId = createAgentId(step.agentType, sessionId);
          const handoffMessages = this.bus.receive(stepAgentId);
          this.bus.send({
            from: orchestratorAgentId,
            to: stepAgentId,
            type: 'task_request',
            payload: {
              pipelineId: pipeline.id,
              stepId: step.id,
              stepIndex: i,
              prompt: step.prompt,
              previousOutputSummary: summarizeOutput(previousOutput, 800),
              pendingHandoffs: handoffMessages.filter((m) => m.type === 'handoff').length,
              timestamp: Date.now(),
            },
          });

          // Evaluate condition
          if (!evaluateCondition(step.condition, previousOutput)) {
            this.bus.send({
              from: orchestratorAgentId,
              to: stepAgentId,
              type: 'task_status',
              payload: {
                pipelineId: pipeline.id,
                stepId: step.id,
                status: 'skipped',
                reason: 'condition_not_met',
                timestamp: Date.now(),
              },
            });
            progress.results.push({
              stepId: step.id,
              status: 'skipped',
              output: '',
              durationMs: 0,
            });
            continue;
          }

          this.bus.updateStatus(stepAgentId, 'busy');
          this.bus.send({
            from: orchestratorAgentId,
            to: stepAgentId,
            type: 'task_status',
            payload: {
              pipelineId: pipeline.id,
              stepId: step.id,
              status: 'running',
              timestamp: Date.now(),
            },
          });
          const result = await this.executeSingleStep(
            step,
            pipeline.workDirectory,
            previousOutput,
            sessionId,
            handoffMessages,
          );
          progress.results.push(result);
          this.bus.updateStatus(stepAgentId, result.status === 'completed' ? 'idle' : 'error');
          this.bus.send({
            from: stepAgentId,
            to: orchestratorAgentId,
            type: 'task_result',
            payload: {
              pipelineId: pipeline.id,
              stepId: result.stepId,
              status: result.status,
              durationMs: result.durationMs,
              summary: summarizeOutput(result.output, 800),
              error: result.error,
              timestamp: Date.now(),
            },
          });

          if (result.status === 'failed') {
            progress.status = 'failed';
            onProgress({ ...progress });
            break;
          }

          previousOutput = result.output;
          this.publishHandoff({
            fromAgentId: stepAgentId,
            nextAgentIds,
            pipelineId: pipeline.id,
            stepId: step.id,
            agentType: step.agentType,
            sessionId,
            result,
          });
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
      this.bus.unregister(orchestratorAgentId);
      for (const planned of plannedAgents) {
        this.bus.unregister(planned.agentId);
      }
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

  private collectStepAgentRegistrations(pipeline: AgentPipeline): Array<{
    agentId: AgentId;
    sessionId: string;
    step: AgentStep;
  }> {
    const out: Array<{ agentId: AgentId; sessionId: string; step: AgentStep }> = [];
    for (let i = 0; i < pipeline.steps.length; i++) {
      const entry = pipeline.steps[i]!;
      if (isParallelGroup(entry)) {
        for (let j = 0; j < entry.agents.length; j++) {
          const agentStep = entry.agents[j]!;
          const sessionId = createPipelineStepSessionId(pipeline.id, `${entry.id}-${agentStep.id}`, i, j);
          out.push({
            agentId: createAgentId(agentStep.agentType, sessionId),
            sessionId,
            step: agentStep,
          });
        }
        continue;
      }

      const sessionId = createPipelineStepSessionId(pipeline.id, entry.id, i);
      out.push({
        agentId: createAgentId(entry.agentType, sessionId),
        sessionId,
        step: entry,
      });
    }
    return out;
  }

  private getNextAgentIds(pipeline: AgentPipeline, stepIndex: number): AgentId[] {
    const next = pipeline.steps[stepIndex + 1];
    if (!next) return [];

    if (isParallelGroup(next)) {
      return next.agents.map((step, idx) => {
        const sessionId = createPipelineStepSessionId(
          pipeline.id,
          `${next.id}-${step.id}`,
          stepIndex + 1,
          idx,
        );
        return createAgentId(step.agentType, sessionId);
      });
    }

    const sessionId = createPipelineStepSessionId(pipeline.id, next.id, stepIndex + 1);
    return [createAgentId(next.agentType, sessionId)];
  }

  private buildHandoffPayload(params: {
    pipelineId: string;
    stepId: string;
    agentType: AgentStepType | 'orchestrator';
    sessionId: string;
    result: StepResult;
  }): HandoffPayload {
    const { pipelineId, stepId, agentType, sessionId, result } = params;
    return {
      pipelineId,
      stepId,
      agentType,
      sessionId,
      status: result.status,
      summary: summarizeOutput(result.output),
      outputExcerpt: excerptOutput(result.output),
      artifacts: extractArtifacts(result.output),
      durationMs: result.durationMs,
      timestamp: Date.now(),
    };
  }

  private publishHandoff(params: {
    fromAgentId: AgentId;
    nextAgentIds: AgentId[];
    pipelineId: string;
    stepId: string;
    agentType: AgentStepType | 'orchestrator';
    sessionId: string;
    result: StepResult;
  }): void {
    const payload = this.buildHandoffPayload({
      pipelineId: params.pipelineId,
      stepId: params.stepId,
      agentType: params.agentType,
      sessionId: params.sessionId,
      result: params.result,
    });
    for (const nextAgentId of params.nextAgentIds) {
      this.bus.send({
        from: params.fromAgentId,
        to: nextAgentId,
        type: 'handoff',
        payload,
      });
    }
  }

  private buildStepPrompt(
    step: AgentStep,
    previousOutput: string,
    handoffMessages: AgentMessage[],
  ): string {
    const handoffs = handoffMessages
      .filter((msg): msg is AgentMessage & { payload: HandoffPayload } =>
        msg.type === 'handoff' && isHandoffPayload(msg.payload),
      )
      .slice(-3)
      .map((msg) => msg.payload);

    const handoffBlock = handoffs.length > 0
      ? [
          'Structured handoff from previous agent steps:',
          '<handoff>',
          JSON.stringify(
            handoffs.map((h) => ({
              pipelineId: h.pipelineId,
              stepId: h.stepId,
              agentType: h.agentType,
              status: h.status,
              summary: h.summary,
              artifacts: h.artifacts,
              durationMs: h.durationMs,
              timestamp: h.timestamp,
            })),
            null,
            2,
          ),
          '</handoff>',
          '',
        ].join('\n')
      : '';

    if (step.input === 'previous_step') {
      return `${handoffBlock}Previous step output:\n${previousOutput}\n\nNow: ${step.prompt}`;
    }
    if (step.input === 'parallel_merge') {
      return `${handoffBlock}Parallel steps merged output:\n${previousOutput}\n\nNow: ${step.prompt}`;
    }
    return handoffBlock ? `${handoffBlock}${step.prompt}` : step.prompt;
  }

  private async executeSingleStep(
    step: AgentStep,
    workDirectory: string,
    previousOutput: string,
    sessionIdOverride?: string,
    handoffMessages: AgentMessage[] = [],
  ): Promise<StepResult> {
    const startTime = Date.now();
    let output = '';

    const prompt = this.buildStepPrompt(step, previousOutput, handoffMessages);

    try {
      await new Promise<void>((resolve, reject) => {
        const sessionId = sessionIdOverride ?? `orch-${step.id}-${Date.now()}`;

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
    pipelineId: string,
    stepIndex: number,
    workDirectory: string,
    previousOutput: string,
    orchestratorAgentId: AgentId,
    nextAgentIds: AgentId[],
    _onProgress: ProgressCallback,
  ): Promise<StepResult[]> {
    const runs = group.agents.map((step, idx) => {
      const sessionId = createPipelineStepSessionId(pipelineId, `${group.id}-${step.id}`, stepIndex, idx);
      const agentId = createAgentId(step.agentType, sessionId);
      const handoffMessages = this.bus.receive(agentId);
      this.bus.send({
        from: orchestratorAgentId,
        to: agentId,
        type: 'task_request',
        payload: {
          pipelineId,
          stepId: step.id,
          stepIndex,
          parallelGroupId: group.id,
          mergeStrategy: group.mergeStrategy,
          prompt: step.prompt,
          previousOutputSummary: summarizeOutput(previousOutput, 800),
          pendingHandoffs: handoffMessages.filter((m) => m.type === 'handoff').length,
          timestamp: Date.now(),
        },
      });
      this.bus.updateStatus(agentId, 'busy');
      return { step, idx, sessionId, agentId, handoffMessages };
    });

    switch (group.mergeStrategy) {
      case 'fastest': {
        const fastest = await Promise.race(
          runs.map((run) =>
            this.executeSingleStep(
              run.step,
              workDirectory,
              previousOutput,
              run.sessionId,
              run.handoffMessages,
            ).then((result) => ({ run, result })),
          ),
        );

        this.bus.updateStatus(
          fastest.run.agentId,
          fastest.result.status === 'completed' ? 'idle' : 'error',
        );
        this.bus.send({
          from: fastest.run.agentId,
          to: orchestratorAgentId,
          type: 'task_result',
          payload: {
            pipelineId,
            stepId: fastest.result.stepId,
            status: fastest.result.status,
            durationMs: fastest.result.durationMs,
            summary: summarizeOutput(fastest.result.output, 800),
            error: fastest.result.error,
            timestamp: Date.now(),
          },
        });

        this.publishHandoff({
          fromAgentId: fastest.run.agentId,
          nextAgentIds,
          pipelineId,
          stepId: fastest.run.step.id,
          agentType: fastest.run.step.agentType,
          sessionId: fastest.run.sessionId,
          result: fastest.result,
        });

        // Abort only the remaining sessions, keep winner intact.
        await Promise.allSettled(
          runs
            .filter(({ sessionId }) => sessionId !== fastest.run.sessionId)
            .map(async ({ sessionId, agentId, step }) => {
              await this.executor.abort(sessionId);
              this.bus.updateStatus(agentId, 'idle');
              this.bus.send({
                from: agentId,
                to: orchestratorAgentId,
                type: 'task_status',
                payload: {
                  pipelineId,
                  stepId: step.id,
                  status: 'cancelled',
                  reason: 'fastest_winner_selected',
                  timestamp: Date.now(),
                },
              });
            }),
        );
        return [fastest.result];
      }
      case 'all':
      case 'consensus':
      default: {
        const results = await Promise.all(runs.map(async (run) => {
          const result = await this.executeSingleStep(
            run.step,
            workDirectory,
            previousOutput,
            run.sessionId,
            run.handoffMessages,
          );
          this.bus.updateStatus(run.agentId, result.status === 'completed' ? 'idle' : 'error');
          this.bus.send({
            from: run.agentId,
            to: orchestratorAgentId,
            type: 'task_result',
            payload: {
              pipelineId,
              stepId: result.stepId,
              status: result.status,
              durationMs: result.durationMs,
              summary: summarizeOutput(result.output, 800),
              error: result.error,
              timestamp: Date.now(),
            },
          });
          return { run, result };
        }));
        for (const item of results) {
          this.publishHandoff({
            fromAgentId: item.run.agentId,
            nextAgentIds,
            pipelineId,
            stepId: item.run.step.id,
            agentType: item.run.step.agentType,
            sessionId: item.run.sessionId,
            result: item.result,
          });
        }
        return results.map((item) => item.result);
      }
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
