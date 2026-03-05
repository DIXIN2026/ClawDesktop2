import { create } from 'zustand';
import { ipc } from '../services/ipc';

const isNotGitRepoError = (err: unknown): boolean => {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('not a git repository');
};

// ── Types ──────────────────────────────────────────────────────────

export interface FileChange {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  staged: boolean;
}

export interface GitStatus {
  branch: string;
  files: FileChange[];
  ahead: number;
  behind: number;
}

export interface GitWorktree {
  path: string;
  branch: string;
  isMain: boolean;
}

interface GitState {
  workDirectory: string | null;
  branch: string;
  files: FileChange[];
  ahead: number;
  behind: number;
  diffContent: string;
  selectedFile: string | null;
  isLoading: boolean;
  worktrees: GitWorktree[];
  isWorktreeLoading: boolean;

  setWorkDirectory: (workDirectory: string | null | undefined) => Promise<void>;
  refreshStatus: () => Promise<void>;
  loadDiff: (filePath?: string) => Promise<void>;
  stageFiles: (paths: string[]) => Promise<void>;
  unstageFiles: (paths: string[]) => Promise<void>;
  revertFiles: (paths: string[]) => Promise<void>;
  commit: (message: string) => Promise<string>;
  push: () => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  loadWorktrees: () => Promise<void>;
  createWorktree: (branch: string, path: string) => Promise<void>;
  removeWorktree: (path: string) => Promise<void>;
  selectFile: (path: string | null) => void;
}

// ── Store ───────────────────────────────────────────────────────────

export const useGitStore = create<GitState>((set, get) => ({
  workDirectory: null,
  branch: '',
  files: [],
  ahead: 0,
  behind: 0,
  diffContent: '',
  selectedFile: null,
  isLoading: false,
  worktrees: [],
  isWorktreeLoading: false,

  setWorkDirectory: async (workDirectory) => {
    const normalized = typeof workDirectory === 'string' && workDirectory.trim().length > 0
      ? workDirectory.trim()
      : null;
    if (get().workDirectory === normalized) return;

    set({
      workDirectory: normalized,
      selectedFile: null,
      diffContent: '',
    });

    await Promise.allSettled([
      get().refreshStatus(),
      get().loadWorktrees(),
    ]);
  },

  refreshStatus: async () => {
    set({ isLoading: true });
    try {
      const status = await ipc.gitStatus(get().workDirectory ?? undefined);
      set({
        branch: status.branch,
        files: status.files,
        ahead: status.ahead,
        behind: status.behind,
        isLoading: false,
      });
    } catch (err) {
      if (isNotGitRepoError(err)) {
        set({
          branch: '',
          files: [],
          ahead: 0,
          behind: 0,
          diffContent: '',
          isLoading: false,
        });
        return;
      }
      console.error('[Git] refreshStatus failed:', err instanceof Error ? err.message : String(err));
      set({ isLoading: false });
    }
  },

  loadDiff: async (filePath) => {
    try {
      const diff = await ipc.gitDiff(filePath, get().workDirectory ?? undefined);
      set({ diffContent: diff });
    } catch (err) {
      console.error('[Git] loadDiff failed:', err instanceof Error ? err.message : String(err));
      set({ diffContent: '' });
    }
  },

  stageFiles: async (paths) => {
    await ipc.gitStage(paths, get().workDirectory ?? undefined);
    await get().refreshStatus();
  },

  unstageFiles: async (paths) => {
    await ipc.gitUnstage(paths, get().workDirectory ?? undefined);
    await get().refreshStatus();
  },

  revertFiles: async (paths) => {
    await ipc.gitRevert(paths, get().workDirectory ?? undefined);
    await get().refreshStatus();
  },

  commit: async (message) => {
    const result = await ipc.gitCommit(message, get().workDirectory ?? undefined);
    await get().refreshStatus();
    return result.commitHash;
  },

  push: async () => {
    await ipc.gitPush(get().workDirectory ?? undefined);
    await get().refreshStatus();
  },

  undo: async () => {
    await ipc.gitUndo(undefined, get().workDirectory ?? undefined);
    await get().refreshStatus();
  },

  redo: async () => {
    await ipc.gitRedo(get().workDirectory ?? undefined);
    await get().refreshStatus();
  },

  loadWorktrees: async () => {
    set({ isWorktreeLoading: true });
    try {
      const worktrees = await ipc.gitWorktreeList(get().workDirectory ?? undefined);
      set({ worktrees, isWorktreeLoading: false });
    } catch (err) {
      if (isNotGitRepoError(err)) {
        set({ worktrees: [], isWorktreeLoading: false });
        return;
      }
      console.error('[Git] loadWorktrees failed:', err instanceof Error ? err.message : String(err));
      set({ worktrees: [], isWorktreeLoading: false });
    }
  },

  createWorktree: async (branch, path) => {
    await ipc.gitWorktreeCreate(branch, path, get().workDirectory ?? undefined);
    await get().loadWorktrees();
  },

  removeWorktree: async (path) => {
    await ipc.gitWorktreeRemove(path, get().workDirectory ?? undefined);
    await get().loadWorktrees();
  },

  selectFile: (path) => {
    set({ selectedFile: path });
    if (path) {
      get().loadDiff(path);
    } else {
      set({ diffContent: '' });
    }
  },
}));
