import { useLocation, useNavigate } from 'react-router-dom';
import {
  MessageSquare,
  Bot,
  Puzzle,
  ListTodo,
  Clock,
  Radio,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  path: string;
}

const NAV_ITEMS: NavItem[] = [
  { icon: MessageSquare, label: '对话', path: '/' },
  { icon: Bot, label: '智能体', path: '/agents' },
  { icon: Puzzle, label: '技能', path: '/skills' },
  { icon: ListTodo, label: '任务', path: '/tasks' },
  { icon: Clock, label: '定时', path: '/schedule' },
  { icon: Radio, label: '渠道', path: '/channels' },
];

const BOTTOM_ITEMS: NavItem[] = [
  { icon: Settings, label: '设置', path: '/settings' },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const renderItem = (item: NavItem) => (
    <button
      key={item.path}
      onClick={() => navigate(item.path)}
      className={cn(
        'no-drag w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
        'hover:bg-accent',
        isActive(item.path)
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground',
      )}
      title={item.label}
    >
      <item.icon className="h-5 w-5" />
    </button>
  );

  return (
    <div className="w-[var(--sidebar-width)] h-full flex flex-col items-center py-2 gap-1 border-r border-border bg-background/50 shrink-0">
      {/* Top navigation */}
      <div className="flex flex-col items-center gap-1 flex-1 pt-1">
        {NAV_ITEMS.map(renderItem)}
      </div>

      {/* Bottom navigation */}
      <div className="flex flex-col items-center gap-1 pb-1">
        {BOTTOM_ITEMS.map(renderItem)}
      </div>
    </div>
  );
}
