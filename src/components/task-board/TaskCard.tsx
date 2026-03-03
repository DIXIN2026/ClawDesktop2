import { ChevronRight, GitBranch, Play } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AgentType } from '@/stores/agents';

// ── Types ──────────────────────────────────────────────────────────

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type TaskStatus = 'new' | 'todo' | 'in_progress' | 'review' | 'done';

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  agentType: AgentType;
  status: TaskStatus;
  branch?: string;
  createdAt: number;
}

interface TaskCardProps {
  task: TaskItem;
  onMoveForward?: (task: TaskItem) => void;
  onMoveBackward?: (task: TaskItem) => void;
  onStart?: (task: TaskItem) => void;
}

// ── Priority config ────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; className: string }> = {
  low: { label: '低', className: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
  medium: { label: '中', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  high: { label: '高', className: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  urgent: { label: '紧急', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

const AGENT_LABELS: Record<AgentType, string> = {
  coding: '编码',
  requirements: '需求',
  design: '设计',
  testing: '测试',
};

const STATUS_ORDER: TaskStatus[] = ['new', 'todo', 'in_progress', 'review', 'done'];

// ── Component ──────────────────────────────────────────────────────

export function TaskCard({ task, onMoveForward, onMoveBackward, onStart }: TaskCardProps) {
  const priorityInfo = PRIORITY_CONFIG[task.priority];
  const statusIndex = STATUS_ORDER.indexOf(task.status);
  const canMoveForward = statusIndex < STATUS_ORDER.length - 1;
  const canMoveBackward = statusIndex > 0;

  return (
    <Card className="mb-2 hover:border-primary/40 transition-colors">
      <CardHeader className="p-3 pb-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium leading-tight">{task.title}</span>
        </div>
        {task.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{task.description}</p>
        )}
      </CardHeader>
      <CardContent className="p-3 pt-1">
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          <Badge variant="outline" className={priorityInfo.className}>
            {priorityInfo.label}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {AGENT_LABELS[task.agentType]}
          </Badge>
        </div>

        {task.branch && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
            <GitBranch className="h-3 w-3" />
            <span className="truncate">{task.branch}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1">
            {canMoveBackward && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => onMoveBackward?.(task)}
                title="移回上一列"
              >
                <ChevronRight className="h-3.5 w-3.5 rotate-180" />
              </Button>
            )}
            {canMoveForward && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => onMoveForward?.(task)}
                title="移至下一列"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {task.status === 'todo' && onStart && (
            <Button
              variant="default"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => onStart(task)}
            >
              <Play className="h-3 w-3 mr-1" />
              开始处理
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
