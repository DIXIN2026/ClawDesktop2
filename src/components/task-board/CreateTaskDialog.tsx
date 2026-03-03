import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus } from 'lucide-react';
import type { AgentType } from '@/stores/agents';
import type { TaskPriority } from './TaskCard';

// ── Types ──────────────────────────────────────────────────────────

interface CreateTaskFormData {
  title: string;
  description: string;
  priority: TaskPriority;
  agentType: AgentType;
}

interface CreateTaskDialogProps {
  onSubmit: (data: CreateTaskFormData) => void;
}

// ── Component ──────────────────────────────────────────────────────

export function CreateTaskDialog({ onSubmit }: CreateTaskDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [agentType, setAgentType] = useState<AgentType>('coding');

  function handleSubmit() {
    if (!title.trim()) return;
    onSubmit({ title: title.trim(), description: description.trim(), priority, agentType });
    resetForm();
    setOpen(false);
  }

  function resetForm() {
    setTitle('');
    setDescription('');
    setPriority('medium');
    setAgentType('coding');
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" />
          新建任务
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建新任务</DialogTitle>
          <DialogDescription>填写任务信息，创建后将出现在「新建」列中。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="task-title">标题</Label>
            <Input
              id="task-title"
              placeholder="输入任务标题..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="task-desc">描述</Label>
            <Textarea
              id="task-desc"
              placeholder="描述任务需求..."
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Priority */}
          <div className="space-y-2">
            <Label>优先级</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">低</SelectItem>
                <SelectItem value="medium">中</SelectItem>
                <SelectItem value="high">高</SelectItem>
                <SelectItem value="urgent">紧急</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Agent Type */}
          <div className="space-y-2">
            <Label>智能体类型</Label>
            <Select value={agentType} onValueChange={(v) => setAgentType(v as AgentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="coding">编码智能体</SelectItem>
                <SelectItem value="requirements">需求智能体</SelectItem>
                <SelectItem value="design">设计智能体</SelectItem>
                <SelectItem value="testing">测试智能体</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={!title.trim()}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
