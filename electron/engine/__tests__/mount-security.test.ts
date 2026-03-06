import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { validateContainerPath, validateMount } from '../mount-security.js';

describe('mount-security', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const dir = tempRoots.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('rejects reserved container path', () => {
    const result = validateContainerPath('/proc');
    expect(result.valid).toBe(false);
  });

  it('rejects traversal container path', () => {
    const result = validateContainerPath('/workspace/../etc');
    expect(result.valid).toBe(false);
  });

  it('allows safe container path', () => {
    const result = validateContainerPath('/workspace/project');
    expect(result.valid).toBe(true);
  });

  it('blocks dangerous host path pattern', () => {
    const root = mkdtempSync('/tmp/mount-sec-');
    tempRoots.push(root);
    const blockedDir = join(root, '.ssh');
    mkdirSync(blockedDir, { recursive: true });
    const result = validateMount(blockedDir);
    expect(result.valid).toBe(false);
  });

  it('allows regular temp directory mount', () => {
    const root = mkdtempSync('/tmp/mount-sec-');
    tempRoots.push(root);
    const safeDir = join(root, 'workspace');
    mkdirSync(safeDir, { recursive: true });
    const result = validateMount(safeDir);
    expect(result.valid).toBe(true);
  });
});
