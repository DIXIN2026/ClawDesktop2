import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Settings, Server, Shield, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GeneralSettings } from './General';
import { ProvidersSettings } from './Providers';
import { SecuritySettings } from './Security';
import { AboutSettings } from './About';

interface SettingsNav {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SETTINGS_NAV: SettingsNav[] = [
  { label: '通用', path: '/settings', icon: Settings },
  { label: '模型供应商', path: '/settings/providers', icon: Server },
  { label: '安全', path: '/settings/security', icon: Shield },
  { label: '关于', path: '/settings/about', icon: Info },
];

export function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="h-full flex overflow-hidden">
      {/* Settings sidebar */}
      <div className="w-48 border-r border-border p-3 space-y-1 shrink-0">
        {SETTINGS_NAV.map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
              location.pathname === item.path
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50',
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </div>

      {/* Settings content */}
      <div className="flex-1 overflow-auto p-6">
        <Routes>
          <Route index element={<GeneralSettings />} />
          <Route path="providers" element={<ProvidersSettings />} />
          <Route path="security" element={<SecuritySettings />} />
          <Route path="about" element={<AboutSettings />} />
        </Routes>
      </div>
    </div>
  );
}
