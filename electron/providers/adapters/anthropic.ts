/**
 * Anthropic Messages API Adapter
 * Supports Prompt Caching for reduced latency and cost.
 */

export interface CacheControl {
  type: 'ephemeral';
}

export interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  source?: { type: 'base64'; media_type: string; data: string };
  cache_control?: CacheControl;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicSystemBlock {
  type: 'text';
  text: string;
  cache_control?: CacheControl;
}

export interface AnthropicStreamEvent {
  type: string;
  delta?: { type: string; text?: string };
  content_block?: { type: string; text?: string };
  index?: number;
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface AnthropicRequestParams {
  model: string;
  messages: AnthropicMessage[];
  maxTokens: number;
  system?: string | AnthropicSystemBlock[];
  stream?: boolean;
  tools?: unknown[];
  /** Enable prompt caching for system prompt and large context blocks */
  enableCaching?: boolean;
}

/** Minimum tokens for cache eligibility (Anthropic requirement) */
const MIN_CACHE_TOKENS = 1024;

/** Estimate tokens from text (rough approximation) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function* streamAnthropicMessages(
  baseUrl: string,
  apiKey: string,
  params: AnthropicRequestParams,
): AsyncIterable<AnthropicStreamEvent> {
  const { enableCaching = true } = params;

  let systemBlocks: AnthropicSystemBlock[] | undefined;
  if (params.system) {
    if (typeof params.system === 'string') {
      const systemText = params.system;
      const systemTokens = estimateTokens(systemText);
      if (enableCaching && systemTokens >= MIN_CACHE_TOKENS) {
        systemBlocks = [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }];
      } else {
        systemBlocks = [{ type: 'text', text: systemText }];
      }
    } else {
      systemBlocks = params.system;
    }
  }

  const processedMessages: AnthropicMessage[] = params.messages.map((msg) => {
    if (!enableCaching || typeof msg.content === 'string') {
      return msg;
    }

    const contentBlocks: AnthropicContentBlock[] = msg.content.map((block, idx, arr) => {
      if (block.type === 'text' && block.text) {
        const blockTokens = estimateTokens(block.text);
        if (blockTokens >= MIN_CACHE_TOKENS && idx === arr.length - 1) {
          return { ...block, cache_control: { type: 'ephemeral' } };
        }
      }
      return block;
    });

    return { ...msg, content: contentBlocks };
  });

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: params.model,
      messages: processedMessages,
      max_tokens: params.maxTokens,
      system: systemBlocks,
      stream: true,
      tools: params.tools,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          yield JSON.parse(data) as AnthropicStreamEvent;
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }
}

export { MIN_CACHE_TOKENS, estimateTokens };
