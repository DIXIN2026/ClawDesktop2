import { useEffect, useState } from 'react';
import {
  GitBranch,
  RefreshCw,
  ArrowUpFromLine,
  Undo2,
  Redo2,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useGitStore } from '@/stores/git';
import { FileChangeList } from './FileChangeList';
import { DiffViewer } from './DiffViewer';

export function ReviewPanel() {
  const {
    branch,
    files,
    ahead,
    behind,
    diffContent,
    selectedFile,
    isLoading,
    refreshStatus,
    selectFile,
    stageFiles,
    unstageFiles,
    revertFiles,
    commit,
    push,
    undo,
    redo,
  } = useGitStore();

  const [commitMsg, setCommitMsg] = useState('');
  const [isPushing, setIsPushing] = useState(false);

  // Refresh git status on mount
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const stagedCount = files.filter((f) => f.staged).length;

  const handleCommit = async () => {
    if (!commitMsg.trim() || stagedCount === 0) return;
    try {
      await commit(commitMsg);
      setCommitMsg('');
    } catch (err) {
      console.error('Commit failed:', err instanceof Error ? err.message : String(err));
    }
  };

  const handlePush = async () => {
    setIsPushing(true);
    try {
      await push();
    } catch (err) {
      console.error('Push failed:', err instanceof Error ? err.message : String(err));
    } finally {
      setIsPushing(false);
    }
  };

  const handleUndo = async () => {
    try {
      await undo();
    } catch (err) {
      console.error('Undo failed:', err instanceof Error ? err.message : String(err));
    }
  };

  const handleRedo = async () => {
    try {
      await redo();
    } catch (err) {
      console.error('Redo failed:', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-xs font-mono truncate">
            {branch || '无分支'}
          </span>
          {ahead > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              超前 {ahead}
            </Badge>
          )}
          {behind > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              落后 {behind}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleUndo}
            title="撤销上一次提交"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleRedo}
            title="重做上一次撤销"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => void refreshStatus()}
            disabled={isLoading}
            title="刷新"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
          </Button>
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 flex flex-col min-h-0">
        {selectedFile ? (
          <>
            {/* Back to file list */}
            <div className="px-2 py-1.5 border-b border-border shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => selectFile(null)}
              >
                返回文件列表
              </Button>
            </div>
            {/* Diff viewer */}
            <div className="flex-1 min-h-0">
              <DiffViewer diff={diffContent} filePath={selectedFile} />
            </div>
          </>
        ) : (
          <FileChangeList
            files={files}
            selectedFile={selectedFile}
            onSelect={(path) => selectFile(path)}
            onStage={(paths) => void stageFiles(paths)}
            onUnstage={(paths) => void unstageFiles(paths)}
            onRevert={(paths) => void revertFiles(paths)}
          />
        )}
      </div>

      <Separator />

      {/* Commit area */}
      <div className="px-3 py-2.5 space-y-2 shrink-0">
        <div className="flex gap-2">
          <Input
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            placeholder="提交信息..."
            className="h-8 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleCommit();
              }
            }}
          />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1 h-7 text-xs"
            disabled={!commitMsg.trim() || stagedCount === 0}
            onClick={() => void handleCommit()}
          >
            提交（{stagedCount}）
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={isPushing}
            onClick={() => void handlePush()}
          >
            {isPushing ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <ArrowUpFromLine className="h-3 w-3 mr-1" />
            )}
            推送
          </Button>
        </div>
      </div>
    </div>
  );
}
