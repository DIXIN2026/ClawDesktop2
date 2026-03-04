import { describe, expect, it, vi } from 'vitest';
import { RequirementsAgent } from '../requirements-agent.js';

function streamSingleChunk(text: string): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      if (text.length > 0) {
        yield text;
      }
    },
  };
}

describe('RequirementsAgent', () => {
  it('requests clarification answers and stores them in context', async () => {
    const llmOutputs = [
      '需求摘要',
      '调研结果',
      '["目标用户是谁？", "是否需要多语言支持？"]',
      '审核意见',
      'PRD 内容',
    ];

    const callLLM = vi.fn(() => streamSingleChunk(llmOutputs.shift() ?? ''));
    const onClarificationNeeded = vi.fn(async (questions: string[]) => ({
      [questions[0] ?? '']: '初创团队工程师',
    }));
    const events: Array<{ type: string }> = [];

    const agent = new RequirementsAgent('做一个研发协作平台', {
      onEvent: (event) => {
        events.push({ type: event.type });
      },
      onStepChange: () => {},
      onClarificationNeeded,
      callLLM,
    });

    const context = await agent.run();

    expect(onClarificationNeeded).toHaveBeenCalledTimes(1);
    expect(onClarificationNeeded).toHaveBeenCalledWith([
      '目标用户是谁？',
      '是否需要多语言支持？',
    ]);
    expect(context.clarifications).toEqual([
      { question: '目标用户是谁？', answer: '初创团队工程师' },
      { question: '是否需要多语言支持？', answer: undefined },
    ]);
    expect(context.prdContent).toBe('PRD 内容');
    expect(events.some((event) => event.type === 'turn_end')).toBe(true);
  });
});
