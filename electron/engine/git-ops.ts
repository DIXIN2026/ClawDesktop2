/**
 * Git Operations Module
 * Wraps git CLI commands via child_process.execSync for synchronous git operations.
 */

import { execFileSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';

export interface GitFileEntry {
  path: string;
  status: FileStatus;
  staged: boolean;
}

export interface GitStatus {
  branch: string;
  files: GitFileEntry[];
  ahead: number;
  behind: number;
}

export interface GitDiffFile {
  path: string;
  additions: number;
  deletions: number;
  diff: string;
}

export interface GitDiffResult {
  files: GitDiffFile[];
}

export interface GitSnapshot {
  ref: string;
  commitHash: string;
  timestamp: number;
}

export interface GitWorktreeEntry {
  path: string;
  branch: string;
  isMain: boolean;
}

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

class GitError extends Error {
  constructor(operation: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`git ${operation} failed: ${detail}`);
    this.name = 'GitError';
  }
}

function git(args: string[], workDir: string): string {
  try {
    return execFileSync('git', args, {
      cwd: workDir,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10 MB
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    throw new GitError(args[0] ?? 'unknown', err);
  }
}

// ---------------------------------------------------------------------------
// Status parsing  (git status --porcelain=v2 --branch)
// ---------------------------------------------------------------------------

function parseStatusCode(xy: string, area: 'staged' | 'worktree'): FileStatus | null {
  const ch = area === 'staged' ? xy[0] : xy[1];
  if (ch === undefined) return null;
  switch (ch) {
    case 'M': return 'modified';
    case 'A': return 'added';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    case '.': return null;
    case '?': return 'untracked';
    default: return null;
  }
}

export function getGitStatus(workDir: string): GitStatus {
  const raw = git(['status', '--porcelain=v2', '--branch'], workDir);
  const lines = raw.split('\n');

  let branch = 'HEAD';
  let ahead = 0;
  let behind = 0;
  const files: GitFileEntry[] = [];

  for (const line of lines) {
    if (!line) continue;

    // Branch headers
    if (line.startsWith('# branch.head ')) {
      branch = line.slice('# branch.head '.length);
      continue;
    }
    if (line.startsWith('# branch.ab ')) {
      const match = line.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        ahead = parseInt(match[1] ?? '0', 10);
        behind = parseInt(match[2] ?? '0', 10);
      }
      continue;
    }
    // Skip other header lines
    if (line.startsWith('#')) continue;

    // Ordinary changed entries: "1 XY ..."
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parts = line.split(' ');
      const xy = parts[1] ?? '..';
      // For renamed entries (type 2), the path is at the end after a tab
      const filePath = line.startsWith('2 ')
        ? (line.split('\t')[1] ?? parts[parts.length - 1] ?? '')
        : (parts[parts.length - 1] ?? '');

      const stagedStatus = parseStatusCode(xy, 'staged');
      const worktreeStatus = parseStatusCode(xy, 'worktree');

      if (stagedStatus) {
        files.push({ path: filePath, status: stagedStatus, staged: true });
      }
      if (worktreeStatus) {
        files.push({ path: filePath, status: worktreeStatus, staged: false });
      }
      continue;
    }

    // Untracked entries: "? path"
    if (line.startsWith('? ')) {
      const filePath = line.slice(2);
      files.push({ path: filePath, status: 'untracked', staged: false });
      continue;
    }

    // Unmerged entries: "u ..." — treat as modified
    if (line.startsWith('u ')) {
      const parts = line.split(' ');
      const filePath = parts[parts.length - 1] ?? '';
      files.push({ path: filePath, status: 'modified', staged: false });
    }
  }

  return { branch, files, ahead, behind };
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export function getGitDiff(workDir: string, staged = false): GitDiffResult {
  const diffArgs = staged ? ['diff', '--cached'] : ['diff'];
  const numstatRaw = git([...diffArgs, '--numstat'], workDir);
  const fullDiffRaw = git(diffArgs, workDir);

  const files: GitDiffFile[] = [];
  const numstatLines = numstatRaw ? numstatRaw.split('\n') : [];

  // Build per-file diffs from full diff output
  const fileDiffMap = new Map<string, string>();
  if (fullDiffRaw) {
    const diffSections = fullDiffRaw.split(/^diff --git /m);
    for (const section of diffSections) {
      if (!section.trim()) continue;
      // Extract file path from "a/path b/path"
      const headerMatch = section.match(/^a\/(.+?)\s+b\/(.+)/m);
      const filePath = headerMatch?.[2] ?? headerMatch?.[1] ?? '';
      if (filePath) {
        fileDiffMap.set(filePath, `diff --git ${section}`);
      }
    }
  }

  for (const line of numstatLines) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const additionsRaw = parts[0] ?? '0';
    const deletionsRaw = parts[1] ?? '0';
    const filePath = parts[2] ?? '';
    // Binary files show '-' for additions/deletions
    const additions = additionsRaw === '-' ? 0 : parseInt(additionsRaw, 10);
    const deletions = deletionsRaw === '-' ? 0 : parseInt(deletionsRaw, 10);

    files.push({
      path: filePath,
      additions,
      deletions,
      diff: fileDiffMap.get(filePath) ?? '',
    });
  }

  return { files };
}

export function getGitFileDiff(workDir: string, filePath: string, staged = false): string {
  if (!filePath || filePath.includes('\0')) {
    throw new GitError('diff', new Error('Invalid file path'));
  }
  const args = staged ? ['diff', '--cached', '--', filePath] : ['diff', '--', filePath];
  try {
    return execFileSync('git', args, {
      cwd: workDir,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new GitError('diff', err);
  }
}

// ---------------------------------------------------------------------------
// Commit / Push / Stage / Unstage / Revert
// ---------------------------------------------------------------------------

export function gitCommit(workDir: string, message: string): string {
  git(['commit', '-m', message], workDir);
  return git(['rev-parse', 'HEAD'], workDir);
}

export function gitPush(workDir: string, remote = 'origin', branch?: string): void {
  const args = ['push', remote];
  if (branch) args.push(branch);
  git(args, workDir);
}

export function gitStage(workDir: string, files: string[]): void {
  if (files.length === 0) return;
  git(['add', '--', ...files], workDir);
}

export function gitUnstage(workDir: string, files: string[]): void {
  if (files.length === 0) return;
  git(['reset', 'HEAD', '--', ...files], workDir);
}

export function gitRevert(workDir: string, files: string[]): void {
  if (files.length === 0) return;
  git(['checkout', '--', ...files], workDir);
}

// ---------------------------------------------------------------------------
// Snapshot (for undo)
// ---------------------------------------------------------------------------

export function createSnapshot(workDir: string): GitSnapshot {
  const commitHash = git(['rev-parse', 'HEAD'], workDir);

  // Record the current HEAD as a snapshot reference.
  // We intentionally do NOT stash — stashing clears the working directory
  // which would destroy in-progress work.
  return {
    ref: commitHash,
    commitHash,
    timestamp: Date.now(),
  };
}

export function undoToSnapshot(workDir: string, snapshotRef: string): void {
  // Validate snapshotRef is a safe git ref to prevent injection
  // Allow: hex hashes (4-40 chars), HEAD~N, HEAD^N
  if (!/^([0-9a-f]{4,40}|HEAD([~^]\d{0,3})?)$/i.test(snapshotRef)) {
    throw new GitError('undo', new Error(`Invalid snapshot ref: ${snapshotRef}`));
  }
  git(['reset', '--hard', snapshotRef], workDir);
}

export function redoFromUndo(workDir: string): void {
  // ORIG_HEAD tracks the previous HEAD for reset operations.
  git(['reset', '--hard', 'ORIG_HEAD'], workDir);
}

// ---------------------------------------------------------------------------
// Worktrees
// ---------------------------------------------------------------------------

export function listWorktrees(workDir: string): GitWorktreeEntry[] {
  const raw = git(['worktree', 'list', '--porcelain'], workDir);
  if (!raw) return [];

  const entries: GitWorktreeEntry[] = [];
  const blocks = raw.split('\n\n');

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    let path = '';
    let branch = '';
    let isMain = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length);
      } else if (line.startsWith('branch ')) {
        const fullRef = line.slice('branch '.length);
        branch = fullRef.replace(/^refs\/heads\//, '');
      } else if (line === 'bare') {
        isMain = true;
      }
    }

    // The first worktree listed is always the main one
    if (entries.length === 0) {
      isMain = true;
    }

    if (path) {
      entries.push({ path, branch, isMain });
    }
  }

  return entries;
}

export function createWorktree(workDir: string, branch: string, path: string): string {
  // Validate branch name to prevent injection
  if (!/^[\w./-]+$/.test(branch)) {
    throw new GitError('worktree', new Error(`Invalid branch name: ${branch}`));
  }
  // Validate path: block traversal and ensure it stays under workDir
  if (/\.\.[\\/]/.test(path)) {
    throw new GitError('worktree', new Error(`Path traversal not allowed: ${path}`));
  }
  git(['worktree', 'add', '-b', branch, path], workDir);
  return path;
}

export function removeWorktree(workDir: string, path: string): void {
  // Validate path: block traversal
  if (/\.\.[\\/]/.test(path)) {
    throw new GitError('worktree', new Error(`Path traversal not allowed: ${path}`));
  }
  // Use non-force removal to warn about dirty worktrees instead of silently discarding
  git(['worktree', 'remove', path], workDir);
}
