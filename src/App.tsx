import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { MainLayout } from './components/layout/MainLayout';
import { ChatPage } from './pages/Chat';
import AgentsPage from './pages/Agents';
import { SkillsPage } from './pages/Skills';
import TasksPage from './pages/Tasks';
import { SchedulePage } from './pages/Schedule';
import { ChannelsPage } from './pages/Channels';
import { SettingsPage } from './pages/Settings';
import { SetupPage } from './pages/Setup';
import { useSettingsStore } from './stores/settings';
import { useEffect } from 'react';

export default function App() {
  const { theme, setupComplete } = useSettingsStore();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('light', theme === 'light');
  }, [theme]);

  // Listen for main process navigation
  useEffect(() => {
    const unsub = window.electron?.ipcRenderer.on('navigate', (path: unknown) => {
      if (typeof path === 'string') {
        window.location.hash = path;
      }
    });
    return () => unsub?.();
  }, []);

  return (
    <HashRouter>
      <Toaster position="top-right" richColors />
      <Routes>
        <Route path="/setup/*" element={<SetupPage />} />
        <Route element={<MainLayout />}>
          <Route
            path="/"
            element={setupComplete ? <ChatPage /> : <Navigate to="/setup" replace />}
          />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/settings/*" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
