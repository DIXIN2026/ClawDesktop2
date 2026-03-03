import { create } from 'zustand';
import { ipc } from '../services/ipc';

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

interface GitState {
  branch: string;
  files: FileChange[];
  ahead: number;
  behind: number;
  diffContent: string;
  selectedFile: string | null;
  isLoading: boolean;

  refreshStatus: () => Promise<void>;
  loadDiff: (filePath?: string) => Promise<void>;
  stageFiles: (paths: string[]) => Promise<void>;
  unstageFiles: (paths: string[]) => Promise<void>;
  revertFiles: (paths: string[]) => Promise<void>;
  commit: (message: string) => Promise<string>;
  push: () => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  selectFile: (path: string | null) => void;
}

// ── Store ───────────────────────────────────────────────────────────

export const useGitStore = create<GitState>((set, get) => ({
  branch: '',
  files: [],
  ahead: 0,
  behind: 0,
  diffContent: '',
  selectedFile: null,
  isLoading: false,

  refreshStatus: async () => {
    set({ isLoading: true });
    try {
      const status = await ipc.gitStatus();
      set({
        branch: status.branch,
        files: status.files,
        ahead: status.ahead,
        behind: status.behind,
        isLoading: false,
      });
    } catch (err) {
      console.error('[Git] refreshStatus failed:', err instanceof Error ? err.message : String(err));
      set({ isLoading: false });
    }
  },

  loadDiff: async (filePath) => {
    try {
      const diff = await ipc.gitDiff(filePath);
      set({ diffContent: diff });
    } catch (err) {
      console.error('[Git] loadDiff failed:', err instanceof Error ? err.message : String(err));
      set({ diffContent: '' });
    }
  },

  stageFiles: async (paths) => {
    await ipc.gitStage(paths);
    await get().refreshStatus();
  },

  unstageFiles: async (paths) => {
    await ipc.gitUnstage(paths);
    await get().refreshStatus();
  },

  revertFiles: async (paths) => {
    await ipc.gitRevert(paths);
    await get().refreshStatus();
  },

  commit: async (message) => {
    const result = await ipc.gitCommit(message);
    await get().refreshStatus();
    return result.commitHash;
  },

  push: async () => {
    await ipc.gitPush();
    await get().refreshStatus();
  },

  undo: async () => {
    await ipc.gitUndo();
    await get().refreshStatus();
  },

  redo: async () => {
    await ipc.gitRedo();
    await get().refreshStatus();
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
