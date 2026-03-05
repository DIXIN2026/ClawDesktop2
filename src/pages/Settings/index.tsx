import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Settings, Server, Shield, Info, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GeneralSettings } from './General';
import { ProvidersSettings } from './Providers';
import { SecuritySettings } from './Security';
import { AboutSettings } from './About';
import { MemorySettings } from './Memory';

interface SettingsNav {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SETTINGS_NAV: SettingsNav[] = [
  { label: '通用', path: '/settings', icon: Settings },
  { label: '模型供应商', path: '/settings/providers', icon: Server },
  { label: '记忆', path: '/settings/memory', icon: Brain },
  { label: '安全', path: '/settings/security', icon: Shield },
  { label: '关于', path: '/settings/about', icon: Info },
];

export function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="flex h-full overflow-hidden p-4 gap-3">
      {/* Settings sidebar */}
      <div className="w-56 shrink-0 rounded-2xl border border-border/70 bg-card/60 p-3 space-y-1 shadow-sm backdrop-blur">
        {SETTINGS_NAV.map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={cn(
              'w-full flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all',
              location.pathname === item.path
                ? 'border-primary/30 bg-accent text-accent-foreground shadow-sm'
                : 'border-transparent text-muted-foreground hover:border-border/70 hover:bg-accent/50',
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </div>

      {/* Settings content */}
      <div className="flex-1 overflow-hidden rounded-2xl border border-border/70 bg-background/70 shadow-sm backdrop-blur">
        <div className="h-full overflow-auto p-6">
          <Routes>
            <Route index element={<GeneralSettings />} />
            <Route path="providers" element={<ProvidersSettings />} />
            <Route path="memory" element={<MemorySettings />} />
            <Route path="security" element={<SecuritySettings />} />
            <Route path="about" element={<AboutSettings />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
