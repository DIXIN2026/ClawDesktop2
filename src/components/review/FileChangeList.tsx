import {
  FileEdit,
  FilePlus,
  FileMinus,
  FileQuestion,
  FileSymlink,
  Plus,
  Minus,
  Undo2,
  CheckSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { FileChange } from '@/stores/git';

interface FileChangeListProps {
  files: FileChange[];
  selectedFile: string | null;
  onSelect: (path: string) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onRevert: (paths: string[]) => void;
}

const STATUS_CONFIG: Record<
  FileChange['status'],
  { icon: typeof FileEdit; label: string; className: string }
> = {
  modified: { icon: FileEdit, label: 'M', className: 'text-yellow-400' },
  added: { icon: FilePlus, label: 'A', className: 'text-green-400' },
  deleted: { icon: FileMinus, label: 'D', className: 'text-red-400' },
  untracked: { icon: FileQuestion, label: 'U', className: 'text-muted-foreground' },
  renamed: { icon: FileSymlink, label: 'R', className: 'text-blue-400' },
};

function FileRow({
  file,
  isSelected,
  onSelect,
  actionButton,
}: {
  file: FileChange;
  isSelected: boolean;
  onSelect: () => void;
  actionButton: React.ReactNode;
}) {
  const config = STATUS_CONFIG[file.status];
  const StatusIcon = config.icon;
  const fileName = file.path.split('/').pop() ?? file.path;
  const dirPath = file.path.includes('/')
    ? file.path.slice(0, file.path.lastIndexOf('/'))
    : '';

  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 px-2 py-1 cursor-pointer text-xs rounded-sm transition-colors',
        isSelected
          ? 'bg-accent text-accent-foreground'
          : 'hover:bg-accent/50',
      )}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect();
      }}
    >
      <StatusIcon className={cn('h-3.5 w-3.5 shrink-0', config.className)} />
      <span className="truncate flex-1">
        <span className="font-medium">{fileName}</span>
        {dirPath && (
          <span className="text-muted-foreground ml-1">{dirPath}/</span>
        )}
      </span>
      <span className={cn('text-[10px] font-mono shrink-0', config.className)}>
        {config.label}
      </span>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {actionButton}
      </div>
    </div>
  );
}

export function FileChangeList({
  files,
  selectedFile,
  onSelect,
  onStage,
  onUnstage,
  onRevert,
}: FileChangeListProps) {
  const stagedFiles = files.filter((f) => f.staged);
  const unstagedFiles = files.filter((f) => !f.staged);

  return (
    <TooltipProvider delayDuration={300}>
      <ScrollArea className="flex-1">
        <div className="space-y-2 py-1">
          {/* Staged changes */}
          {stagedFiles.length > 0 && (
            <div>
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
                  Staged ({stagedFiles.length})
                </span>
                <div className="flex gap-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => onUnstage(stagedFiles.map((f) => f.path))}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Unstage all</TooltipContent>
                  </Tooltip>
                </div>
              </div>
              {stagedFiles.map((file) => (
                <FileRow
                  key={`staged-${file.path}`}
                  file={file}
                  isSelected={selectedFile === file.path}
                  onSelect={() => onSelect(file.path)}
                  actionButton={
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUnstage([file.path]);
                          }}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Unstage</TooltipContent>
                    </Tooltip>
                  }
                />
              ))}
            </div>
          )}

          {stagedFiles.length > 0 && unstagedFiles.length > 0 && (
            <Separator className="mx-2" />
          )}

          {/* Unstaged changes */}
          {unstagedFiles.length > 0 && (
            <div>
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
                  Changes ({unstagedFiles.length})
                </span>
                <div className="flex gap-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => onStage(unstagedFiles.map((f) => f.path))}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Stage all</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => onRevert(unstagedFiles.map((f) => f.path))}
                      >
                        <Undo2 className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Revert all</TooltipContent>
                  </Tooltip>
                </div>
              </div>
              {unstagedFiles.map((file) => (
                <FileRow
                  key={`unstaged-${file.path}`}
                  file={file}
                  isSelected={selectedFile === file.path}
                  onSelect={() => onSelect(file.path)}
                  actionButton={
                    <div className="flex gap-0.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={(e) => {
                              e.stopPropagation();
                              onStage([file.path]);
                            }}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Stage</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRevert([file.path]);
                            }}
                          >
                            <Undo2 className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Revert</TooltipContent>
                      </Tooltip>
                    </div>
                  }
                />
              ))}
            </div>
          )}

          {files.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              <CheckSquare className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
              Working tree clean
            </div>
          )}
        </div>
      </ScrollArea>
    </TooltipProvider>
  );
}
