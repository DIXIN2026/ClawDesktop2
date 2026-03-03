import { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface DiffViewerProps {
  diff: string;
  filePath: string;
}

interface DiffLine {
  type: 'added' | 'removed' | 'context' | 'header';
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

function parseDiff(raw: string): DiffLine[] {
  const lines = raw.split('\n');
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    // Diff header lines
    if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ')
    ) {
      result.push({ type: 'header', content: line, oldLineNo: null, newLineNo: null });
      continue;
    }

    // Hunk header
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ type: 'header', content: line, oldLineNo: null, newLineNo: null });
      continue;
    }

    if (line.startsWith('+')) {
      result.push({ type: 'added', content: line.slice(1), oldLineNo: null, newLineNo: newLine });
      newLine++;
    } else if (line.startsWith('-')) {
      result.push({ type: 'removed', content: line.slice(1), oldLineNo: oldLine, newLineNo: null });
      oldLine++;
    } else if (line.startsWith(' ')) {
      result.push({ type: 'context', content: line.slice(1), oldLineNo: oldLine, newLineNo: newLine });
      oldLine++;
      newLine++;
    } else if (line === '') {
      // empty line at end of diff, skip
    } else {
      // No-newline-at-end marker or other
      result.push({ type: 'context', content: line, oldLineNo: null, newLineNo: null });
    }
  }

  return result;
}

export function DiffViewer({ diff, filePath }: DiffViewerProps) {
  const parsedLines = useMemo(() => parseDiff(diff), [diff]);

  if (!diff.trim()) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No diff available
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* File path header */}
      <div className="px-3 py-1.5 bg-muted/50 border-b border-border text-xs font-mono text-muted-foreground truncate shrink-0">
        {filePath}
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs font-mono border-collapse">
          <tbody>
            {parsedLines.map((line, idx) => {
              if (line.type === 'header') {
                return (
                  <tr key={idx} className="bg-blue-500/10">
                    <td
                      colSpan={3}
                      className="px-3 py-1 text-blue-400 select-text"
                    >
                      {line.content}
                    </td>
                  </tr>
                );
              }

              return (
                <tr
                  key={idx}
                  className={cn(
                    'leading-5',
                    line.type === 'added' && 'bg-green-500/10',
                    line.type === 'removed' && 'bg-red-500/10',
                  )}
                >
                  {/* Old line number */}
                  <td className="w-10 text-right px-1.5 text-muted-foreground select-none border-r border-border/50 shrink-0">
                    {line.oldLineNo ?? ''}
                  </td>
                  {/* New line number */}
                  <td className="w-10 text-right px-1.5 text-muted-foreground select-none border-r border-border/50 shrink-0">
                    {line.newLineNo ?? ''}
                  </td>
                  {/* Content */}
                  <td className="px-2 select-text whitespace-pre-wrap break-all">
                    <span
                      className={cn(
                        line.type === 'added' && 'text-green-400',
                        line.type === 'removed' && 'text-red-400',
                      )}
                    >
                      {line.type === 'added' && '+ '}
                      {line.type === 'removed' && '- '}
                      {line.type === 'context' && '  '}
                      {line.content}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
