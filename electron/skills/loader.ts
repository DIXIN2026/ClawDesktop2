/**
 * Skill Loader
 * Reads skill manifests from directories (manifest.yaml / manifest.json)
 * and loads SKILL.md as system prompts.
 */
import { readFileSync, existsSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { scanDirectory } from '../security/skill-scanner.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillToolParameter {
  type: string;
  description: string;
  required?: boolean;
}

export interface SkillTool {
  name: string;
  description: string;
  parameters: Record<string, SkillToolParameter>;
  endpoint?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface SkillSecurityIssue {
  rule: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  file: string;
  line: number;
  snippet: string;
}

export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  tools: SkillTool[];
  promptFile?: string;
  securityIssues?: SkillSecurityIssue[];
}

// ---------------------------------------------------------------------------
// Simple YAML parser (no external dependency)
// Handles flat keys, nested objects (2-level), and arrays of objects.
// ---------------------------------------------------------------------------

function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split('\n');

  let currentKey = '';
  let currentArray: Record<string, unknown>[] | null = null;
  let currentArrayItem: Record<string, unknown> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');

    // Skip blank lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    // Array item (starts with "  - " or "- ")
    const arrayItemMatch = line.match(/^(\s*)- (.+)/);
    if (arrayItemMatch && currentArray) {
      // Save previous item
      if (currentArrayItem) {
        currentArray.push(currentArrayItem);
      }

      const content = arrayItemMatch[2].trim();
      const colonIdx = content.indexOf(':');
      if (colonIdx !== -1) {
        const key = content.slice(0, colonIdx).trim();
        const val = content.slice(colonIdx + 1).trim();
        currentArrayItem = { [key]: stripYamlQuotes(val) };
      } else {
        currentArrayItem = { value: stripYamlQuotes(content) };
      }
      continue;
    }

    // Nested key inside an array item (indented deeper than the "- " line)
    const nestedInArrayMatch = line.match(/^\s{4,}(\w[\w.-]*)\s*:\s*(.*)/);
    if (nestedInArrayMatch && currentArrayItem) {
      const key = nestedInArrayMatch[1];
      const val = nestedInArrayMatch[2].trim();
      if (val === '' || val === '{}') {
        // Nested object placeholder — store empty object
        currentArrayItem[key] = val === '{}' ? {} : '';
      } else {
        currentArrayItem[key] = stripYamlQuotes(val);
      }
      continue;
    }

    // Top-level key
    const topMatch = line.match(/^(\w[\w.-]*)\s*:\s*(.*)/);
    if (topMatch) {
      // Flush previous array
      if (currentArray) {
        if (currentArrayItem) {
          currentArray.push(currentArrayItem);
          currentArrayItem = null;
        }
        result[currentKey] = currentArray;
        currentArray = null;
      }

      const key = topMatch[1];
      const val = topMatch[2].trim();

      if (val === '') {
        // Could be start of array or nested object — peek ahead handled by next iteration
        currentKey = key;
        currentArray = null;
        result[key] = '';
      } else {
        currentKey = key;
        result[key] = stripYamlQuotes(val);
      }
      continue;
    }

    // Indented key that starts an array (the first "- " hasn't been seen yet)
    // Detect if the next meaningful content under currentKey is an array
    const indentedKeyMatch = line.match(/^\s+(\w[\w.-]*)\s*:\s*(.*)/);
    if (indentedKeyMatch && !currentArray) {
      // Nested flat value under currentKey (treat currentKey as object)
      if (typeof result[currentKey] === 'string' && result[currentKey] === '') {
        result[currentKey] = {};
      }
      if (typeof result[currentKey] === 'object' && result[currentKey] !== null && !Array.isArray(result[currentKey])) {
        const obj = result[currentKey] as Record<string, unknown>;
        const nestedKey = indentedKeyMatch[1];
        const nestedVal = indentedKeyMatch[2].trim();
        obj[nestedKey] = stripYamlQuotes(nestedVal === '' ? '' : nestedVal);
      }
      continue;
    }

    // Detect array start for current key
    if (line.match(/^\s*-\s/) && currentKey && !currentArray) {
      currentArray = [];
      // Re-process this line
      const reMatch = line.match(/^\s*-\s+(.*)/);
      if (reMatch) {
        const content = reMatch[1].trim();
        const colonIdx = content.indexOf(':');
        if (colonIdx !== -1) {
          const k = content.slice(0, colonIdx).trim();
          const v = content.slice(colonIdx + 1).trim();
          currentArrayItem = { [k]: stripYamlQuotes(v) };
        } else {
          currentArrayItem = { value: stripYamlQuotes(content) };
        }
      }
    }
  }

  // Flush trailing array
  if (currentArray) {
    if (currentArrayItem) {
      currentArray.push(currentArrayItem);
    }
    result[currentKey] = currentArray;
  }

  return result;
}

function stripYamlQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Manifest normalization
// ---------------------------------------------------------------------------

function normalizeManifest(raw: Record<string, unknown>): SkillManifest | null {
  const id = typeof raw['id'] === 'string' ? raw['id'] : '';
  const name = typeof raw['name'] === 'string' ? raw['name'] : '';
  const version = typeof raw['version'] === 'string' ? raw['version'] : '0.0.0';
  const description = typeof raw['description'] === 'string' ? raw['description'] : '';
  const author = typeof raw['author'] === 'string' ? raw['author'] : '';
  const category = typeof raw['category'] === 'string' ? raw['category'] : 'utility';
  const promptFile = typeof raw['promptFile'] === 'string' ? raw['promptFile'] : undefined;

  if (!id || !name) return null;

  const tools: SkillTool[] = [];
  const rawTools = raw['tools'];
  if (Array.isArray(rawTools)) {
    for (const t of rawTools) {
      if (typeof t === 'object' && t !== null) {
        const tool = t as Record<string, unknown>;
        const toolName = typeof tool['name'] === 'string' ? tool['name'] : '';
        const toolDesc = typeof tool['description'] === 'string' ? tool['description'] : '';
        const toolParams: Record<string, SkillToolParameter> = {};
        const endpoint = typeof tool['endpoint'] === 'string' ? tool['endpoint'] : undefined;
        const methodRaw = typeof tool['method'] === 'string' ? tool['method'].toUpperCase() : undefined;
        const method = methodRaw === 'GET' || methodRaw === 'POST' || methodRaw === 'PUT'
          || methodRaw === 'PATCH' || methodRaw === 'DELETE'
          ? methodRaw
          : undefined;
        const timeoutMs = typeof tool['timeoutMs'] === 'number' && Number.isFinite(tool['timeoutMs'])
          ? Math.max(1000, Math.floor(tool['timeoutMs']))
          : undefined;
        const headers: Record<string, string> = {};

        const rawParams = tool['parameters'];
        if (typeof rawParams === 'object' && rawParams !== null && !Array.isArray(rawParams)) {
          for (const [paramKey, paramVal] of Object.entries(rawParams as Record<string, unknown>)) {
            if (typeof paramVal === 'object' && paramVal !== null) {
              const pv = paramVal as Record<string, unknown>;
              toolParams[paramKey] = {
                type: typeof pv['type'] === 'string' ? pv['type'] : 'string',
                description: typeof pv['description'] === 'string' ? pv['description'] : '',
                required: pv['required'] === true || pv['required'] === 'true' ? true : undefined,
              };
            }
          }
        }
        const rawHeaders = tool['headers'];
        if (typeof rawHeaders === 'object' && rawHeaders !== null && !Array.isArray(rawHeaders)) {
          for (const [k, v] of Object.entries(rawHeaders as Record<string, unknown>)) {
            if (typeof v === 'string' && k.trim().length > 0) {
              headers[k] = v;
            }
          }
        }

        if (toolName) {
          tools.push({
            name: toolName,
            description: toolDesc,
            parameters: toolParams,
            endpoint,
            method,
            headers: Object.keys(headers).length > 0 ? headers : undefined,
            timeoutMs,
          });
        }
      }
    }
  }

  return { id, name, version, description, author, category, tools, promptFile };
}

// ---------------------------------------------------------------------------
// Synchronous security scanning helpers
// ---------------------------------------------------------------------------

function mapSeverity(severity: string): 'low' | 'medium' | 'high' | 'critical' {
  switch (severity) {
    case 'critical': return 'critical';
    case 'warn': return 'high';
    case 'info': return 'low';
    default: return 'medium';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a skill manifest from a directory.
 * Looks for manifest.json first, then manifest.yaml.
 */
export function loadSkillManifest(skillDir: string): SkillManifest | null {
  try {
    const jsonPath = join(skillDir, 'manifest.json');
    if (existsSync(jsonPath)) {
      const content = readFileSync(jsonPath, 'utf-8');
      const parsed: unknown = JSON.parse(content);
      if (typeof parsed === 'object' && parsed !== null) {
        return normalizeManifest(parsed as Record<string, unknown>);
      }
    }

    const yamlPath = join(skillDir, 'manifest.yaml');
    if (existsSync(yamlPath)) {
      const content = readFileSync(yamlPath, 'utf-8');
      const parsed = parseSimpleYaml(content);
      return normalizeManifest(parsed);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Load all skills from a parent directory.
 * Each subdirectory is treated as a potential skill folder.
 */
export async function loadSkillsFromDirectory(dir: string, runSecurityScan = true): Promise<SkillManifest[]> {
  const skills: SkillManifest[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return skills;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      const st = await stat(fullPath);
      if (!st.isDirectory()) continue;
      const manifest = loadSkillManifest(fullPath);
      if (manifest) {
        if (runSecurityScan) {
          try {
            const findings = await scanDirectory(fullPath, { maxFiles: 500, maxFileBytes: 1024 * 1024 });
            if (findings.length > 0) {
              manifest.securityIssues = findings.map((f) => ({
                rule: f.ruleId,
                severity: mapSeverity(f.severity),
                file: f.file,
                line: f.line,
                snippet: f.evidence,
              }));
            }
          } catch {
            void 0;
          }
        }
        skills.push(manifest);
      }
    } catch {
      continue;
    }
  }

  return skills;
}

/**
 * Load the SKILL.md system prompt from a skill directory.
 */
export function loadSkillPrompt(skillDir: string): string | null {
  try {
    const promptPath = join(skillDir, 'SKILL.md');
    if (existsSync(promptPath)) {
      return readFileSync(promptPath, 'utf-8');
    }
    return null;
  } catch {
    return null;
  }
}
