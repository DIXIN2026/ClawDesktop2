import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { ToolCallInfo } from '@/stores/chat';

interface ToolCallDisplayProps {
  toolCall: ToolCallInfo;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ToolCallDisplay({ toolCall }: ToolCallDisplayProps) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    running: <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />,
    completed: <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />,
    error: <XCircle className="h-3.5 w-3.5 text-red-400" />,
  }[toolCall.status];

  const statusBadgeVariant = {
    running: 'default' as const,
    completed: 'secondary' as const,
    error: 'destructive' as const,
  }[toolCall.status];

  return (
    <div className="my-1.5 rounded-md border border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/50 transition-colors',
          expanded && 'border-b border-border',
        )}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        {statusIcon}
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono font-medium truncate">{toolCall.name}</span>
        <div className="ml-auto flex items-center gap-2">
          {toolCall.durationMs != null && (
            <span className="text-muted-foreground">
              {formatDuration(toolCall.durationMs)}
            </span>
          )}
          <Badge variant={statusBadgeVariant} className="text-[10px] px-1.5 py-0">
            {toolCall.status}
          </Badge>
        </div>
      </button>

      {expanded && (
        <div className="px-3 py-2 space-y-2 text-xs">
          {toolCall.input && Object.keys(toolCall.input).length > 0 && (
            <div>
              <div className="font-semibold text-muted-foreground mb-1">Input</div>
              <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
                {JSON.stringify(toolCall.input, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.output != null && (
            <div>
              <div className="font-semibold text-muted-foreground mb-1">Output</div>
              <pre
                className={cn(
                  'overflow-x-auto rounded p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all',
                  toolCall.status === 'error'
                    ? 'bg-red-950/30 text-red-300'
                    : 'bg-muted',
                )}
              >
                {toolCall.output}
              </pre>
            </div>
          )}
          {!toolCall.input && !toolCall.output && (
            <div className="text-muted-foreground italic">No details available</div>
          )}
        </div>
      )}
    </div>
  );
}
