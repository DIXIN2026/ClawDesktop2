import { useState } from 'react';
import {
  Plus,
  MessageSquare,
  Trash2,
  Code,
  FileText,
  Palette,
  TestTube,
  GitBranch,
  FolderTree,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { ChatSession } from '@/stores/chat';
import type { GitWorktree } from '@/stores/git';

interface SessionListProps {
  sessions: ChatSession[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  worktrees?: GitWorktree[];
  currentWorktreePath?: string | null;
  onWorktreeRefresh?: () => void;
  onWorktreeCreate?: (branch: string, path: string) => void;
  onWorktreeDelete?: (path: string) => void;
  onWorktreeStartChat?: (worktree: GitWorktree) => void;
  defaultWorktreeBase?: string | null;
}

const AGENT_ICONS: Record<string, React.ReactNode> = {
  coding: <Code className="h-3.5 w-3.5" />,
  requirements: <FileText className="h-3.5 w-3.5" />,
  design: <Palette className="h-3.5 w-3.5" />,
  testing: <TestTube className="h-3.5 w-3.5" />,
};

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} 天前`;
  return date.toLocaleDateString();
}

export function SessionList({
  sessions,
  currentId,
  onSelect,
  onCreate,
  onDelete,
  worktrees = [],
  currentWorktreePath,
  onWorktreeRefresh,
  onWorktreeCreate,
  onWorktreeDelete,
  onWorktreeStartChat,
  defaultWorktreeBase,
}: SessionListProps) {
  const [contextMenuTarget, setContextMenuTarget] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col bg-card/70">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 shrink-0">
        <span className="text-sm font-semibold">会话</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg"
          onClick={onCreate}
          title="新建会话"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Session list */}
      <ScrollArea className="flex-1">
        <div className="space-y-3 px-2 pb-2">
          {sessions.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/70 px-2 py-8 text-center text-xs text-muted-foreground">
              暂无会话
            </div>
          )}

          {sessions.map((session) => {
            const isActive = session.id === currentId;
            const agentIcon =
              AGENT_ICONS[session.agentId ?? ''] ??
              <MessageSquare className="h-3.5 w-3.5" />;

            return (
              <DropdownMenu
                key={session.id}
                open={contextMenuTarget === session.id}
                onOpenChange={(open) => {
                  if (!open) setContextMenuTarget(null);
                }}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-xl border px-2.5 py-2 text-left text-sm transition-colors',
                      isActive
                        ? 'border-primary/30 bg-accent/80 text-accent-foreground'
                        : 'border-transparent hover:border-border/70 hover:bg-accent/40',
                    )}
                    onClick={() => onSelect(session.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenuTarget(session.id);
                    }}
                  >
                    <div className="mt-0.5 shrink-0 text-muted-foreground">
                      {agentIcon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-xs">
                        {session.title || '未命名会话'}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {formatRelativeTime(session.updatedAt)}
                      </div>
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => {
                      onDelete(session.id);
                      setContextMenuTarget(null);
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })}

          <div className="rounded-xl border border-border/70 bg-background/60 p-1.5">
            <div className="flex items-center justify-between px-1.5 pb-1.5">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <FolderTree className="h-3.5 w-3.5" />
                工作树
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-lg"
                  title="刷新工作树"
                  onClick={onWorktreeRefresh}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-lg"
                  title="创建工作树"
                  onClick={() => {
                    if (!onWorktreeCreate) return;
                    const branch = window.prompt('请输入新工作树的分支名');
                    if (!branch) return;
                    const safeBranch = branch.trim();
                    if (!safeBranch) return;
                    const baseDir = defaultWorktreeBase?.trim() || '.';
                    const defaultPath = `${baseDir}/.claw-worktrees/${safeBranch.replace(/[^\w.-]/g, '-')}`;
                    const path = window.prompt('工作树路径', defaultPath);
                    if (!path) return;
                    onWorktreeCreate(safeBranch, path.trim());
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="space-y-0.5">
              {worktrees.length === 0 && (
                <div className="px-2 py-2 text-[11px] text-muted-foreground">
                  暂无工作树
                </div>
              )}
              {worktrees.map((worktree) => {
                const isActive = currentWorktreePath === worktree.path;
                return (
                  <div
                    key={`${worktree.path}-${worktree.branch}`}
                    className={cn(
                      'group flex items-center gap-1.5 rounded-lg border px-2 py-1.5',
                      isActive
                        ? 'border-primary/30 bg-accent/80'
                        : 'border-transparent hover:border-border/60 hover:bg-accent/40',
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onWorktreeStartChat?.(worktree)}
                      title={worktree.path}
                    >
                      <div className="flex items-center gap-1.5 text-xs">
                        <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate font-medium">
                          {worktree.branch || '(分离头指针)'}
                        </span>
                        {worktree.isMain && (
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            主工作树
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate pl-5">
                        {worktree.path}
                      </div>
                    </button>
                    {!worktree.isMain && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100"
                        title="删除工作树"
                        onClick={() => onWorktreeDelete?.(worktree.path)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
