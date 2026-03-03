/**
 * Anthropic Messages API Adapter
 */

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; source?: unknown }>;
}

export interface AnthropicStreamEvent {
  type: string;
  delta?: { type: string; text?: string };
  content_block?: { type: string; text?: string };
  index?: number;
}

export interface AnthropicRequestParams {
  model: string;
  messages: AnthropicMessage[];
  maxTokens: number;
  system?: string;
  stream?: boolean;
  tools?: unknown[];
}

export async function* streamAnthropicMessages(
  baseUrl: string,
  apiKey: string,
  params: AnthropicRequestParams,
): AsyncIterable<AnthropicStreamEvent> {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      max_tokens: params.maxTokens,
      system: params.system,
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
