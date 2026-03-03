import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  Server,
  FolderOpen,
  Container,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  Check,
  X,
  Terminal,
  Key,
  Cloud,
  HardDrive,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSettingsStore } from '@/stores/settings';
import { useProvidersStore } from '@/stores/providers';
import { cn } from '@/lib/utils';

const STEPS = [
  { id: 'welcome', label: '欢迎', icon: Sparkles },
  { id: 'providers', label: '供应商', icon: Server },
  { id: 'workspace', label: '工作区', icon: FolderOpen },
  { id: 'container', label: '容器', icon: Container },
  { id: 'complete', label: '完成', icon: CheckCircle },
] as const;

export function SetupPage() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const { completeSetup, setWorkDirectory, setContainerRuntime, workDirectory } = useSettingsStore();
  const { providers, discovered, cliAgents, runDiscovery, isDiscovering, selectedCliBackend, setSelectedCliBackend } = useProvidersStore();
  const [containerStatus, setContainerStatus] = useState<'checking' | 'docker' | 'apple-container' | 'none'>('checking');
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});

  const apiKeyProviders = providers.filter((p) => p.accessType === 'api-key');
  const codingPlanProviders = providers.filter((p) => p.accessType === 'coding-plan');

  useEffect(() => {
    if (step === 1) {
      runDiscovery();
    }
    if (step === 3) {
      checkContainerRuntime();
    }
  }, [step, runDiscovery]);

  const checkContainerRuntime = async () => {
    setContainerStatus('checking');
    try {
      const result = await window.electron?.ipcRenderer.invoke('engine:status');
      if (result && typeof result === 'object') {
        const status = result as { success: boolean; result?: { containerRuntime?: string } };
        if (status.result?.containerRuntime === 'apple-container') {
          setContainerStatus('apple-container');
          setContainerRuntime('apple-container');
        } else if (status.result?.containerRuntime === 'docker') {
          setContainerStatus('docker');
          setContainerRuntime('docker');
        } else {
          setContainerStatus('none');
          setContainerRuntime('none');
        }
        return;
      }
    } catch (err) {
      console.error('[ERROR] Container runtime check failed:', err);
    }
    setContainerStatus('none');
    setContainerRuntime('none');
  };

  const handleComplete = () => {
    completeSetup();
    navigate('/');
  };

  const handleSelectDirectory = async () => {
    try {
      const result = await window.electron?.ipcRenderer.invoke('dialog:open', {
        properties: ['openDirectory'],
      }) as { canceled: boolean; filePaths: string[] } | undefined;

      if (result && !result.canceled && result.filePaths.length > 0) {
        setWorkDirectory(result.filePaths[0]);
      }
    } catch (err) {
      console.warn('[WARN] Directory selection failed or cancelled:', err);
    }
  };

  const handleApiKeyChange = (providerId: string, value: string) => {
    setApiKeys((prev) => ({ ...prev, [providerId]: value }));
  };

  const handleSaveApiKey = async (providerId: string) => {
    const key = apiKeys[providerId];
    if (!key?.trim()) return;
    try {
      await window.electron?.ipcRenderer.invoke('providers:setApiKey', providerId, key.trim());
    } catch (err) {
      console.warn('[WARN] Failed to save API key:', err);
    }
  };

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Title bar drag region */}
      <div className="drag-region h-10 shrink-0" />

      {/* Progress */}
      <div className="px-8">
        <Progress value={progress} className="h-1" />
      </div>

      {/* Step indicators */}
      <div className="flex justify-center gap-8 py-4">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <div
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-sm',
                i < step
                  ? 'bg-primary text-primary-foreground'
                  : i === step
                    ? 'bg-primary text-primary-foreground ring-2 ring-primary/30'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {i < step ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <span className={cn('text-sm hidden sm:inline', i === step ? 'font-medium' : 'text-muted-foreground')}>
              {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 pb-8">
        <div className="w-full max-w-2xl mx-auto">
          {/* Step 0: Welcome */}
          {step === 0 && (
            <div className="text-center space-y-6 pt-12">
              <div className="flex justify-center">
                <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Sparkles className="h-10 w-10 text-primary" />
                </div>
              </div>
              <div>
                <h1 className="text-3xl font-bold">欢迎使用 ClawDesktop2</h1>
                <p className="text-muted-foreground mt-3 text-lg">
                  面向软件开发的多智能体 AI 桌面应用
                </p>
              </div>
              <div className="text-sm text-muted-foreground space-y-2">
                <p>四大专业 AI 智能体：编码、需求、设计、测试</p>
                <p>容器隔离执行，操作系统级安全保障</p>
                <p>多模型供应商支持，CLI 和 API 双模式</p>
              </div>
            </div>
          )}

          {/* Step 1: Providers — Full multi-provider configuration */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">配置供应商</h2>
                <p className="text-muted-foreground mt-1">
                  选择并配置 AI 模型供应商。支持三种接入方式，可配置多个。
                </p>
              </div>

              {/* Auto-discovery results */}
              {isDiscovering && (
                <div className="text-center py-6 text-muted-foreground">
                  正在扫描可用的供应商...
                </div>
              )}

              {!isDiscovering && discovered.length > 0 && (
                <Card className="border-green-500/30 bg-green-500/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-500" />
                      自动发现
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {discovered.map((d, i) => (
                      <div key={i} className="text-sm flex items-center gap-2">
                        <Check className="h-3 w-3 text-green-500" />
                        <span>{d.details}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {!isDiscovering && (
                <Tabs defaultValue="api-key">
                  <TabsList className="w-full grid grid-cols-3">
                    <TabsTrigger value="api-key" className="flex items-center gap-1.5">
                      <Key className="h-3.5 w-3.5" />
                      API Key
                    </TabsTrigger>
                    <TabsTrigger value="coding-plan" className="flex items-center gap-1.5">
                      <Cloud className="h-3.5 w-3.5" />
                      Coding Plan
                    </TabsTrigger>
                    <TabsTrigger value="cli" className="flex items-center gap-1.5">
                      <Terminal className="h-3.5 w-3.5" />
                      本地 CLI
                    </TabsTrigger>
                  </TabsList>

                  {/* API Key Providers */}
                  <TabsContent value="api-key" className="space-y-3 mt-4">
                    <p className="text-xs text-muted-foreground mb-2">
                      输入 API Key 直接调用云端模型。至少配置一个即可开始使用。
                    </p>
                    {apiKeyProviders.map((provider) => (
                      <Card key={provider.id}>
                        <CardHeader className="pb-2 pt-4 px-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <HardDrive className="h-4 w-4 text-muted-foreground" />
                              <CardTitle className="text-sm">{provider.name}</CardTitle>
                            </div>
                            <Badge variant={provider.status === 'available' ? 'default' : 'outline'} className="text-xs">
                              {provider.status === 'available' ? '已配置' : '未配置'}
                            </Badge>
                          </div>
                          {provider.models.length > 0 && (
                            <CardDescription className="text-xs">
                              {provider.models.map((m) => m.name).join('、')}
                            </CardDescription>
                          )}
                        </CardHeader>
                        <CardContent className="px-4 pb-3">
                          <div className="flex gap-2">
                            <Input
                              type="password"
                              placeholder={provider.envVar ? `${provider.envVar} 或直接输入 Key` : '输入 API Key...'}
                              className="flex-1 h-8 text-xs"
                              value={apiKeys[provider.id] ?? ''}
                              onChange={(e) => handleApiKeyChange(provider.id, e.target.value)}
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => handleSaveApiKey(provider.id)}
                              disabled={!apiKeys[provider.id]?.trim()}
                            >
                              保存
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </TabsContent>

                  {/* Coding Plan Providers */}
                  <TabsContent value="coding-plan" className="space-y-3 mt-4">
                    <p className="text-xs text-muted-foreground mb-2">
                      国内外 Coding Plan 平台，免费或按量计费，支持 OpenAI 兼容协议。
                    </p>
                    {codingPlanProviders.map((provider) => (
                      <Card key={provider.id}>
                        <CardHeader className="pb-2 pt-4 px-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Cloud className="h-4 w-4 text-muted-foreground" />
                              <CardTitle className="text-sm">{provider.name}</CardTitle>
                              {provider.region === 'cn' && <Badge variant="outline" className="text-xs">国内</Badge>}
                              {provider.region === 'global' && <Badge variant="outline" className="text-xs">全球</Badge>}
                            </div>
                            <Badge variant={provider.status === 'available' ? 'default' : 'outline'} className="text-xs">
                              {provider.status === 'available' ? '已配置' : '未配置'}
                            </Badge>
                          </div>
                          {provider.models.length > 0 && (
                            <CardDescription className="text-xs">
                              模型：{provider.models.map((m) => m.name).join('、')}
                            </CardDescription>
                          )}
                        </CardHeader>
                        <CardContent className="px-4 pb-3">
                          <div className="flex gap-2">
                            <Input
                              type="password"
                              placeholder={provider.envVar ? `${provider.envVar}` : '输入 API Key...'}
                              className="flex-1 h-8 text-xs"
                              value={apiKeys[provider.id] ?? ''}
                              onChange={(e) => handleApiKeyChange(provider.id, e.target.value)}
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => handleSaveApiKey(provider.id)}
                              disabled={!apiKeys[provider.id]?.trim()}
                            >
                              保存
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </TabsContent>

                  {/* CLI Agents */}
                  <TabsContent value="cli" className="space-y-3 mt-4">
                    <p className="text-xs text-muted-foreground mb-2">
                      编码智能体默认使用本地 CLI 工具。请选择一个作为编码后端。
                    </p>
                    {cliAgents.length > 0 ? (
                      <>
                        {cliAgents.map((agent) => {
                          const isSelected = selectedCliBackend === agent.id;
                          const canSelect = agent.installed;
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
                              <CardContent className="flex items-center justify-between py-3 px-4">
                                <div className="flex items-center gap-3">
                                  <div className={cn(
                                    'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0',
                                    isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/30',
                                  )}>
                                    {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                                  </div>
                                  <div>
                                    <p className="text-sm font-medium">{agent.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                      <code className="bg-muted px-1 rounded">{agent.command}</code>
                                      {agent.version && <span className="ml-2">v{agent.version}</span>}
                                    </p>
                                  </div>
                                </div>
                                {agent.installed ? (
                                  <Badge variant={isSelected ? 'default' : 'outline'} className="text-xs">
                                    {isSelected ? '已选择' : '已安装'}
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary" className="text-xs">
                                    <X className="h-3 w-3 mr-1" />
                                    未找到
                                  </Badge>
                                )}
                              </CardContent>
                            </Card>
                          );
                        })}
                        {!selectedCliBackend && (
                          <p className="text-xs text-muted-foreground text-center">
                            点击已安装的工具将其设为编码智能体后端
                          </p>
                        )}
                      </>
                    ) : (
                      <Card>
                        <CardContent className="py-8 text-center text-sm text-muted-foreground">
                          未检测到 CLI 编码工具。
                          <br />
                          <span className="text-xs">支持 Claude Code、Codex、OpenCode、Gemini CLI</span>
                          <br />
                          <span className="text-xs mt-1 block">未安装 CLI 时，可通过 API Key 或 Coding Plan 使用 API 直连模式</span>
                        </CardContent>
                      </Card>
                    )}
                  </TabsContent>
                </Tabs>
              )}

              <p className="text-xs text-muted-foreground text-center pt-2">
                可以跳过此步骤，稍后在「设置 → 模型供应商」中配置。
              </p>
            </div>
          )}

          {/* Step 2: Workspace */}
          {step === 2 && (
            <div className="space-y-6 pt-8">
              <div>
                <h2 className="text-2xl font-bold">选择工作区</h2>
                <p className="text-muted-foreground mt-1">
                  选择项目的默认工作目录。
                </p>
              </div>

              <Card className="cursor-pointer" onClick={handleSelectDirectory}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <FolderOpen className="h-10 w-10 text-muted-foreground" />
                    <div className="flex-1">
                      {workDirectory ? (
                        <div>
                          <p className="font-medium">{workDirectory}</p>
                          <p className="text-xs text-muted-foreground">点击更改</p>
                        </div>
                      ) : (
                        <div>
                          <p className="font-medium">选择目录</p>
                          <p className="text-xs text-muted-foreground">点击选择工作区文件夹</p>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <p className="text-xs text-muted-foreground">
                您可以稍后在设置中更改，或在每次会话中选择不同的目录。
              </p>
            </div>
          )}

          {/* Step 3: Container Runtime */}
          {step === 3 && (
            <div className="space-y-6 pt-8">
              <div>
                <h2 className="text-2xl font-bold">容器运行时</h2>
                <p className="text-muted-foreground mt-1">
                  容器隔离为可选功能。macOS 优先使用 Apple Container，也支持 Docker。
                  编码智能体默认使用本地 CLI 模式，无需容器即可工作。
                </p>
              </div>

              <Card>
                <CardContent className="pt-6 space-y-4">
                  {containerStatus === 'checking' && (
                    <div className="text-center text-muted-foreground py-4">
                      正在检测容器运行时...
                    </div>
                  )}
                  {containerStatus === 'docker' && (
                    <div className="flex items-center gap-3">
                      <Check className="h-5 w-5 text-green-500" />
                      <div>
                        <p className="font-medium">已检测到 Docker</p>
                        <p className="text-xs text-muted-foreground">可用于 API 直连模式的容器隔离执行</p>
                      </div>
                    </div>
                  )}
                  {containerStatus === 'apple-container' && (
                    <div className="flex items-center gap-3">
                      <Check className="h-5 w-5 text-green-500" />
                      <div>
                        <p className="font-medium">已检测到 Apple Container</p>
                        <p className="text-xs text-muted-foreground">macOS 原生容器隔离，无需 Docker</p>
                      </div>
                    </div>
                  )}
                  {containerStatus === 'none' && (
                    <div className="flex items-center gap-3">
                      <Container className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">未检测到容器运行时（可选）</p>
                        <p className="text-xs text-muted-foreground">
                          编码智能体使用本地 CLI 模式，无需容器。如需 API 直连模式的容器隔离，
                          macOS 可安装 Apple Container，其他平台可安装 Docker。
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Step 4: Complete */}
          {step === 4 && (
            <div className="text-center space-y-6 pt-12">
              <div className="flex justify-center">
                <div className="w-20 h-20 rounded-full bg-green-500/10 flex items-center justify-center">
                  <CheckCircle className="h-10 w-10 text-green-500" />
                </div>
              </div>
              <div>
                <h2 className="text-2xl font-bold">设置完成</h2>
                <p className="text-muted-foreground mt-2">
                  一切就绪！开始与 AI 智能体对话吧。
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="border-t border-border p-4 flex justify-between shrink-0">
        <Button
          variant="outline"
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
        >
          <ChevronLeft className="h-4 w-4 mr-2" />
          上一步
        </Button>

        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep(step + 1)}>
            下一步
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        ) : (
          <Button onClick={handleComplete}>
            开始使用
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        )}
      </div>
    </div>
  );
}
