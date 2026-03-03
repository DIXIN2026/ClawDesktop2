interface ElectronAPI {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    on: (channel: string, callback: (...args: unknown[]) => void) => (() => void) | undefined;
    once: (channel: string, callback: (...args: unknown[]) => void) => void;
    off: (channel: string) => void;
  };
  openExternal: (url: string) => Promise<void>;
  platform: NodeJS.Platform;
  isDev: boolean;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}

export {};
