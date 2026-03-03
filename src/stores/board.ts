import { create } from 'zustand';
import { ipc } from '../services/ipc';

// ── Types ──────────────────────────────────────────────────────────

export interface BoardState {
  id: string;
  name: string;
  color: string;
  category: string;
  sort_order: number | null;
  allow_new_items: number;
}

export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type IssueType = 'task' | 'bug' | 'story' | 'epic';
export type GroupBy = 'state' | 'priority' | 'assignee' | 'type';

export interface BoardIssue {
  id: string;
  title: string;
  description: string | null;
  state_id: string;
  priority: IssuePriority;
  assignee: string | null;
  labels: string[];
  parent_id: string | null;
  estimate_points: number | null;
  start_date: string | null;
  target_date: string | null;
  issue_type: IssueType;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface IssueFilters {
  priority?: IssuePriority;
  issueType?: IssueType;
  assignee?: string;
  search?: string;
}

interface TaskBoardStore {
  states: BoardState[];
  issues: BoardIssue[];
  groupBy: GroupBy;
  subGroupBy: GroupBy | null;
  filters: IssueFilters;
  viewMode: 'board' | 'list';
  selectedIssueId: string | null;
  loading: boolean;

  // Actions
  loadBoard: () => Promise<void>;
  setGroupBy: (group: GroupBy) => void;
  setSubGroupBy: (group: GroupBy | null) => void;
  setFilters: (filters: IssueFilters) => void;
  setViewMode: (mode: 'board' | 'list') => void;
  selectIssue: (id: string | null) => void;
  createIssue: (data: {
    title: string;
    description?: string;
    stateId: string;
    priority?: IssuePriority;
    assignee?: string;
    labels?: string[];
    parentId?: string;
    issueType?: IssueType;
  }) => Promise<string>;
  updateIssue: (id: string, updates: Partial<BoardIssue>) => Promise<void>;
  moveIssue: (issueId: string, targetStateId: string, sortOrder: number) => Promise<void>;
  deleteIssue: (issueId: string) => Promise<void>;
  getFilteredIssues: () => BoardIssue[];
}

// ── Helpers ─────────────────────────────────────────────────────────

function parseLabels(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

function normalizeIssue(raw: Record<string, unknown>): BoardIssue {
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    description: raw.description as string | null,
    state_id: String(raw.state_id ?? ''),
    priority: (raw.priority ?? 'medium') as IssuePriority,
    assignee: raw.assignee as string | null,
    labels: parseLabels(raw.labels as string | null),
    parent_id: raw.parent_id as string | null,
    estimate_points: raw.estimate_points as number | null,
    start_date: raw.start_date as string | null,
    target_date: raw.target_date as string | null,
    issue_type: (raw.issue_type ?? 'task') as IssueType,
    sort_order: (raw.sort_order as number) ?? 0,
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? ''),
  };
}

// ── Store ───────────────────────────────────────────────────────────

export const useBoardStore = create<TaskBoardStore>((set, get) => ({
  states: [],
  issues: [],
  groupBy: 'state',
  subGroupBy: null,
  filters: {},
  viewMode: 'board',
  selectedIssueId: null,
  loading: false,

  loadBoard: async () => {
    set({ loading: true });
    try {
      const [states, rawIssues] = await Promise.all([
        ipc.boardStates(),
        ipc.boardIssuesList(),
      ]);
      const issues = (rawIssues as unknown as Record<string, unknown>[]).map(normalizeIssue);
      set({ states: states as BoardState[], issues, loading: false });
    } catch (err) {
      console.error('Failed to load board:', err);
      set({ loading: false });
    }
  },

  setGroupBy: (group) => set({ groupBy: group }),
  setSubGroupBy: (group) => set({ subGroupBy: group }),
  setFilters: (filters) => set({ filters }),
  setViewMode: (mode) => set({ viewMode: mode }),
  selectIssue: (id) => set({ selectedIssueId: id }),

  createIssue: async (data) => {
    const result = await ipc.boardIssueCreate({
      title: data.title,
      description: data.description,
      stateId: data.stateId,
      priority: data.priority,
      assignee: data.assignee,
      labels: data.labels,
      parentId: data.parentId,
      issueType: data.issueType,
    });
    const id = result.id;
    // Reload board to get fresh data
    await get().loadBoard();
    return id;
  },

  updateIssue: async (id, updates) => {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.title !== undefined) dbUpdates.title = updates.title;
    if (updates.description !== undefined) dbUpdates.description = updates.description;
    if (updates.priority !== undefined) dbUpdates.priority = updates.priority;
    if (updates.assignee !== undefined) dbUpdates.assignee = updates.assignee;
    if (updates.labels !== undefined) dbUpdates.labels = JSON.stringify(updates.labels);
    if (updates.issue_type !== undefined) dbUpdates.issue_type = updates.issue_type;
    if (updates.estimate_points !== undefined) dbUpdates.estimate_points = updates.estimate_points;
    if (updates.start_date !== undefined) dbUpdates.start_date = updates.start_date;
    if (updates.target_date !== undefined) dbUpdates.target_date = updates.target_date;

    await ipc.boardIssueUpdate(id, dbUpdates);

    // Optimistic update
    set((state) => ({
      issues: state.issues.map((i) => (i.id === id ? { ...i, ...updates } : i)),
    }));
  },

  moveIssue: async (issueId, targetStateId, sortOrder) => {
    await ipc.boardIssueMove(issueId, targetStateId, sortOrder);

    // Optimistic update
    set((state) => ({
      issues: state.issues.map((i) =>
        i.id === issueId ? { ...i, state_id: targetStateId, sort_order: sortOrder } : i,
      ),
    }));
  },

  deleteIssue: async (issueId) => {
    await ipc.boardIssueDelete(issueId);
    set((state) => ({
      issues: state.issues.filter((i) => i.id !== issueId),
      selectedIssueId: state.selectedIssueId === issueId ? null : state.selectedIssueId,
    }));
  },

  getFilteredIssues: () => {
    const { issues, filters } = get();
    return issues.filter((issue) => {
      if (filters.priority && issue.priority !== filters.priority) return false;
      if (filters.issueType && issue.issue_type !== filters.issueType) return false;
      if (filters.assignee && issue.assignee !== filters.assignee) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!issue.title.toLowerCase().includes(q) && !issue.description?.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  },
}));
