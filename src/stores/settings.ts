import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  theme: 'light' | 'dark';
  language: string;
  setupComplete: boolean;
  workDirectory: string;
  containerRuntime: 'docker' | 'apple-container' | 'none';
  setTheme: (theme: 'light' | 'dark') => void;
  setLanguage: (language: string) => void;
  completeSetup: () => void;
  setWorkDirectory: (dir: string) => void;
  setContainerRuntime: (runtime: 'docker' | 'apple-container' | 'none') => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      language: 'en',
      setupComplete: false,
      workDirectory: '',
      containerRuntime: 'none',
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      completeSetup: () => set({ setupComplete: true }),
      setWorkDirectory: (dir) => set({ workDirectory: dir }),
      setContainerRuntime: (runtime) => set({ containerRuntime: runtime }),
    }),
    { name: 'clawdesktop2-settings' },
  ),
);
