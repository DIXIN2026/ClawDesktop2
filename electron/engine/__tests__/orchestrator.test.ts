import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentExecuteOptions } from '../agent-executor.js';
import { getMessageBus } from '../message-bus.js';

const mockState = vi.hoisted(() => ({
  executeCalls: [] as AgentExecuteOptions[],
  abortCalls: [] as string[],
  outputs: new Map<string, string>(),
  delays: new Map<string, number>(),
}));

vi.mock('../agent-executor.js', () => ({
  createAgentExecutor: () => ({
    execute: async (options: AgentExecuteOptions) => {
      mockState.executeCalls.push(options);
      const delayMs = mockState.delays.get(options.sessionId) ?? 0;
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const output = mockState.outputs.get(options.sessionId) ?? '';
      if (output) {
        options.onEvent({
          type: 'text_delta',
          content: output,
          timestamp: Date.now(),
        });
      }
      options.onEvent({
        type: 'turn_end',
        timestamp: Date.now(),
      });
    },
    abort: async (sessionId: string) => {
      mockState.abortCalls.push(sessionId);
    },
    isRunning: () => false,
  }),
}));

import { Orchestrator, type AgentPipeline } from '../orchestrator.js';

function sanitizeIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'step';
}

function pipelineSessionId(
  pipelineId: string,
  stepId: string,
  stepIndex: number,
  parallelIndex?: number,
): string {
  const base = `orch-${sanitizeIdPart(pipelineId)}-${sanitizeIdPart(stepId)}-${stepIndex}`;
  return parallelIndex === undefined ? base : `${base}-${parallelIndex}`;
}

describe('Orchestrator', () => {
  beforeEach(() => {
    mockState.executeCalls.length = 0;
    mockState.abortCalls.length = 0;
    mockState.outputs.clear();
    mockState.delays.clear();
    getMessageBus().clear();
  });

  it('injects structured handoff context into downstream step prompt', async () => {
    const pipelineId = 'pipe-handoff';
    const step1SessionId = pipelineSessionId(pipelineId, 'plan', 0);
    const step2SessionId = pipelineSessionId(pipelineId, 'implement', 1);

    mockState.outputs.set(
      step1SessionId,
      'Plan done. Generated files: src/plan.md and docs/spec.md',
    );
    mockState.outputs.set(step2SessionId, 'Implementation done.');

    const pipeline: AgentPipeline = {
      id: pipelineId,
      name: 'handoff-check',
      workDirectory: '/tmp',
      steps: [
        {
          id: 'plan',
          agentType: 'requirements',
          input: 'user',
          prompt: 'Create a plan',
        },
        {
          id: 'implement',
          agentType: 'coding',
          input: 'previous_step',
          prompt: 'Implement according to the plan',
        },
      ],
    };

    const orchestrator = new Orchestrator();
    const progress = await orchestrator.executePipeline(pipeline, () => {});
    expect(progress.status).toBe('completed');

    const secondStepCall = mockState.executeCalls.find((call) => call.sessionId === step2SessionId);
    expect(secondStepCall).toBeDefined();
    expect(secondStepCall?.prompt).toContain('<handoff>');
    expect(secondStepCall?.prompt).toContain('"stepId": "plan"');
    expect(secondStepCall?.prompt).toContain('"agentType": "requirements"');
    expect(secondStepCall?.prompt).toContain('src/plan.md');
    expect(secondStepCall?.prompt).toContain('Previous step output:');
  });

  it('aborts only loser sessions for fastest parallel merge', async () => {
    const pipelineId = 'pipe-fastest';
    const winnerSession = pipelineSessionId(pipelineId, 'parallel-a-fast', 0, 0);
    const loserSession = pipelineSessionId(pipelineId, 'parallel-b-slow', 0, 1);

    mockState.outputs.set(winnerSession, 'winner output');
    mockState.outputs.set(loserSession, 'loser output');
    mockState.delays.set(winnerSession, 5);
    mockState.delays.set(loserSession, 40);

    const pipeline: AgentPipeline = {
      id: pipelineId,
      name: 'fastest-check',
      workDirectory: '/tmp',
      steps: [
        {
          id: 'parallel',
          mergeStrategy: 'fastest',
          agents: [
            {
              id: 'a-fast',
              agentType: 'coding',
              input: 'user',
              prompt: 'fast path',
            },
            {
              id: 'b-slow',
              agentType: 'testing',
              input: 'user',
              prompt: 'slow path',
            },
          ],
        },
      ],
    };

    const orchestrator = new Orchestrator();
    const progress = await orchestrator.executePipeline(pipeline, () => {});

    expect(progress.status).toBe('completed');
    expect(progress.results).toHaveLength(1);
    expect(progress.results[0]?.stepId).toBe('a-fast');
    expect(mockState.abortCalls).toContain(loserSession);
    expect(mockState.abortCalls).not.toContain(winnerSession);
  });
});
