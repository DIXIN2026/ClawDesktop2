/**
 * Ollama Local Model Adapter
 */

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

export interface OllamaGenerateChunk {
  model: string;
  response: string;
  done: boolean;
}

export async function listOllamaModels(baseUrl = 'http://localhost:11434'): Promise<OllamaModel[]> {
  const response = await fetch(`${baseUrl}/api/tags`);
  if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
  const data = await response.json() as { models: OllamaModel[] };
  return data.models;
}

export async function* streamOllamaGenerate(
  baseUrl: string,
  model: string,
  prompt: string,
): AsyncIterable<OllamaGenerateChunk> {
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: true }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama error ${response.status}: ${text}`);
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
      if (line.trim()) {
        try {
          yield JSON.parse(line) as OllamaGenerateChunk;
        } catch {
          // Skip malformed
        }
      }
    }
  }
}
