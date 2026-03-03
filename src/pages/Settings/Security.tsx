import { useState, useCallback, useEffect } from 'react';
import { Shield, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ipc } from '@/services/ipc';

// ── Types ──────────────────────────────────────────────────────────

type ApprovalMode = 'suggest' | 'auto-edit' | 'full-auto';

interface RememberedRule {
  id: string;
  pattern: string;
  action: 'allow' | 'deny';
}

// ── Approval Mode Config ───────────────────────────────────────────

interface ModeOption {
  value: ApprovalMode;
  label: string;
  description: string;
}

const MODES: ModeOption[] = [
  {
    value: 'suggest',
    label: '建议模式',
    description: '所有代码变更需要手动确认后才会应用。最安全的模式。',
  },
  {
    value: 'auto-edit',
    label: '自动编辑模式',
    description: '文件编辑自动应用，Shell 命令仍需确认。',
  },
  {
    value: 'full-auto',
    label: '全自动模式',
    description: '所有操作自动执行，无需手动确认。仅在受信任环境使用。',
  },
];

// ── Component ──────────────────────────────────────────────────────

export function SecuritySettings() {
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('suggest');
  const [whitelist, setWhitelist] = useState<string[]>([]);
  const [newPath, setNewPath] = useState('');
  const [rememberedRules, setRememberedRules] = useState<RememberedRule[]>([]);

  // ── Load initial state from backend ──────────────────────────────

  useEffect(() => {
    ipc.invoke<string>('approval:mode:get').then((mode) => {
      if (mode && typeof mode === 'string') {
        setApprovalMode(mode as ApprovalMode);
      }
    }).catch(() => { /* use default */ });

    ipc.mountAllowlistList().then((paths) => {
      setWhitelist(paths);
    }).catch(() => { /* use default */ });
  }, []);

  // ── Approval mode ────────────────────────────────────────────────

  const handleModeChange = useCallback((mode: ApprovalMode) => {
    setApprovalMode(mode);
    ipc.invoke('approval:mode:set', mode).catch(() => {
      toast.error('保存审批模式失败');
    });
    toast.success(`已切换到${MODES.find((m) => m.value === mode)?.label ?? mode}`);
  }, []);

  // ── Whitelist ────────────────────────────────────────────────────

  const addWhitelistPath = useCallback(() => {
    const trimmed = newPath.trim();
    if (!trimmed) return;
    if (whitelist.includes(trimmed)) {
      toast.error('路径已存在');
      return;
    }
    ipc.mountAllowlistAdd(trimmed).then(() => {
      setWhitelist((prev) => [...prev, trimmed]);
      setNewPath('');
      toast.success('路径已添加');
    }).catch(() => {
      toast.error('添加白名单路径失败');
    });
  }, [newPath, whitelist]);

  const removeWhitelistPath = useCallback((path: string) => {
    ipc.mountAllowlistRemove(path).then(() => {
      setWhitelist((prev) => prev.filter((p) => p !== path));
      toast.success('路径已移除');
    }).catch(() => {
      toast.error('移除白名单路径失败');
    });
  }, []);

  // ── Remembered rules ─────────────────────────────────────────────

  const clearRules = useCallback(() => {
    setRememberedRules([]);
    toast.success('已清除所有记住的审批规则');
  }, []);

  const removeRule = useCallback((id: string) => {
    setRememberedRules((prev) => prev.filter((r) => r.id !== id));
  }, []);

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5" />
          安全
        </h2>
        <p className="text-sm text-muted-foreground mt-1">审批模式、挂载白名单和审批规则管理。</p>
      </div>

      <Separator />

      {/* ── Approval Mode ──────────────────────────────────────────── */}
      <div className="space-y-3">
        <Label className="text-base font-medium">审批模式</Label>
        <div className="space-y-2">
          {MODES.map((mode) => (
            <Card
              key={mode.value}
              className={`cursor-pointer transition-colors ${
                approvalMode === mode.value
                  ? 'border-primary bg-primary/5'
                  : 'hover:border-primary/40'
              }`}
              onClick={() => handleModeChange(mode.value)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      approvalMode === mode.value
                        ? 'border-primary'
                        : 'border-muted-foreground/40'
                    }`}
                  >
                    {approvalMode === mode.value && (
                      <div className="h-2 w-2 rounded-full bg-primary" />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{mode.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {mode.description}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Separator />

      {/* ── Mount Whitelist ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <Label className="text-base font-medium">挂载白名单</Label>
        <p className="text-xs text-muted-foreground">
          允许智能体访问的额外文件系统路径。工作目录默认挂载。
        </p>

        <div className="flex gap-2">
          <Input
            placeholder="输入路径，如 /usr/local/bin"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addWhitelistPath();
            }}
          />
          <Button variant="outline" size="sm" onClick={addWhitelistPath} disabled={!newPath.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {whitelist.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">暂无白名单路径。</p>
        ) : (
          <div className="space-y-1">
            {whitelist.map((path) => (
              <div
                key={path}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <code className="text-xs font-mono">{path}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeWhitelistPath(path)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* ── Remembered Approval Rules ───────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base font-medium">已记住的审批规则</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              之前审批时选择「记住此决定」保存的规则。
            </p>
          </div>
          {rememberedRules.length > 0 && (
            <Button variant="destructive" size="sm" onClick={clearRules}>
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              全部清除
            </Button>
          )}
        </div>

        {rememberedRules.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">暂无已记住的规则。</p>
        ) : (
          <div className="space-y-1">
            {rememberedRules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <Badge variant={rule.action === 'allow' ? 'default' : 'destructive'}>
                    {rule.action === 'allow' ? '允许' : '拒绝'}
                  </Badge>
                  <code className="text-xs font-mono">{rule.pattern}</code>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeRule(rule.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
