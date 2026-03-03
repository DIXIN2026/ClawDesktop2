import { useState } from 'react';
import { Monitor, Tablet, Smartphone, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────

type DeviceSize = 'mobile' | 'tablet' | 'desktop' | 'full';

interface DesignPreviewProps {
  url: string;
  deviceSize?: DeviceSize;
  className?: string;
}

// ── Device size config ─────────────────────────────────────────────

interface DeviceConfig {
  value: DeviceSize;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  width: string;
  height: string;
}

const DEVICES: DeviceConfig[] = [
  { value: 'mobile', label: '手机', icon: Smartphone, width: '375px', height: '667px' },
  { value: 'tablet', label: '平板', icon: Tablet, width: '768px', height: '1024px' },
  { value: 'desktop', label: '桌面', icon: Monitor, width: '1280px', height: '800px' },
  { value: 'full', label: '全屏', icon: Maximize2, width: '100%', height: '100%' },
];

// ── Component ──────────────────────────────────────────────────────

export function DesignPreview({ url, deviceSize = 'desktop', className }: DesignPreviewProps) {
  const [currentSize, setCurrentSize] = useState<DeviceSize>(deviceSize);
  const device = DEVICES.find((d) => d.value === currentSize) ?? DEVICES[2];

  return (
    <div className={cn('flex flex-col rounded-lg border bg-muted/30 overflow-hidden', className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-background">
        <div className="flex items-center gap-1">
          {DEVICES.map((d) => (
            <Button
              key={d.value}
              variant={currentSize === d.value ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-2"
              onClick={() => setCurrentSize(d.value)}
              title={d.label}
            >
              <d.icon className="h-3.5 w-3.5" />
            </Button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {device.value === 'full' ? '100%' : `${device.width} x ${device.height}`}
        </span>
      </div>

      {/* Preview area */}
      <div className="flex-1 flex items-center justify-center p-4 bg-zinc-100 dark:bg-zinc-900 min-h-[400px]">
        <div
          className={cn(
            'bg-white dark:bg-zinc-950 rounded-md shadow-lg overflow-hidden transition-all duration-300',
            currentSize === 'full' && 'w-full h-full',
          )}
          style={
            currentSize !== 'full'
              ? {
                  width: device.width,
                  height: device.height,
                  maxWidth: '100%',
                  maxHeight: '70vh',
                }
              : undefined
          }
        >
          <iframe
            src={url}
            title="Design Preview"
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-popups"
          />
        </div>
      </div>
    </div>
  );
}
