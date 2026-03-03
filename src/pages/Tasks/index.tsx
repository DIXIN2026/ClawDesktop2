import { useEffect, useState, useCallback } from 'react';
import {
  Plus, LayoutGrid, List, Search, Filter, Bug, FileText, Bookmark,
  Circle, ArrowUp, ArrowDown, Minus, AlertTriangle, ChevronDown, X, GripVertical,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useBoardStore } from '../../stores/board';
import type { BoardIssue, BoardState, IssuePriority, IssueType, GroupBy } from '../../stores/board';
import { ipc } from '@/services/ipc';

// ── Priority helpers ──────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<IssuePriority, { label: string; icon: typeof ArrowUp; color: string }> = {
  urgent: { label: '紧急', icon: AlertTriangle, color: 'text-red-500' },
  high: { label: '高', icon: ArrowUp, color: 'text-orange-500' },
  medium: { label: '中', icon: Minus, color: 'text-yellow-500' },
  low: { label: '低', icon: ArrowDown, color: 'text-blue-500' },
  none: { label: '无', icon: Circle, color: 'text-gray-400' },
};

const ISSUE_TYPE_CONFIG: Record<IssueType, { label: string; icon: typeof FileText; color: string }> = {
  task: { label: '任务', icon: FileText, color: 'text-blue-500' },
  bug: { label: 'Bug', icon: Bug, color: 'text-red-500' },
  story: { label: '需求', icon: Bookmark, color: 'text-green-500' },
  epic: { label: 'Epic', icon: LayoutGrid, color: 'text-purple-500' },
};

// ── Issue Card ────────────────────────────────────────────────────────

function IssueCard({ issue, onSelect, onDragStart }: {
  issue: BoardIssue;
  onSelect: (id: string) => void;
  onDragStart: (e: React.DragEvent, issueId: string) => void;
}) {
  const pCfg = PRIORITY_CONFIG[issue.priority];
  const tCfg = ISSUE_TYPE_CONFIG[issue.issue_type];
  const PIcon = pCfg.icon;
  const TIcon = tCfg.icon;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, issue.id)}
      onClick={() => onSelect(issue.id)}
      className="group bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 cursor-pointer hover:border-blue-400 hover:shadow-sm transition-all"
    >
      <div className="flex items-start gap-2">
        <GripVertical className="w-4 h-4 text-zinc-300 opacity-0 group-hover:opacity-100 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <TIcon className={`w-3.5 h-3.5 ${tCfg.color} shrink-0`} />
            <span className="text-xs text-zinc-400 shrink-0">{issue.id.slice(0, 8)}</span>
          </div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{issue.title}</p>
          {issue.labels.length > 0 && (
            <div className="flex gap-1 mt-1.5 flex-wrap">
              {issue.labels.slice(0, 3).map((l) => (
                <span key={l} className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                  {l}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between mt-2">
            <PIcon className={`w-3.5 h-3.5 ${pCfg.color}`} />
            {issue.assignee && (
              <span className="text-xs text-zinc-500 truncate max-w-[80px]">{issue.assignee}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Issue Column ──────────────────────────────────────────────────────

function IssueColumn({ state, issues, onSelect, onDrop, onDragStart, onCreateInState }: {
  state: BoardState;
  issues: BoardIssue[];
  onSelect: (id: string) => void;
  onDrop: (e: React.DragEvent, stateId: string) => void;
  onDragStart: (e: React.DragEvent, issueId: string) => void;
  onCreateInState: (stateId: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`flex flex-col min-w-[280px] max-w-[320px] shrink-0 rounded-lg ${dragOver ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-zinc-50 dark:bg-zinc-900'}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { setDragOver(false); onDrop(e, state.id); }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: state.color }} />
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{state.name}</span>
          <span className="text-xs text-zinc-400 bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 rounded-full">
            {issues.length}
          </span>
        </div>
        <button
          onClick={() => onCreateInState(state.id)}
          className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {issues.map((issue) => (
          <IssueCard key={issue.id} issue={issue} onSelect={onSelect} onDragStart={onDragStart} />
        ))}
      </div>
    </div>
  );
}

// ── Issue Detail Panel ────────────────────────────────────────────────

function IssueDetailPanel({ issue, states, onClose, onUpdate, onDelete, onStart }: {
  issue: BoardIssue;
  states: BoardState[];
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<BoardIssue>) => void;
  onDelete: (id: string) => void;
  onStart: (issue: BoardIssue) => Promise<void>;
}) {
  const [title, setTitle] = useState(issue.title);
  const [desc, setDesc] = useState(issue.description ?? '');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    setTitle(issue.title);
    setDesc(issue.description ?? '');
  }, [issue.id, issue.title, issue.description]);

  return (
    <div className="w-[400px] border-l border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 overflow-y-auto">
      <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-700">
        <span className="text-xs text-zinc-400 font-mono">{issue.id.slice(0, 8)}</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700">
          <X className="w-4 h-4 text-zinc-500" />
        </button>
      </div>
      <div className="p-4 space-y-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => { if (title !== issue.title) onUpdate(issue.id, { title }); }}
          className="w-full text-lg font-semibold bg-transparent border-none outline-none text-zinc-900 dark:text-zinc-100"
        />
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => { if (desc !== (issue.description ?? '')) onUpdate(issue.id, { description: desc }); }}
          placeholder="描述..."
          rows={4}
          className="w-full text-sm bg-transparent border border-zinc-200 dark:border-zinc-700 rounded p-2 outline-none text-zinc-700 dark:text-zinc-300 resize-none"
        />
        <div className="space-y-3">
          <DetailRow label="状态">
            <select
              value={issue.state_id}
              onChange={(e) => onUpdate(issue.id, { state_id: e.target.value } as Partial<BoardIssue>)}
              className="text-sm bg-transparent border border-zinc-200 dark:border-zinc-600 rounded px-2 py-1"
            >
              {states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </DetailRow>
          <DetailRow label="优先级">
            <select
              value={issue.priority}
              onChange={(e) => onUpdate(issue.id, { priority: e.target.value as IssuePriority })}
              className="text-sm bg-transparent border border-zinc-200 dark:border-zinc-600 rounded px-2 py-1"
            >
              {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </DetailRow>
          <DetailRow label="类型">
            <select
              value={issue.issue_type}
              onChange={(e) => onUpdate(issue.id, { issue_type: e.target.value as IssueType })}
              className="text-sm bg-transparent border border-zinc-200 dark:border-zinc-600 rounded px-2 py-1"
            >
              {Object.entries(ISSUE_TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </DetailRow>
          <DetailRow label="负责人">
            <input
              value={issue.assignee ?? ''}
              onChange={(e) => onUpdate(issue.id, { assignee: e.target.value || null })}
              placeholder="未分配"
              className="text-sm bg-transparent border border-zinc-200 dark:border-zinc-600 rounded px-2 py-1 w-32"
            />
          </DetailRow>
        </div>
        <button
          onClick={() => {
            setStarting(true);
            onStart(issue).finally(() => setStarting(false));
          }}
          disabled={starting}
          className="mt-2 px-3 py-1.5 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {starting ? '启动中...' : '开始处理（建会话+分支）'}
        </button>
        <button
          onClick={() => onDelete(issue.id)}
          className="mt-6 text-sm text-red-500 hover:text-red-600"
        >
          删除此项
        </button>
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-zinc-500">{label}</span>
      {children}
    </div>
  );
}

// ── Create Issue Dialog ───────────────────────────────────────────────

function CreateIssueDialog({ stateId, states, onClose, onCreate }: {
  stateId: string;
  states: BoardState[];
  onClose: () => void;
  onCreate: (data: { title: string; stateId: string; priority: IssuePriority; issueType: IssueType; description?: string }) => void;
}) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [issueType, setIssueType] = useState<IssueType>('task');
  const [selectedState, setSelectedState] = useState(stateId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-zinc-800 rounded-xl shadow-xl w-[480px] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4 text-zinc-900 dark:text-zinc-100">创建任务</h3>
        <div className="space-y-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="任务标题"
            className="w-full border border-zinc-200 dark:border-zinc-600 rounded-lg px-3 py-2 bg-transparent text-sm"
          />
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="描述（可选）"
            rows={3}
            className="w-full border border-zinc-200 dark:border-zinc-600 rounded-lg px-3 py-2 bg-transparent text-sm resize-none"
          />
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">状态</label>
              <select value={selectedState} onChange={(e) => setSelectedState(e.target.value)}
                className="w-full text-sm border border-zinc-200 dark:border-zinc-600 rounded px-2 py-1.5 bg-transparent">
                {states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">优先级</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as IssuePriority)}
                className="w-full text-sm border border-zinc-200 dark:border-zinc-600 rounded px-2 py-1.5 bg-transparent">
                {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">类型</label>
              <select value={issueType} onChange={(e) => setIssueType(e.target.value as IssueType)}
                className="w-full text-sm border border-zinc-200 dark:border-zinc-600 rounded px-2 py-1.5 bg-transparent">
                {Object.entries(ISSUE_TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700">
            取消
          </button>
          <button
            disabled={!title.trim()}
            onClick={() => {
              if (title.trim()) {
                onCreate({ title: title.trim(), stateId: selectedState, priority, issueType, description: desc || undefined });
              }
            }}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Filter Bar ────────────────────────────────────────────────────────

function FilterBar({ groupBy, viewMode, filters, onGroupChange, onViewChange, onFilterChange, onSearch }: {
  groupBy: GroupBy;
  viewMode: 'board' | 'list';
  filters: { priority?: IssuePriority; issueType?: IssueType };
  onGroupChange: (g: GroupBy) => void;
  onViewChange: (m: 'board' | 'list') => void;
  onFilterChange: (f: { priority?: IssuePriority; issueType?: IssueType }) => void;
  onSearch: (q: string) => void;
}) {
  const [showFilters, setShowFilters] = useState(false);

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
      <div className="relative flex-1 max-w-xs">
        <Search className="w-4 h-4 absolute left-2.5 top-2 text-zinc-400" />
        <input
          onChange={(e) => onSearch(e.target.value)}
          placeholder="搜索任务..."
          className="w-full pl-8 pr-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-600 rounded-lg bg-transparent"
        />
      </div>
      <div className="flex items-center gap-1 border border-zinc-200 dark:border-zinc-600 rounded-lg p-0.5">
        <button
          onClick={() => onViewChange('board')}
          className={`p-1.5 rounded ${viewMode === 'board' ? 'bg-zinc-200 dark:bg-zinc-600' : ''}`}
        >
          <LayoutGrid className="w-4 h-4" />
        </button>
        <button
          onClick={() => onViewChange('list')}
          className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-zinc-200 dark:bg-zinc-600' : ''}`}
        >
          <List className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-zinc-500">分组:</span>
        <select
          value={groupBy}
          onChange={(e) => onGroupChange(e.target.value as GroupBy)}
          className="text-xs border border-zinc-200 dark:border-zinc-600 rounded px-2 py-1 bg-transparent"
        >
          <option value="state">状态</option>
          <option value="priority">优先级</option>
          <option value="assignee">负责人</option>
          <option value="type">类型</option>
        </select>
      </div>
      <button
        onClick={() => setShowFilters(!showFilters)}
        className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border ${showFilters || filters.priority || filters.issueType ? 'border-blue-400 text-blue-600' : 'border-zinc-200 dark:border-zinc-600 text-zinc-500'}`}
      >
        <Filter className="w-3.5 h-3.5" />
        筛选
        <ChevronDown className="w-3 h-3" />
      </button>
      {showFilters && (
        <div className="flex items-center gap-2">
          <select
            value={filters.priority ?? ''}
            onChange={(e) => onFilterChange({ ...filters, priority: e.target.value as IssuePriority || undefined })}
            className="text-xs border border-zinc-200 dark:border-zinc-600 rounded px-2 py-1 bg-transparent"
          >
            <option value="">全部优先级</option>
            {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select
            value={filters.issueType ?? ''}
            onChange={(e) => onFilterChange({ ...filters, issueType: e.target.value as IssueType || undefined })}
            className="text-xs border border-zinc-200 dark:border-zinc-600 rounded px-2 py-1 bg-transparent"
          >
            <option value="">全部类型</option>
            {Object.entries(ISSUE_TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

// ── List View ─────────────────────────────────────────────────────────

function ListView({ issues, states, onSelect }: {
  issues: BoardIssue[];
  states: BoardState[];
  onSelect: (id: string) => void;
}) {
  const stateMap = new Map(states.map((s) => [s.id, s]));

  return (
    <div className="flex-1 overflow-y-auto">
      <table className="w-full">
        <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
          <tr className="text-xs text-zinc-500 border-b border-zinc-200 dark:border-zinc-700">
            <th className="text-left py-2 px-4 font-medium">标题</th>
            <th className="text-left py-2 px-4 font-medium w-24">状态</th>
            <th className="text-left py-2 px-4 font-medium w-20">优先级</th>
            <th className="text-left py-2 px-4 font-medium w-20">类型</th>
            <th className="text-left py-2 px-4 font-medium w-24">负责人</th>
            <th className="text-left py-2 px-4 font-medium w-28">更新时间</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => {
            const state = stateMap.get(issue.state_id);
            const pCfg = PRIORITY_CONFIG[issue.priority];
            const tCfg = ISSUE_TYPE_CONFIG[issue.issue_type];
            const PIcon = pCfg.icon;
            const TIcon = tCfg.icon;
            return (
              <tr
                key={issue.id}
                onClick={() => onSelect(issue.id)}
                className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
              >
                <td className="py-2.5 px-4">
                  <div className="flex items-center gap-2">
                    <TIcon className={`w-4 h-4 ${tCfg.color} shrink-0`} />
                    <span className="text-sm text-zinc-900 dark:text-zinc-100 truncate">{issue.title}</span>
                  </div>
                </td>
                <td className="py-2.5 px-4">
                  <span
                    className="text-xs px-2 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: state?.color ?? '#6b7280' }}
                  >
                    {state?.name ?? '未知'}
                  </span>
                </td>
                <td className="py-2.5 px-4">
                  <div className="flex items-center gap-1">
                    <PIcon className={`w-3.5 h-3.5 ${pCfg.color}`} />
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">{pCfg.label}</span>
                  </div>
                </td>
                <td className="py-2.5 px-4 text-xs text-zinc-600 dark:text-zinc-400">{tCfg.label}</td>
                <td className="py-2.5 px-4 text-xs text-zinc-500 truncate">{issue.assignee ?? '-'}</td>
                <td className="py-2.5 px-4 text-xs text-zinc-400">{new Date(issue.updated_at).toLocaleDateString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Tasks Page ───────────────────────────────────────────────────

export default function TasksPage() {
  const store = useBoardStore();
  const navigate = useNavigate();
  const [createDialogState, setCreateDialogState] = useState<string | null>(null);
  const [dragIssueId, setDragIssueId] = useState<string | null>(null);

  useEffect(() => {
    store.loadBoard();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredIssues = store.getFilteredIssues();
  const selectedIssue = store.selectedIssueId
    ? filteredIssues.find((i) => i.id === store.selectedIssueId) ?? null
    : null;

  const handleDragStart = useCallback((e: React.DragEvent, issueId: string) => {
    setDragIssueId(issueId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetStateId: string) => {
    e.preventDefault();
    if (dragIssueId) {
      store.moveIssue(dragIssueId, targetStateId, Date.now());
      setDragIssueId(null);
    }
  }, [dragIssueId, store]);

  const handleCreate = useCallback(async (data: {
    title: string; stateId: string; priority: IssuePriority; issueType: IssueType; description?: string;
  }) => {
    await store.createIssue(data);
    setCreateDialogState(null);
  }, [store]);

  const handleStartIssue = useCallback(async (issue: BoardIssue) => {
    try {
      const result = await ipc.boardIssueStart(issue.id, issue.title, issue.issue_type === 'story' ? 'requirements' : 'coding');
      toast.success(`已创建会话 ${result.sessionId.slice(0, 8)}，分支 ${result.branch}`);
      navigate('/');
    } catch (err) {
      toast.error(`启动失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [navigate]);

  // Group issues by state for board view
  const issuesByState = new Map<string, BoardIssue[]>();
  for (const state of store.states) {
    issuesByState.set(state.id, []);
  }
  for (const issue of filteredIssues) {
    const group = issuesByState.get(issue.state_id);
    if (group) group.push(issue);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">任务看板</h1>
        <button
          onClick={() => setCreateDialogState(store.states[1]?.id ?? store.states[0]?.id ?? '')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          新建
        </button>
      </div>

      <FilterBar
        groupBy={store.groupBy}
        viewMode={store.viewMode}
        filters={store.filters}
        onGroupChange={store.setGroupBy}
        onViewChange={store.setViewMode}
        onFilterChange={store.setFilters}
        onSearch={(q) => store.setFilters({ ...store.filters, search: q || undefined })}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto">
          {store.viewMode === 'board' ? (
            <div className="flex gap-3 p-4 h-full">
              {store.states.map((state) => (
                <IssueColumn
                  key={state.id}
                  state={state}
                  issues={issuesByState.get(state.id) ?? []}
                  onSelect={store.selectIssue}
                  onDrop={handleDrop}
                  onDragStart={handleDragStart}
                  onCreateInState={(stateId) => setCreateDialogState(stateId)}
                />
              ))}
            </div>
          ) : (
            <ListView issues={filteredIssues} states={store.states} onSelect={store.selectIssue} />
          )}
        </div>

        {selectedIssue && (
          <IssueDetailPanel
            issue={selectedIssue}
            states={store.states}
            onClose={() => store.selectIssue(null)}
            onUpdate={(id, updates) => store.updateIssue(id, updates)}
            onDelete={(id) => { store.deleteIssue(id); }}
            onStart={handleStartIssue}
          />
        )}
      </div>

      {createDialogState !== null && (
        <CreateIssueDialog
          stateId={createDialogState}
          states={store.states}
          onClose={() => setCreateDialogState(null)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
