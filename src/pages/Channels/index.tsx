import { useCallback, useEffect, useState } from 'react';
import { Radio, Plug, PlugZap, Save, TestTube, Loader2, Play, Square, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ipc } from '@/services/ipc';

type ConnectionStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected' | 'error' | 'not-configured';
type ChannelId = 'feishu' | 'feishu2' | 'qq' | 'email';

interface FeishuConfig {
  appId: string;
  appSecret: string;
  encryptKey: string;
  verificationToken: string;
  domain: 'feishu' | 'lark';
}

interface QQConfig {
  appId: string;
  clientSecret: string;
  sandbox: boolean;
}

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from: string;
  to: string;
  subjectPrefix: string;
}

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  connected: { label: '已连接', variant: 'default' },
  connecting: { label: '连接中', variant: 'secondary' },
  reconnecting: { label: '重连中', variant: 'secondary' },
  disconnected: { label: '已断开', variant: 'destructive' },
  error: { label: '错误', variant: 'destructive' },
  'not-configured': { label: '未配置', variant: 'secondary' },
};

function parseConfig<T>(val: unknown): T | null {
  if (typeof val !== 'string') return null;
  try {
    return JSON.parse(val) as T;
  } catch {
    return null;
  }
}

export function ChannelsPage() {
  const [statuses, setStatuses] = useState<Record<string, ConnectionStatus>>({});
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const [feishuConfig, setFeishuConfig] = useState<FeishuConfig>({
    appId: '',
    appSecret: '',
    encryptKey: '',
    verificationToken: '',
    domain: 'feishu',
  });
  const [feishu2Config, setFeishu2Config] = useState<FeishuConfig>({
    appId: '',
    appSecret: '',
    encryptKey: '',
    verificationToken: '',
    domain: 'feishu',
  });
  const [qqConfig, setQqConfig] = useState<QQConfig>({
    appId: '',
    clientSecret: '',
    sandbox: false,
  });
  const [emailConfig, setEmailConfig] = useState<EmailConfig>({
    host: '',
    port: 465,
    secure: true,
    username: '',
    password: '',
    from: '',
    to: '',
    subjectPrefix: 'ClawDesktop',
  });

  const refreshStatuses = useCallback(async () => {
    try {
      const channels = await ipc.listChannels();
      const next: Record<string, ConnectionStatus> = {};
      for (const ch of channels) {
        if (typeof ch.id !== 'string' || typeof ch.status !== 'string') continue;
        if (ch.configured !== true) {
          next[ch.id] = 'not-configured';
          continue;
        }
        const raw = ch.status as ConnectionStatus;
        next[ch.id] = raw in STATUS_CONFIG ? raw : 'disconnected';
      }
      setStatuses(next);
    } catch {
      // best-effort
    }
  }, []);

  const loadConfigs = useCallback(async () => {
    const [feishuRaw, feishu2Raw, qqRaw, emailRaw] = await Promise.all([
      ipc.getSetting('channel:feishu:config').catch(() => null),
      ipc.getSetting('channel:feishu2:config').catch(() => null),
      ipc.getSetting('channel:qq:config').catch(() => null),
      ipc.getSetting('channel:email:config').catch(() => null),
    ]);

    const f1 = parseConfig<Partial<FeishuConfig>>(feishuRaw);
    const f2 = parseConfig<Partial<FeishuConfig>>(feishu2Raw);
    const qq = parseConfig<Partial<QQConfig>>(qqRaw);
    const email = parseConfig<Partial<EmailConfig>>(emailRaw);

    if (f1) {
      setFeishuConfig((prev) => ({
        ...prev,
        ...f1,
        domain: f1.domain === 'lark' ? 'lark' : 'feishu',
      }));
    }
    if (f2) {
      setFeishu2Config((prev) => ({
        ...prev,
        ...f2,
        domain: f2.domain === 'lark' ? 'lark' : 'feishu',
      }));
    }
    if (qq) {
      setQqConfig((prev) => ({
        ...prev,
        ...qq,
        sandbox: qq.sandbox === true,
      }));
    }
    if (email) {
      setEmailConfig((prev) => ({
        ...prev,
        ...email,
        port: typeof email.port === 'number' ? email.port : prev.port,
        secure: email.secure !== undefined ? email.secure : prev.secure,
      }));
    }
  }, []);

  useEffect(() => {
    void loadConfigs();
    void refreshStatuses();
  }, [loadConfigs, refreshStatuses]);

  useEffect(() => {
    const unsubscribe = ipc.onChannelStatus((event) => {
      if (!event?.channelId) return;
      const status = event.status as ConnectionStatus;
      if (!(status in STATUS_CONFIG)) return;
      setStatuses((prev) => ({
        ...prev,
        [event.channelId]: status,
      }));
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  const getStatus = (id: ChannelId): ConnectionStatus => statuses[id] ?? 'not-configured';

  const withLoading = async (key: string, fn: () => Promise<void>) => {
    setLoadingAction(key);
    try {
      await fn();
    } finally {
      setLoadingAction(null);
    }
  };

  const saveChannel = useCallback(async (channelId: ChannelId, config: Record<string, unknown>) => {
    await withLoading(`save:${channelId}`, async () => {
      await ipc.configureChannel(channelId, config);
      await refreshStatuses();
      toast.success(`${channelId} 配置已保存`);
    });
  }, [refreshStatuses]);

  const testChannel = useCallback(async (channelId: ChannelId) => {
    await withLoading(`test:${channelId}`, async () => {
      const result = await ipc.testChannel(channelId) as { connected: boolean; error?: string };
      await refreshStatuses();
      if (result.connected) {
        toast.success(`${channelId} 连接测试成功`);
      } else {
        toast.error(result.error ?? `${channelId} 连接测试失败`);
      }
    });
  }, [refreshStatuses]);

  const startChannel = useCallback(async (channelId: ChannelId) => {
    await withLoading(`start:${channelId}`, async () => {
      await ipc.startChannel(channelId);
      await refreshStatuses();
      toast.success(`${channelId} 已启动`);
    });
  }, [refreshStatuses]);

  const stopChannel = useCallback(async (channelId: ChannelId) => {
    await withLoading(`stop:${channelId}`, async () => {
      await ipc.stopChannel(channelId);
      await refreshStatuses();
      toast.success(`${channelId} 已停止`);
    });
  }, [refreshStatuses]);

  return (
    <div className="page-shell">
      <div className="page-container max-w-5xl">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <Radio className="h-6 w-6" />
            <h1 className="text-2xl font-bold">渠道中心</h1>
          </div>
          <p className="text-muted-foreground mt-2">
            支持四条渠道：飞书 1（OpenClaw 风格）、飞书 2（CoPaw 风格）、QQ、Email（SMTP）。
          </p>
        </div>

        <Card className="panel-surface">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">飞书 1（OpenClaw）</CardTitle>
            <CardDescription>主飞书账号，用于默认企业渠道。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              {getStatus('feishu') === 'connected' ? (
                <PlugZap className="h-4 w-4 text-green-500" />
              ) : (
                <Plug className="h-4 w-4 text-muted-foreground" />
              )}
              <Badge variant={STATUS_CONFIG[getStatus('feishu')].variant}>
                {STATUS_CONFIG[getStatus('feishu')].label}
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>App ID</Label>
                <Input value={feishuConfig.appId} onChange={(e) => setFeishuConfig((p) => ({ ...p, appId: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>App Secret</Label>
                <Input type="password" value={feishuConfig.appSecret} onChange={(e) => setFeishuConfig((p) => ({ ...p, appSecret: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Encrypt Key</Label>
                <Input value={feishuConfig.encryptKey} onChange={(e) => setFeishuConfig((p) => ({ ...p, encryptKey: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Verification Token</Label>
                <Input value={feishuConfig.verificationToken} onChange={(e) => setFeishuConfig((p) => ({ ...p, verificationToken: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>域名</Label>
              <Select value={feishuConfig.domain} onValueChange={(v) => setFeishuConfig((p) => ({ ...p, domain: v as 'feishu' | 'lark' }))}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="feishu">feishu</SelectItem>
                  <SelectItem value="lark">lark</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => void saveChannel('feishu', feishuConfig as unknown as Record<string, unknown>)}
                disabled={loadingAction === 'save:feishu'}
              >
                {loadingAction === 'save:feishu' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                保存
              </Button>
              <Button size="sm" variant="outline" onClick={() => void testChannel('feishu')} disabled={loadingAction === 'test:feishu'}>
                {loadingAction === 'test:feishu' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <TestTube className="h-4 w-4 mr-1" />}
                测试
              </Button>
              <Button size="sm" variant="outline" onClick={() => void startChannel('feishu')} disabled={loadingAction === 'start:feishu'}>
                <Play className="h-4 w-4 mr-1" />
                启动
              </Button>
              <Button size="sm" variant="outline" onClick={() => void stopChannel('feishu')} disabled={loadingAction === 'stop:feishu'}>
                <Square className="h-4 w-4 mr-1" />
                停止
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="panel-surface">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">飞书 2（CoPaw）</CardTitle>
            <CardDescription>独立飞书账号，用于第二条渠道并行接入。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              {getStatus('feishu2') === 'connected' ? (
                <PlugZap className="h-4 w-4 text-green-500" />
              ) : (
                <Plug className="h-4 w-4 text-muted-foreground" />
              )}
              <Badge variant={STATUS_CONFIG[getStatus('feishu2')].variant}>
                {STATUS_CONFIG[getStatus('feishu2')].label}
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>App ID</Label>
                <Input value={feishu2Config.appId} onChange={(e) => setFeishu2Config((p) => ({ ...p, appId: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>App Secret</Label>
                <Input type="password" value={feishu2Config.appSecret} onChange={(e) => setFeishu2Config((p) => ({ ...p, appSecret: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => void saveChannel('feishu2', feishu2Config as unknown as Record<string, unknown>)}
                disabled={loadingAction === 'save:feishu2'}
              >
                {loadingAction === 'save:feishu2' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                保存
              </Button>
              <Button size="sm" variant="outline" onClick={() => void testChannel('feishu2')} disabled={loadingAction === 'test:feishu2'}>
                {loadingAction === 'test:feishu2' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <TestTube className="h-4 w-4 mr-1" />}
                测试
              </Button>
              <Button size="sm" variant="outline" onClick={() => void startChannel('feishu2')} disabled={loadingAction === 'start:feishu2'}>
                <Play className="h-4 w-4 mr-1" />
                启动
              </Button>
              <Button size="sm" variant="outline" onClick={() => void stopChannel('feishu2')} disabled={loadingAction === 'stop:feishu2'}>
                <Square className="h-4 w-4 mr-1" />
                停止
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="panel-surface">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">QQ</CardTitle>
            <CardDescription>QQ Bot 网关渠道。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              {getStatus('qq') === 'connected' ? (
                <PlugZap className="h-4 w-4 text-green-500" />
              ) : (
                <Plug className="h-4 w-4 text-muted-foreground" />
              )}
              <Badge variant={STATUS_CONFIG[getStatus('qq')].variant}>
                {STATUS_CONFIG[getStatus('qq')].label}
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>App ID</Label>
                <Input value={qqConfig.appId} onChange={(e) => setQqConfig((p) => ({ ...p, appId: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Client Secret</Label>
                <Input type="password" value={qqConfig.clientSecret} onChange={(e) => setQqConfig((p) => ({ ...p, clientSecret: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={qqConfig.sandbox} onCheckedChange={(checked) => setQqConfig((p) => ({ ...p, sandbox: checked }))} />
              <Label>Sandbox 模式</Label>
            </div>
            <Separator />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => void saveChannel('qq', qqConfig as unknown as Record<string, unknown>)}
                disabled={loadingAction === 'save:qq'}
              >
                {loadingAction === 'save:qq' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                保存
              </Button>
              <Button size="sm" variant="outline" onClick={() => void testChannel('qq')} disabled={loadingAction === 'test:qq'}>
                {loadingAction === 'test:qq' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <TestTube className="h-4 w-4 mr-1" />}
                测试
              </Button>
              <Button size="sm" variant="outline" onClick={() => void startChannel('qq')} disabled={loadingAction === 'start:qq'}>
                <Play className="h-4 w-4 mr-1" />
                启动
              </Button>
              <Button size="sm" variant="outline" onClick={() => void stopChannel('qq')} disabled={loadingAction === 'stop:qq'}>
                <Square className="h-4 w-4 mr-1" />
                停止
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="panel-surface">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email（SMTP）
            </CardTitle>
            <CardDescription>用于发送任务结果或系统通知邮件。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              {getStatus('email') === 'connected' ? (
                <PlugZap className="h-4 w-4 text-green-500" />
              ) : (
                <Plug className="h-4 w-4 text-muted-foreground" />
              )}
              <Badge variant={STATUS_CONFIG[getStatus('email')].variant}>
                {STATUS_CONFIG[getStatus('email')].label}
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>SMTP Host</Label>
                <Input value={emailConfig.host} onChange={(e) => setEmailConfig((p) => ({ ...p, host: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>SMTP Port</Label>
                <Input
                  type="number"
                  value={emailConfig.port}
                  onChange={(e) => setEmailConfig((p) => ({ ...p, port: Number(e.target.value) || 0 }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Username</Label>
                <Input value={emailConfig.username} onChange={(e) => setEmailConfig((p) => ({ ...p, username: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input type="password" value={emailConfig.password} onChange={(e) => setEmailConfig((p) => ({ ...p, password: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>From</Label>
                <Input value={emailConfig.from} onChange={(e) => setEmailConfig((p) => ({ ...p, from: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>To</Label>
                <Input value={emailConfig.to} onChange={(e) => setEmailConfig((p) => ({ ...p, to: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Subject Prefix</Label>
                <Input value={emailConfig.subjectPrefix} onChange={(e) => setEmailConfig((p) => ({ ...p, subjectPrefix: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={emailConfig.secure} onCheckedChange={(checked) => setEmailConfig((p) => ({ ...p, secure: checked }))} />
              <Label>TLS/SSL（secure）</Label>
            </div>
            <Separator />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => void saveChannel('email', emailConfig as unknown as Record<string, unknown>)}
                disabled={loadingAction === 'save:email'}
              >
                {loadingAction === 'save:email' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                保存
              </Button>
              <Button size="sm" variant="outline" onClick={() => void testChannel('email')} disabled={loadingAction === 'test:email'}>
                {loadingAction === 'test:email' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <TestTube className="h-4 w-4 mr-1" />}
                测试并发送
              </Button>
              <Button size="sm" variant="outline" onClick={() => void startChannel('email')} disabled={loadingAction === 'start:email'}>
                <Play className="h-4 w-4 mr-1" />
                启动
              </Button>
              <Button size="sm" variant="outline" onClick={() => void stopChannel('email')} disabled={loadingAction === 'stop:email'}>
                <Square className="h-4 w-4 mr-1" />
                停止
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
