import { describe, expect, it, vi } from 'vitest';
import { DesignAgent } from '../design-agent.js';

type DesignCall = {
  system: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content:
      | string
      | Array<{ type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string }>;
  }>;
};

function streamSingleChunk(text: string): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      if (text.length > 0) {
        yield text;
      }
    },
  };
}

describe('DesignAgent', () => {
  it('runs visual self-check with captured preview screenshot', async () => {
    const llmOutputs = [
      '{"name":"Dashboard","route":"/dashboard","layout":"grid","components":[]}',
      '## Dashboard\n- shadcn/ui: Card',
      '```tsx filename="Dashboard.tsx"\nexport function Dashboard(){ return <div>ok</div>; }\n```',
      '## 视觉审查结果\n### 优点\n- 层级清晰',
    ];
    const llmCalls: DesignCall[] = [];
    const callLLM = vi.fn((params: DesignCall) => {
      llmCalls.push(params);
      return streamSingleChunk(llmOutputs.shift() ?? '');
    });
    const writeFile = vi.fn(async () => {});
    const startPreview = vi.fn(async () => 'http://127.0.0.1:4173/');
    const capturePreviewScreenshot = vi.fn(async () => ({
      mimeType: 'image/png',
      data: 'ZmFrZS1pbWFnZQ==',
      width: 1280,
      height: 720,
    }));
    const events: Array<{ type: string; previewUrl?: string }> = [];

    const agent = new DesignAgent('做一个仪表盘页面', {
      onEvent: (event) => {
        events.push({ type: event.type, previewUrl: event.previewUrl });
      },
      onPassChange: () => {},
      callLLM,
      writeFile,
      startPreview,
      capturePreviewScreenshot,
    });

    await agent.run();

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith(
      'Dashboard.tsx',
      expect.stringContaining('export function Dashboard'),
    );
    expect(startPreview).toHaveBeenCalledTimes(1);
    expect(capturePreviewScreenshot).toHaveBeenCalledWith('http://127.0.0.1:4173/');
    expect(
      events.some((event) => event.type === 'preview_ready' && event.previewUrl === 'http://127.0.0.1:4173/'),
    ).toBe(true);

    const visualCall = llmCalls[3];
    expect(visualCall).toBeDefined();
    const visualContent = visualCall?.messages[0]?.content;
    expect(Array.isArray(visualContent)).toBe(true);
    if (Array.isArray(visualContent)) {
      expect(visualContent.some((part) => part.type === 'image')).toBe(true);
    }
  });
});
