import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { TaskCard } from './TaskCard';
import type { TaskItem, TaskStatus } from './TaskCard';

// ── Types ──────────────────────────────────────────────────────────

interface TaskColumnProps {
  status: TaskStatus;
  title: string;
  tasks: TaskItem[];
  onMoveForward?: (task: TaskItem) => void;
  onMoveBackward?: (task: TaskItem) => void;
  onStart?: (task: TaskItem) => void;
}

// ── Status color mapping ───────────────────────────────────────────

const STATUS_COLORS: Record<TaskStatus, string> = {
  new: 'bg-gray-500',
  todo: 'bg-blue-500',
  in_progress: 'bg-yellow-500',
  review: 'bg-purple-500',
  done: 'bg-green-500',
};

// ── Component ──────────────────────────────────────────────────────

export function TaskColumn({
  status,
  title,
  tasks,
  onMoveForward,
  onMoveBackward,
  onStart,
}: TaskColumnProps) {
  return (
    <div className="flex flex-col min-w-[260px] max-w-[300px] flex-1 bg-muted/30 rounded-lg border border-border">
      {/* Column header */}
      <div className="flex items-center gap-2 p-3 border-b border-border">
        <div className={`h-2.5 w-2.5 rounded-full ${STATUS_COLORS[status]}`} />
        <span className="text-sm font-medium">{title}</span>
        <Badge variant="secondary" className="ml-auto text-xs h-5 min-w-5 justify-center">
          {tasks.length}
        </Badge>
      </div>

      {/* Task list */}
      <ScrollArea className="flex-1 max-h-[calc(100vh-260px)]">
        <div className="p-2">
          {tasks.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              暂无任务
            </div>
          ) : (
            tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onMoveForward={onMoveForward}
                onMoveBackward={onMoveBackward}
                onStart={onStart}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
