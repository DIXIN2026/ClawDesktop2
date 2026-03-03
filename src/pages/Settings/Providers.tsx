import { useEffect, useState, useCallback } from 'react';
import { Check, X, Search, Terminal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useProvidersStore } from '@/stores/providers';
import { cn } from '@/lib/utils';

const AGENT_TYPE_LABELS: Record<string, string> = {
  coding: '编码',
  requirements: '需求',
  design: '设计',
  testing: '测试',
};

// Built-in CLI agent definitions (used when discovery returns empty)
const BUILTIN_CLI_AGENTS: Array<{ id: string; name: string; command: string; installed: boolean; version?: string }> = [
  { id: 'claude-code', name: 'Claude Code', command: 'claude', installed: false },
  { id: 'codex', name: 'Codex CLI', command: 'codex', installed: false },
  { id: 'gemini-cli', name: 'Gemini CLI', command: 'gemini', installed: false },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', installed: false },
];

export function ProvidersSettings() {
  const {
    providers,
    cliAgents,
    discovered,
    agentDefaults,
    selectedCliBackend,
    setSelectedCliBackend,
    setAgentDefault,
    runDiscovery,
  } = useProvidersStore();
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    runDiscovery();
  }, [runDiscovery]);

  const handleApiKeyChange = useCallback((providerId: string, value: string) => {
    setApiKeyInputs((prev) => ({ ...prev, [providerId]: value }));
  }, []);

  const handleSaveApiKey = useCallback(async (providerId: string) => {
    const key = apiKeyInputs[providerId]?.trim();
    if (!key) {
      toast.error('请输入 API Key');
      return;
    }
    setSavingKeys((prev) => ({ ...prev, [providerId]: true }));
    try {
      await window.electron?.ipcRenderer.invoke('providers:setApiKey', providerId, key);
      setApiKeyInputs((prev) => ({ ...prev, [providerId]: '' }));
      toast.success(`${providerId} API Key 已保存`);
      runDiscovery();
    } catch (err) {
      toast.error(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingKeys((prev) => ({ ...prev, [providerId]: false }));
    }
  }, [apiKeyInputs, runDiscovery]);

  const apiKeyProviders = providers.filter((p) => p.accessType === 'api-key');
  const codingPlanProviders = providers.filter((p) => p.accessType === 'coding-plan');

  // Collect all available models for the agent default model selector
  const allModels = providers.flatMap((p) =>
    p.models.map((m) => ({ label: `${m.name} (${p.name})`, value: `${p.id}/${m.id}` })),
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">模型供应商</h2>
        <p className="text-sm text-muted-foreground mt-1">
          配置 AI 模型供应商和 CLI 智能体后端。
        </p>
      </div>

      {/* Discovery results */}
      {discovered.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm">自动发现</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {discovered.map((d, i) => (
                <div key={i} className="text-sm flex items-center gap-2">
                  <Check className="h-3 w-3 text-green-500" />
                  <span>{d.details}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      <Tabs defaultValue="api-key">
        <TabsList>
          <TabsTrigger value="api-key">API Key</TabsTrigger>
          <TabsTrigger value="coding-plan">Coding Plan</TabsTrigger>
          <TabsTrigger value="cli">CLI 智能体</TabsTrigger>
        </TabsList>

        <TabsContent value="api-key" className="space-y-4 mt-4">
          {apiKeyProviders.map((provider) => (
            <Card key={provider.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{provider.name}</CardTitle>
                  <Badge variant={provider.status === 'available' ? 'default' : 'secondary'}>
                    {provider.status === 'available' ? '已启用' : '未启用'}
                  </Badge>
                </div>
                <CardDescription>{provider.models.length} 个可用模型</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder={`输入 ${provider.envVar || 'API Key'}...`}
                    className="flex-1"
                    value={apiKeyInputs[provider.id] ?? ''}
                    onChange={(e) => handleApiKeyChange(provider.id, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveApiKey(provider.id); }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={savingKeys[provider.id] ?? false}
                    onClick={() => handleSaveApiKey(provider.id)}
                  >
                    {savingKeys[provider.id] ? '保存中...' : '保存'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="coding-plan" className="space-y-4 mt-4">
          {codingPlanProviders.map((provider) => (
            <Card key={provider.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{provider.name}</CardTitle>
                    {provider.region === 'cn' && <Badge variant="outline">国内</Badge>}
                    {provider.region === 'global' && <Badge variant="outline">全球</Badge>}
                  </div>
                  <Badge variant={provider.status === 'available' ? 'default' : 'secondary'}>
                    {provider.status === 'available' ? '已启用' : '未启用'}
                  </Badge>
                </div>
                <CardDescription>
                  {provider.apiProtocol === 'anthropic-messages' ? 'Anthropic Messages API' : 'OpenAI Compatible'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder={`输入 ${provider.envVar || 'API Key'}...`}
                    className="flex-1"
                    value={apiKeyInputs[provider.id] ?? ''}
                    onChange={(e) => handleApiKeyChange(provider.id, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveApiKey(provider.id); }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={savingKeys[provider.id] ?? false}
                    onClick={() => handleSaveApiKey(provider.id)}
                  >
                    {savingKeys[provider.id] ? '保存中...' : '保存'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="cli" className="space-y-4 mt-4">
          <p className="text-sm text-muted-foreground">
            选择一个已安装的 CLI 工具作为编码智能体后端。点击选择，再次点击取消选择。
          </p>
          {(cliAgents.length > 0 ? cliAgents : BUILTIN_CLI_AGENTS).map((agent) => {
            const isSelected = selectedCliBackend === agent.id;
            const canSelect = agent.installed || cliAgents.length === 0;
            return (
              <Card
                key={agent.id}
                className={cn(
                  'transition-colors',
                  canSelect ? 'cursor-pointer hover:border-primary/50' : 'opacity-50',
                  isSelected && 'border-primary bg-primary/5',
                )}
                onClick={() => { if (canSelect) setSelectedCliBackend(isSelected ? null : agent.id); }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Terminal className="h-4 w-4" />
                      <CardTitle className="text-base">{agent.name}</CardTitle>
                      {isSelected && <Badge variant="default">已选择</Badge>}
                    </div>
                    {agent.installed ? (
                      <Badge variant="default">
                        <Check className="h-3 w-3 mr-1" />
                        已安装
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        <X className="h-3 w-3 mr-1" />
                        未检测
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground">
                    命令：<code className="bg-muted px-1 rounded">{agent.command}</code>
                    {agent.version && <span className="ml-2">v{agent.version}</span>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>

      <Separator />

      {/* Agent Default Models */}
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">智能体默认模型</h3>
          <p className="text-sm text-muted-foreground mt-1">
            为每种智能体类型配置默认模型。
          </p>
        </div>

        {agentDefaults.map((mapping) => (
          <div key={mapping.agentType} className="flex items-center justify-between gap-4">
            <Label className="w-32 shrink-0">{AGENT_TYPE_LABELS[mapping.agentType] ?? mapping.agentType}智能体</Label>
            <Select
              value={mapping.primaryModel || undefined}
              onValueChange={(value) => {
                setAgentDefault(mapping.agentType, value, mapping.fallbackModel);
                toast.success(`${AGENT_TYPE_LABELS[mapping.agentType] ?? mapping.agentType}智能体默认模型已更新`);
              }}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="选择模型..." />
              </SelectTrigger>
              <SelectContent>
                {allModels.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <Separator />

      {/* Custom OpenAI Compatible Endpoint */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">自定义 OpenAI 兼容端点</h3>
            <p className="text-sm text-muted-foreground mt-1">
              添加您自己的 OpenAI 兼容 API 端点。
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const name = window.prompt('端点名称（例如: My Custom API）');
              if (!name?.trim()) return;
              const baseUrl = window.prompt('Base URL（例如: https://api.example.com/v1）');
              if (!baseUrl?.trim()) return;
              void window.electron?.ipcRenderer.invoke('providers:save', {
                id: `custom-${Date.now()}`,
                name: name.trim(),
                accessType: 'api-key',
                apiProtocol: 'openai-compatible',
                baseUrl: baseUrl.trim(),
                envVar: '',
                models: [],
                status: 'unconfigured',
                isBuiltin: false,
              }).then(() => {
                toast.success('自定义端点已添加');
                runDiscovery();
              }).catch((err: unknown) => {
                toast.error(`添加失败: ${err instanceof Error ? err.message : String(err)}`);
              });
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            添加端点
          </Button>
        </div>
      </div>
    </div>
  );
}
