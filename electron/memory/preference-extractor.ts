/**
 * User Preference Extractor
 * Lightweight rule-based extraction for building preference observations.
 */

export interface PreferenceFact {
  content: string;
  confidence: number;
}

const LANGUAGE_PATTERNS = [
  { re: /\btypescript\b/i, text: 'User prefers TypeScript' },
  { re: /\bjavascript\b/i, text: 'User prefers JavaScript' },
  { re: /\bpython\b/i, text: 'User prefers Python' },
  { re: /\bgo(lang)?\b/i, text: 'User prefers Go' },
  { re: /\brust\b/i, text: 'User prefers Rust' },
];

export function extractPreferenceFacts(input: string): PreferenceFact[] {
  const text = input.trim();
  if (!text) return [];

  const out: PreferenceFact[] = [];
  const seen = new Set<string>();

  const push = (content: string, confidence: number) => {
    const normalized = content.trim();
    if (!normalized) return;
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    out.push({ content: normalized, confidence });
  };

  // Chinese preference patterns
  for (const match of text.matchAll(/我(?:更?喜欢|偏好|倾向于|习惯(?:使用)?|通常使用)([^。！\n]{2,80})/g)) {
    const value = (match[1] ?? '').trim();
    if (value) push(`用户偏好：${value}`, 0.85);
  }
  for (const match of text.matchAll(/(?:请|希望|最好)(?:你)?([^。！\n]{2,80})/g)) {
    const value = (match[1] ?? '').trim();
    if (value) push(`用户要求：${value}`, 0.7);
  }

  // English preference patterns
  for (const match of text.matchAll(/\bI (?:prefer|like|usually use|tend to use)\s+([^.\n]{2,80})/gi)) {
    const value = (match[1] ?? '').trim();
    if (value) push(`User preference: ${value}`, 0.8);
  }
  for (const match of text.matchAll(/\bplease (?:use|avoid|don't use)\s+([^.\n]{2,80})/gi)) {
    const value = (match[1] ?? '').trim();
    if (value) push(`User requirement: ${value}`, 0.75);
  }

  // Explicit coding style constraints
  if (/不要.*注释|别.*注释|no comments?/i.test(text)) {
    push('User prefers minimal or no code comments', 0.95);
  }
  if (/多写注释|详细注释|add (?:more )?comments?/i.test(text)) {
    push('User prefers detailed code comments', 0.95);
  }
  if (/先测试|测试优先|test[- ]?first/i.test(text)) {
    push('User prefers test-first workflow', 0.9);
  }

  for (const lang of LANGUAGE_PATTERNS) {
    if (lang.re.test(text)) {
      push(lang.text, 0.7);
    }
  }

  return out.slice(0, 8);
}
