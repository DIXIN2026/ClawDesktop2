/**
 * Preload Script
 * Exposes safe APIs to the renderer process via contextBridge
 * Whitelist pattern per requirements §4.1
 */
declare const require: NodeRequire;
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const VALID_INVOKE_CHANNELS = [
  // Engine
  'engine:status',
  // Settings
  'settings:get',
  'settings:set',
  'mount:allowlist:list',
  'mount:allowlist:add',
  'mount:allowlist:remove',
  // Window controls
  'window:minimize',
  'window:maximize',
  'window:close',
  'window:isMaximized',
  // App
  'app:version',
  'app:name',
  'app:platform',
  'app:getPath',
  'app:quit',
  // Dialog
  'dialog:open',
  'dialog:save',
  'dialog:message',
  // Shell
  'shell:openExternal',
  'shell:showItemInFolder',
  // Providers (§4.1)
  'providers:list',
  'providers:discover',
  'providers:get',
  'providers:save',
  'providers:delete',
  'providers:setApiKey',
  'providers:deleteApiKey',
  'providers:hasApiKey',
  'providers:getApiKeyMasked',
  'providers:setDefault',
  'providers:configure',
  'providers:models',
  'providers:health',
  'providers:cli-status',
  // Sessions
  'sessions:list',
  'sessions:create',
  'sessions:get',
  'sessions:delete',
  'sessions:resume',
  // Chat
  'chat:send',
  'chat:abort',
  'chat:clarification-response',
  'chat:history',
  'chat:switch-model',
  // Agents
  'agents:list',
  'agents:get',
  'agents:update',
  'agents:config',
  'agents:set-model',
  // Skills
  'skills:search',
  'skills:generate',
  'skills:install',
  'skills:install-generated',
  'skills:import-local',
  'skills:uninstall',
  'skills:list',
  // Tasks
  'tasks:list',
  'tasks:create',
  'tasks:update',
  'tasks:delete',
  'tasks:start',
  // Schedule
  'schedule:list',
  'schedule:create',
  'schedule:toggle',
  'schedule:delete',
  'schedule:logs',
  // Channels
  'channels:config',
  'channels:test',
  'channels:list',
  'channels:start',
  'channels:stop',
  // Board (Kanban)
  'board:states',
  'board:transitions',
  'board:issues:list',
  'board:issues:get',
  'board:issues:create',
  'board:issues:update',
  'board:issues:move',
  'board:issues:delete',
  'board:issues:start',
  // Orchestrator
  'orchestrator:execute',
  'orchestrator:cancel',
  'orchestrator:status',
  // Approval
  'approval:response',
  'approval:mode:get',
  'approval:mode:set',
  'approval:rules:list',
  'approval:rules:clear',
  'approval:rules:remove',
  // File
  'file:open',
  'directory:select',
  // Memory
  'memory:search',
  'memory:stats',
  'memory:preferences:list',
  'memory:config:get',
  'memory:config:set',
  'memory:delete',
  'memory:delete-session',
  'memory:preferences:delete',
  'memory:reindex',
  // Git
  'git:status',
  'git:diff',
  'git:commit',
  'git:push',
  'git:stage',
  'git:unstage',
  'git:revert',
  'git:snapshot',
  'git:undo',
  'git:redo',
  'git:worktree-list',
  'git:worktree-create',
  'git:worktree-remove',
] as const;

const VALID_LISTEN_CHANNELS = [
  'engine:event',
  'engine:error',
  'chat:stream',
  'chat:tool-event',
  'navigate',
  'theme:changed',
  'channels:status',
  'agents:stats',
  'approval:request',
  'orchestrator:progress',
] as const;

const electronAPI = {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      if ((VALID_INVOKE_CHANNELS as readonly string[]).includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }
      throw new Error(`Invalid IPC channel: ${channel}`);
    },

    on: (channel: string, callback: (...args: unknown[]) => void) => {
      if ((VALID_LISTEN_CHANNELS as readonly string[]).includes(channel)) {
        const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
          callback(...args);
        };
        ipcRenderer.on(channel, subscription);
        return () => {
          ipcRenderer.removeListener(channel, subscription);
        };
      }
      throw new Error(`Invalid IPC channel: ${channel}`);
    },

    once: (channel: string, callback: (...args: unknown[]) => void) => {
      if ((VALID_LISTEN_CHANNELS as readonly string[]).includes(channel)) {
        ipcRenderer.once(channel, (_event, ...args) => callback(...args));
        return;
      }
      throw new Error(`Invalid IPC channel: ${channel}`);
    },

    off: (channel: string) => {
      if ((VALID_LISTEN_CHANNELS as readonly string[]).includes(channel)) {
        ipcRenderer.removeAllListeners(channel);
      }
    },
  },

  openExternal: (url: string) => {
    return ipcRenderer.invoke('shell:openExternal', url);
  },

  platform: process.platform,

  isDev: process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL,
};

contextBridge.exposeInMainWorld('electron', electronAPI);

export type ElectronAPI = typeof electronAPI;
