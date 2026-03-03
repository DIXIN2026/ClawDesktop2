import { useSettingsStore } from '@/stores/settings';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';

export function GeneralSettings() {
  const { theme, setTheme } = useSettingsStore();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">通用</h2>
        <p className="text-sm text-muted-foreground mt-1">应用偏好与外观设置。</p>
      </div>

      <Separator />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>深色模式</Label>
            <p className="text-xs text-muted-foreground mt-1">切换浅色和深色主题</p>
          </div>
          <Switch
            checked={theme === 'dark'}
            onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
          />
        </div>
      </div>
    </div>
  );
}
