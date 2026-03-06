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
        'no-drag flex h-9 w-9 items-center justify-center rounded-xl border transition-colors',
        'hover:border-border/80 hover:bg-accent/60 hover:text-foreground',
        isActive(item.path)
          ? 'sidebar-active-glow border-primary/28 bg-primary/10 text-primary'
          : 'border-transparent text-muted-foreground/90',
      )}
      title={item.label}
    >
      <item.icon className="h-5 w-5" />
    </button>
  );

  return (
    <aside className="h-full w-[var(--sidebar-width)] shrink-0 px-2 py-2">
      <div className="flex h-full flex-col items-center rounded-[20px] border border-border/70 bg-card/85 p-2 shadow-sm">
        <div className="flex flex-1 flex-col items-center gap-1.5 pt-1">
          {NAV_ITEMS.map(renderItem)}
        </div>
        <div className="my-2 h-px w-8 bg-border/70" />
        <div className="flex flex-col items-center gap-1.5 pb-1">
          {BOTTOM_ITEMS.map(renderItem)}
        </div>
      </div>
    </aside>
  );
}
