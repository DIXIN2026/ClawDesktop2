import { useEffect, useState } from 'react';
import { ExternalLink, Github, BookOpen, RefreshCw } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ipc } from '@/services/ipc';
import { useSettingsStore } from '@/stores/settings';

// ── Types ──────────────────────────────────────────────────────────

interface SystemInfo {
  version: string;
  platform: string;
  containerRuntime: string;
  nodeVersion: string;
}

// ── Link config ────────────────────────────────────────────────────

interface ExternalLinkItem {
  label: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

const LINKS: ExternalLinkItem[] = [
  { label: 'GitHub', url: 'https://github.com/nicepkg/openclaw', icon: Github },
  { label: '文档', url: 'https://docs.openclaw.ai', icon: BookOpen },
];

// ── Component ──────────────────────────────────────────────────────

export function AboutSettings() {
  const { containerRuntime } = useSettingsStore();
  const [info, setInfo] = useState<SystemInfo>({
    version: '',
    platform: '',
    containerRuntime: containerRuntime,
    nodeVersion: '',
  });
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    // Fetch version and platform in parallel
    const fetchInfo = async () => {
      const [version, platform] = await Promise.all([
        ipc.getVersion().catch(() => 'unknown'),
        ipc.getPlatform().catch(() => window.electron?.platform ?? 'unknown'),
      ]);

      setInfo({
        version: version || '0.1.0',
        platform: String(platform),
        containerRuntime,
        nodeVersion: typeof process !== 'undefined' ? process.version ?? 'N/A' : 'N/A',
      });
    };

    void fetchInfo();
  }, [containerRuntime]);

  // Container runtime status display
  const runtimeStatus: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
    docker: { label: 'Docker', variant: 'default' },
    'apple-container': { label: 'Apple Container', variant: 'default' },
    none: { label: '未配置', variant: 'secondary' },
  };

  const currentRuntime = runtimeStatus[info.containerRuntime] ?? runtimeStatus['none'];

  function handleCheckUpdate() {
    setChecking(true);
    // Simulate update check
    setTimeout(() => {
      setChecking(false);
    }, 1500);
  }

  function openExternal(url: string) {
    if (window.electron?.openExternal) {
      void window.electron.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  }

  // ── Info rows ──────────────────────────────────────────────────

  const infoRows: { label: string; value: React.ReactNode }[] = [
    { label: '应用名称', value: 'ClawDesktop2' },
    { label: '版本', value: info.version || '0.1.0' },
    { label: '平台', value: info.platform || 'unknown' },
    { label: 'Node 版本', value: info.nodeVersion },
    {
      label: '容器运行时',
      value: (
        <Badge variant={currentRuntime.variant}>
          {currentRuntime.label}
        </Badge>
      ),
    },
    { label: '架构', value: '多智能体桌面应用' },
  ];

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">关于</h2>
        <p className="text-sm text-muted-foreground mt-1">应用信息与相关链接。</p>
      </div>

      <Separator />

      {/* System info */}
      <div className="space-y-3">
        {infoRows.map((row) => (
          <div key={row.label} className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">{row.label}</span>
            <span>{row.value}</span>
          </div>
        ))}
      </div>

      <Separator />

      {/* Check for updates */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">检查更新</div>
          <p className="text-xs text-muted-foreground mt-0.5">当前版本: {info.version || '0.1.0'}</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleCheckUpdate} disabled={checking}>
          <RefreshCw className={`h-4 w-4 mr-1 ${checking ? 'animate-spin' : ''}`} />
          {checking ? '检查中...' : '检查更新'}
        </Button>
      </div>

      <Separator />

      {/* Links */}
      <div className="space-y-3">
        <div className="text-sm font-medium">相关链接</div>
        <div className="flex flex-wrap gap-2">
          {LINKS.map((link) => (
            <Button
              key={link.url}
              variant="outline"
              size="sm"
              onClick={() => openExternal(link.url)}
            >
              <link.icon className="h-4 w-4 mr-1.5" />
              {link.label}
              <ExternalLink className="h-3 w-3 ml-1.5 text-muted-foreground" />
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
