import { useState } from 'react';
import {
  Plus,
  MessageSquare,
  Trash2,
  Code,
  FileText,
  Palette,
  TestTube,
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

interface SessionListProps {
  sessions: ChatSession[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
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
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function SessionList({
  sessions,
  currentId,
  onSelect,
  onCreate,
  onDelete,
}: SessionListProps) {
  const [contextMenuTarget, setContextMenuTarget] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <span className="text-sm font-semibold">Chats</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onCreate}
          title="New chat"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Session list */}
      <ScrollArea className="flex-1">
        <div className="px-2 py-1 space-y-0.5">
          {sessions.length === 0 && (
            <div className="px-2 py-8 text-center text-xs text-muted-foreground">
              No conversations yet
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
                      'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent/50',
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
                        {session.title || 'Untitled'}
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
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
