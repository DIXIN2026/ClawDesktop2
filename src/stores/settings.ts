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
      language: 'zh-CN',
      setupComplete: false,
      workDirectory: '',
      containerRuntime: 'none',
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      completeSetup: () => set({ setupComplete: true }),
      setWorkDirectory: (dir) => set({ workDirectory: dir }),
      setContainerRuntime: (runtime) => set({ containerRuntime: runtime }),
    }),
    {
      name: 'clawdesktop2-settings',
      version: 2,
      migrate: (persistedState, version) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return persistedState as SettingsState;
        }
        const state = persistedState as SettingsState;
        if (version < 2 && state.language === 'en') {
          return { ...state, language: 'zh-CN' };
        }
        return state;
      },
    },
  ),
);
