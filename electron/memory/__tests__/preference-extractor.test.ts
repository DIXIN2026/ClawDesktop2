import { describe, it, expect } from 'vitest';
import { extractPreferenceFacts } from '../preference-extractor.js';

describe('preference-extractor', () => {
  it('extracts chinese preference statements', () => {
    const facts = extractPreferenceFacts('我更喜欢用 TypeScript，另外不要写注释。');
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some((f) => f.content.includes('TypeScript'))).toBe(true);
    expect(facts.some((f) => f.content.toLowerCase().includes('no code comments'))).toBe(true);
  });

  it('extracts english preference statements', () => {
    const facts = extractPreferenceFacts('I prefer Python. please use concise output.');
    expect(facts.some((f) => f.content.toLowerCase().includes('python'))).toBe(true);
    expect(facts.some((f) => f.content.toLowerCase().includes('user requirement'))).toBe(true);
  });

  it('deduplicates repeated preferences', () => {
    const facts = extractPreferenceFacts('不要加注释，不要写注释。');
    const unique = new Set(facts.map((f) => f.content.toLowerCase()));
    expect(unique.size).toBe(facts.length);
  });
});
