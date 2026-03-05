import { Outlet } from 'react-router-dom';
import { TitleBar } from './TitleBar';
import { Sidebar } from './Sidebar';

export function MainLayout() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden p-2 pt-1">
        <Sidebar />
        <main className="flex-1 overflow-hidden rounded-2xl border border-border/70 bg-background/85 shadow-sm">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
