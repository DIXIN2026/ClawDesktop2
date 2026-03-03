import { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ipc } from '@/services/ipc';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScheduledTask {
  id: string;
  name: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_expr: string;
  agent_type: string;
  prompt: string;
  work_directory: string;
  enabled: boolean;
  last_run: string | null;
  next_run: string | null;
  created_at: string;
}

interface TaskRunLog {
  id: string;
  task_id: string;
  status: string;
  result_summary: string | null;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
}

type ScheduleType = 'cron' | 'interval' | 'once';

interface CreateFormState {
  name: string;
  scheduleType: ScheduleType;
  scheduleExpr: string;
  agentType: string;
  prompt: string;
  workDirectory: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapRowToTask(row: Record<string, unknown>): ScheduledTask {
  return {
    id: String(row['id'] ?? ''),
    name: String(row['name'] ?? ''),
    schedule_type: (row['schedule_type'] as ScheduleType) ?? 'cron',
    schedule_expr: String(row['schedule_expr'] ?? ''),
    agent_type: String(row['agent_type'] ?? ''),
    prompt: String(row['prompt'] ?? ''),
    work_directory: String(row['work_directory'] ?? ''),
    enabled: row['enabled'] === 1 || row['enabled'] === true,
    last_run: row['last_run'] ? String(row['last_run']) : null,
    next_run: row['next_run'] ? String(row['next_run']) : null,
    created_at: String(row['created_at'] ?? ''),
  };
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '--';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const absDiff = Math.abs(diffMs);

    if (absDiff < 60_000) return diffMs > 0 ? '即将执行' : '刚刚';
    if (absDiff < 3_600_000) {
      const mins = Math.round(absDiff / 60_000);
      return diffMs > 0 ? `${mins} 分钟后` : `${mins} 分钟前`;
    }
    if (absDiff < 86_400_000) {
      const hours = Math.round(absDiff / 3_600_000);
      return diffMs > 0 ? `${hours} 小时后` : `${hours} 小时前`;
    }
    const days = Math.round(absDiff / 86_400_000);
    return diffMs > 0 ? `${days} 天后` : `${days} 天前`;
  } catch {
    return dateStr;
  }
}

function scheduleTypeLabel(type: ScheduleType): string {
  switch (type) {
    case 'cron':
      return 'Cron';
    case 'interval':
      return '间隔';
    case 'once':
      return '一次性';
  }
}

const INITIAL_FORM: CreateFormState = {
  name: '',
  scheduleType: 'cron',
  scheduleExpr: '',
  agentType: 'coding',
  prompt: '',
  workDirectory: '',
};

const AGENT_TYPES = [
  { value: 'coding', label: '编码 Agent' },
  { value: 'requirements', label: '需求 Agent' },
  { value: 'design', label: '设计 Agent' },
  { value: 'testing', label: '测试 Agent' },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SchedulePage() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<CreateFormState>(INITIAL_FORM);
  const [creating, setCreating] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [taskLogs, setTaskLogs] = useState<Map<string, TaskRunLog[]>>(new Map());

  const loadTasks = useCallback(async () => {
    try {
      const rows = await ipc.listSchedules();
      setTasks((rows ?? []).map(mapRowToTask));
    } catch {
      // Backend may not be ready
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.scheduleExpr.trim()) return;
    setCreating(true);
    try {
      await ipc.createSchedule({
        name: form.name,
        scheduleType: form.scheduleType,
        scheduleExpr: form.scheduleExpr,
        agentType: form.agentType,
        prompt: form.prompt,
        workDirectory: form.workDirectory,
      });
      setForm(INITIAL_FORM);
      setDialogOpen(false);
      await loadTasks();
    } catch {
      // Creation failed
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await ipc.toggleSchedule(id, enabled);
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, enabled } : t)),
      );
    } catch {
      // Toggle failed
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await ipc.deleteSchedule(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch {
      // Delete failed
    }
  };

  const handleExpand = async (taskId: string) => {
    if (expandedTaskId === taskId) {
      setExpandedTaskId(null);
      return;
    }
    setExpandedTaskId(taskId);

    // Load logs if not cached
    if (!taskLogs.has(taskId)) {
      try {
        const logs = await ipc.scheduleLogs(taskId);
        const mapped: TaskRunLog[] = (logs ?? []).map((row) => ({
          id: String(row['id'] ?? ''),
          task_id: String(row['task_id'] ?? ''),
          status: String(row['status'] ?? ''),
          result_summary: row['result_summary'] ? String(row['result_summary']) : null,
          duration_ms: typeof row['duration_ms'] === 'number' ? row['duration_ms'] : null,
          started_at: row['started_at'] ? String(row['started_at']) : null,
          completed_at: row['completed_at'] ? String(row['completed_at']) : null,
        }));
        setTaskLogs((prev) => new Map(prev).set(taskId, mapped));
      } catch {
        setTaskLogs((prev) => new Map(prev).set(taskId, []));
      }
    }
  };

  const updateField = <K extends keyof CreateFormState>(key: K, value: CreateFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Clock className="h-6 w-6" />
            <h1 className="text-2xl font-bold">定时任务</h1>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                新建定时
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>创建定时任务</DialogTitle>
                <DialogDescription>
                  配置一个按计划自动执行的任务。
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                {/* Task Name */}
                <div className="grid gap-2">
                  <Label htmlFor="task-name">任务名称</Label>
                  <Input
                    id="task-name"
                    placeholder="例如：每日代码审查"
                    value={form.name}
                    onChange={(e) => updateField('name', e.target.value)}
                  />
                </div>

                {/* Schedule Type */}
                <div className="grid gap-2">
                  <Label>调度类型</Label>
                  <Select
                    value={form.scheduleType}
                    onValueChange={(v) => updateField('scheduleType', v as ScheduleType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cron">Cron 表达式</SelectItem>
                      <SelectItem value="interval">固定间隔 (毫秒)</SelectItem>
                      <SelectItem value="once">一次性</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Schedule Expression */}
                <div className="grid gap-2">
                  <Label htmlFor="schedule-expr">
                    {form.scheduleType === 'cron'
                      ? 'Cron 表达式'
                      : form.scheduleType === 'interval'
                        ? '间隔 (毫秒)'
                        : '执行时间 (ISO)'}
                  </Label>
                  <Input
                    id="schedule-expr"
                    placeholder={
                      form.scheduleType === 'cron'
                        ? '0 9 * * *'
                        : form.scheduleType === 'interval'
                          ? '3600000'
                          : '2026-03-01T09:00:00Z'
                    }
                    value={form.scheduleExpr}
                    onChange={(e) => updateField('scheduleExpr', e.target.value)}
                  />
                  {form.scheduleType === 'cron' && (
                    <p className="text-xs text-muted-foreground">
                      示例: &quot;0 9 * * *&quot; 表示每天 9:00 执行
                    </p>
                  )}
                </div>

                {/* Agent Type */}
                <div className="grid gap-2">
                  <Label>Agent 类型</Label>
                  <Select
                    value={form.agentType}
                    onValueChange={(v) => updateField('agentType', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AGENT_TYPES.map((at) => (
                        <SelectItem key={at.value} value={at.value}>
                          {at.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Prompt */}
                <div className="grid gap-2">
                  <Label htmlFor="task-prompt">提示词</Label>
                  <Textarea
                    id="task-prompt"
                    placeholder="描述要执行的任务..."
                    rows={3}
                    value={form.prompt}
                    onChange={(e) => updateField('prompt', e.target.value)}
                  />
                </div>

                {/* Work Directory */}
                <div className="grid gap-2">
                  <Label htmlFor="work-dir">工作目录 (可选)</Label>
                  <Input
                    id="work-dir"
                    placeholder="/path/to/project"
                    value={form.workDirectory}
                    onChange={(e) => updateField('workDirectory', e.target.value)}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  取消
                </Button>
                <Button onClick={() => void handleCreate()} disabled={creating || !form.name.trim() || !form.scheduleExpr.trim()}>
                  {creating ? '创建中...' : '创建'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <p className="text-muted-foreground mb-6">
          配置按计划运行的周期性任务，由智能体自动执行。
        </p>

        {/* Task List */}
        {tasks.length > 0 ? (
          <div className="space-y-3">
            {tasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                expanded={expandedTaskId === task.id}
                logs={taskLogs.get(task.id)}
                onToggle={(enabled) => void handleToggle(task.id, enabled)}
                onDelete={() => void handleDelete(task.id)}
                onExpand={() => void handleExpand(task.id)}
              />
            ))}
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-20">
            暂无定时任务。点击「新建定时」创建一个。
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task Item
// ---------------------------------------------------------------------------

interface TaskItemProps {
  task: ScheduledTask;
  expanded: boolean;
  logs?: TaskRunLog[];
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  onExpand: () => void;
}

function TaskItem({ task, expanded, logs, onToggle, onDelete, onExpand }: TaskItemProps) {
  return (
    <Card>
      <CardHeader className="p-4 pb-3">
        <div className="flex items-center gap-3">
          {/* Expand toggle */}
          <button
            type="button"
            className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
            onClick={onExpand}
            aria-label={expanded ? '收起日志' : '展开日志'}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>

          {/* Task info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium truncate">{task.name}</CardTitle>
              <Badge variant="outline" className="text-xs shrink-0">
                {scheduleTypeLabel(task.schedule_type)}
              </Badge>
              <Badge variant="secondary" className="text-xs shrink-0">
                {task.agent_type}
              </Badge>
            </div>
            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
              <span className="font-mono">{task.schedule_expr}</span>
              <span>
                下次: {formatRelativeTime(task.next_run)}
              </span>
              {task.last_run && (
                <span>
                  上次: {formatRelativeTime(task.last_run)}
                </span>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 shrink-0">
            <Switch
              checked={task.enabled}
              onCheckedChange={onToggle}
              aria-label={task.enabled ? '禁用' : '启用'}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={onDelete}
              aria-label="删除"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Expanded logs panel */}
      {expanded && (
        <CardContent className="pt-0 pb-4 px-4">
          <div className="border-t pt-3">
            {task.prompt && (
              <div className="mb-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">提示词</p>
                <p className="text-sm bg-muted rounded-md p-2">{task.prompt}</p>
              </div>
            )}

            <p className="text-xs font-medium text-muted-foreground mb-2">执行日志</p>
            {logs && logs.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-auto">
                {logs.map((log) => (
                  <LogEntry key={log.id} log={log} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无执行记录</p>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Log Entry
// ---------------------------------------------------------------------------

function LogEntry({ log }: { log: TaskRunLog }) {
  const statusIcon =
    log.status === 'success' ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
    ) : log.status === 'error' ? (
      <XCircle className="h-3.5 w-3.5 text-destructive" />
    ) : (
      <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />
    );

  const duration =
    typeof log.duration_ms === 'number'
      ? log.duration_ms < 1000
        ? `${log.duration_ms}ms`
        : `${(log.duration_ms / 1000).toFixed(1)}s`
      : '--';

  return (
    <div className="flex items-start gap-2 text-xs rounded-md bg-muted/50 p-2">
      <div className="mt-0.5">{statusIcon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{log.status}</span>
          <span className="text-muted-foreground">{duration}</span>
          {log.started_at && (
            <span className="text-muted-foreground">
              {new Date(log.started_at).toLocaleString()}
            </span>
          )}
        </div>
        {log.result_summary && (
          <p className="mt-0.5 text-muted-foreground line-clamp-2">{log.result_summary}</p>
        )}
      </div>
    </div>
  );
}
