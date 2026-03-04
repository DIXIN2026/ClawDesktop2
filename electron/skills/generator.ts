/**
 * AI Skill Generator
 * Generates skill manifest + SKILL.md draft from natural language requirements.
 */
import { randomUUID } from 'node:crypto';
import { streamAnthropicMessages } from '../providers/adapters/anthropic.js';
import { streamOpenAICompatible } from '../providers/adapters/openai-compat.js';
import { streamOllamaGenerate } from '../providers/adapters/ollama.js';
import type { ProviderConfig } from '../providers/types.js';
import type { SkillManifest, SkillTool, SkillToolParameter } from './loader.js';

export interface SkillGenerateRequest {
  requirement: string;
  provider: ProviderConfig;
  modelId: string;
  apiKey?: string | null;
}

export interface GeneratedSkillDraft {
  manifest: SkillManifest;
  skillPrompt: string;
  raw: string;
  warnings: string[];
}

const SYSTEM_PROMPT = `You generate ClawDesktop skill definitions.
Return JSON only. No markdown.

Required output shape:
{
  "manifest": {
    "id": "kebab-case-id",
    "name": "Human Name",
    "version": "0.1.0",
    "description": "What this skill does",
    "author": "AI Generated",
    "category": "utility",
    "tools": [
      {
        "name": "tool_name",
        "description": "tool purpose",
        "parameters": {
          "param_name": {
            "type": "string",
            "description": "param description",
            "required": true
          }
        }
      }
    ],
    "promptFile": "SKILL.md"
  },
  "skillPrompt": "content of SKILL.md with concrete workflow, constraints, and examples"
}

Rules:
- category must be one of: code, design, test, utility
- keep 1-4 tools
- every tool must have clear parameters schema
- if endpoint is unknown, omit endpoint/method instead of hallucinating URLs
- skillPrompt should be practical, concise, and executable`;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeId(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || `generated-skill-${randomUUID().slice(0, 8)}`;
}

function normalizeCategory(input: string): string {
  const lower = input.toLowerCase();
  if (lower === 'code' || lower === 'design' || lower === 'test' || lower === 'utility') {
    return lower;
  }
  return 'utility';
}

function normalizeToolParameters(raw: unknown): Record<string, SkillToolParameter> {
  const record = asRecord(raw);
  if (!record) return {};
  const out: Record<string, SkillToolParameter> = {};

  for (const [key, value] of Object.entries(record)) {
    const param = asRecord(value);
    if (!param) continue;
    const type = toString(param.type, 'string');
    const description = toString(param.description, '');
    const required = param.required === true ? true : undefined;
    out[key] = { type, description, required };
  }
  return out;
}

function normalizeTools(raw: unknown): SkillTool[] {
  if (!Array.isArray(raw)) return [];
  const tools: SkillTool[] = [];

  for (const item of raw) {
    const t = asRecord(item);
    if (!t) continue;
    const name = toString(t.name).trim();
    if (!name) continue;
    const description = toString(t.description);
    const parameters = normalizeToolParameters(t.parameters);
    const endpoint = toString(t.endpoint).trim() || undefined;
    const methodRaw = toString(t.method).toUpperCase();
    const method = methodRaw === 'GET'
      || methodRaw === 'POST'
      || methodRaw === 'PUT'
      || methodRaw === 'PATCH'
      || methodRaw === 'DELETE'
      ? methodRaw
      : undefined;
    const headers = asRecord(t.headers);
    const timeoutMs = typeof t.timeoutMs === 'number' && Number.isFinite(t.timeoutMs)
      ? Math.max(1000, Math.floor(t.timeoutMs))
      : undefined;

    const tool: SkillTool = {
      name,
      description,
      parameters,
    };
    if (endpoint) tool.endpoint = endpoint;
    if (method) tool.method = method;
    if (headers) {
      const sanitized: Record<string, string> = {};
      for (const [hk, hv] of Object.entries(headers)) {
        if (typeof hv === 'string' && hk.trim()) {
          sanitized[hk] = hv;
        }
      }
      if (Object.keys(sanitized).length > 0) {
        tool.headers = sanitized;
      }
    }
    if (timeoutMs) tool.timeoutMs = timeoutMs;
    tools.push(tool);
    if (tools.length >= 4) break;
  }

  return tools;
}

function extractJsonObject(text: string): Record<string, unknown> {
  const candidates: string[] = [];
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    candidates.push(fenceMatch[1].trim());
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  candidates.push(text.trim());

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const obj = asRecord(parsed);
      if (obj) return obj;
    } catch {
      // try next candidate
    }
  }
  throw new Error('Model output is not valid JSON');
}

function normalizeDraft(parsed: Record<string, unknown>, requirement: string): GeneratedSkillDraft {
  const warnings: string[] = [];

  const manifestNode = asRecord(parsed.manifest) ?? parsed;
  const name = toString(manifestNode.name, 'Generated Skill').trim() || 'Generated Skill';
  const id = normalizeId(toString(manifestNode.id, name));
  const version = toString(manifestNode.version, '0.1.0');
  const description = toString(manifestNode.description, requirement.slice(0, 240));
  const author = toString(manifestNode.author, 'AI Generated');
  const category = normalizeCategory(toString(manifestNode.category, 'utility'));
  const tools = normalizeTools(manifestNode.tools);

  if (tools.length === 0) {
    warnings.push('No tools were generated; added a placeholder tool.');
  }

  const manifest: SkillManifest = {
    id,
    name,
    version,
    description,
    author,
    category,
    promptFile: 'SKILL.md',
    tools: tools.length > 0 ? tools : [{
      name: 'run',
      description: 'Placeholder tool generated from requirement',
      parameters: {
        query: {
          type: 'string',
          description: 'User request',
          required: true,
        },
      },
    }],
  };

  const skillPromptRaw = toString(parsed.skillPrompt, '').trim();
  const skillPrompt = skillPromptRaw.length > 0
    ? skillPromptRaw
    : [
        `# ${manifest.name}`,
        '',
        '## Objective',
        description,
        '',
        '## Workflow',
        '1. Understand user request and constraints.',
        '2. Execute the most appropriate tool with validated parameters.',
        '3. Return concise results with actionable next steps.',
      ].join('\n');

  if (!skillPromptRaw) {
    warnings.push('Model did not provide skillPrompt; fallback template was used.');
  }

  return {
    manifest,
    skillPrompt,
    raw: JSON.stringify(parsed, null, 2),
    warnings,
  };
}

async function callModel(params: SkillGenerateRequest): Promise<string> {
  const { provider, modelId, apiKey, requirement } = params;
  const userPrompt = `Generate a ClawDesktop skill for this requirement:\n\n${requirement}`;
  let text = '';

  switch (provider.apiProtocol) {
    case 'anthropic-messages': {
      if (!apiKey) {
        throw new Error(`Provider "${provider.id}" requires API key`);
      }
      const stream = streamAnthropicMessages(provider.baseUrl, apiKey, {
        model: modelId,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        maxTokens: 4096,
      });
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
          text += chunk.delta.text;
        }
      }
      return text;
    }
    case 'openai-compatible': {
      if (!apiKey) {
        throw new Error(`Provider "${provider.id}" requires API key`);
      }
      const stream = streamOpenAICompatible(provider.baseUrl, apiKey, {
        model: modelId,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        maxTokens: 4096,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) text += delta;
      }
      return text;
    }
    case 'ollama': {
      const stream = streamOllamaGenerate(
        provider.baseUrl,
        modelId,
        `${SYSTEM_PROMPT}\n\n${userPrompt}`,
      );
      for await (const chunk of stream) {
        if (chunk.response) text += chunk.response;
      }
      return text;
    }
    default:
      throw new Error(`Unsupported protocol: ${provider.apiProtocol as string}`);
  }
}

export async function generateSkillDraft(params: SkillGenerateRequest): Promise<GeneratedSkillDraft> {
  const rawText = await callModel(params);
  const parsed = extractJsonObject(rawText);
  const normalized = normalizeDraft(parsed, params.requirement);
  return {
    ...normalized,
    raw: rawText,
  };
}
