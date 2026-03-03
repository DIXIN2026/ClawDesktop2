/**
 * Electron Main Process Entry
 * Manages window creation, system tray, and IPC handlers
 */
import { app, BrowserWindow, dialog, session, shell } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { registerIpcHandlers } from './ipc-handlers.js';
import { createTray } from './tray.js';
import { createMenu } from './menu.js';
import { restoreWindowState, saveWindowState } from './window.js';
import { initDatabase, closeDatabase } from '../utils/db.js';
import { cleanupOrphans } from '../engine/container-runtime.js';
import { setApprovalWindow } from '../security/approval.js';
import { registerChannels } from '../channels/registration.js';
import { getChannelManager } from '../channels/manager.js';
import { createChannelAgentRouter } from '../engine/channel-agent-router.js';
import { stopPreviewServer } from '../agents/design-preview.js';
import { TaskScheduler } from '../engine/task-scheduler.js';
import { createAgentExecutor } from '../engine/agent-executor.js';
import type { ScheduledTaskRow } from '../utils/db.js';
import { getChatSession } from '../utils/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let taskScheduler: TaskScheduler | null = null;
let stopChannelRouter: (() => void) | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const savedState = restoreWindowState();

  const win = new BrowserWindow({
    width: savedState?.width ?? 1400,
    height: savedState?.height ?? 900,
    x: savedState?.x,
    y: savedState?.y,
    minWidth: 960,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    frame: isMac,
    show: false,
  });

  win.once('ready-to-show', () => {
    if (savedState?.isMaximized) {
      win.maximize();
    }
    win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only allow http/https URLs to be opened externally
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url).catch((err) => {
          console.error(`[ERROR] Failed to open external URL "${url}":`, err);
        });
      } else {
        console.warn(`[SECURITY] Blocked opening non-http URL: ${url}`);
      }
    } catch {
      console.warn(`[SECURITY] Blocked opening invalid URL: ${url}`);
    }
    return { action: 'deny' };
  });

  // Save window state on resize/move
  const saveState = () => saveWindowState(win);
  win.on('resize', saveState);
  win.on('move', saveState);
  win.on('maximize', saveState);
  win.on('unmaximize', saveState);

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, '../../dist/index.html'));
  }

  return win;
}

async function initialize(): Promise<void> {
  // Inject Content-Security-Policy headers
  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:*; object-src 'none'; base-uri 'self'"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  // Initialize SQLite database (WAL mode, creates tables if needed)
  initDatabase();

  // Clean up orphaned containers from previous crash/abnormal exit
  cleanupOrphans().catch((err) => {
    console.warn('[STARTUP] Orphan container cleanup failed:', err instanceof Error ? err.message : String(err));
  });

  createMenu();

  mainWindow = createWindow();

  createTray(mainWindow);

  registerIpcHandlers(mainWindow);

  // Connect approval system to the main window for dialog rendering
  setApprovalWindow(mainWindow);

  // Register messaging channels (Feishu, QQ)
  registerChannels();

  // Bridge incoming channel messages to the same agent executor pipeline.
  const channelRouterExecutor = createAgentExecutor();
  const channelRouter = createChannelAgentRouter({
    channelManager: getChannelManager(),
    executor: channelRouterExecutor,
    getWorkDirectory: (sessionId) => {
      const session = getChatSession(sessionId);
      return session?.work_directory ?? process.cwd();
    },
    getAgentConfig: (sessionId) => {
      const session = getChatSession(sessionId);
      const [providerId, modelId] = (session?.current_model ?? '').split('/');
      if (providerId && modelId) {
        return {
          agentType: (session?.agent_id as 'coding' | 'requirements' | 'design' | 'testing') ?? 'coding',
          mode: 'api',
          providerId,
          modelId,
        };
      }
      return {
        agentType: (session?.agent_id as 'coding' | 'requirements' | 'design' | 'testing') ?? 'coding',
        mode: 'cli',
      };
    },
  });
  stopChannelRouter = channelRouter.start();

  // Start task scheduler
  const schedulerExecutor = createAgentExecutor();
  taskScheduler = new TaskScheduler({
    pollIntervalMs: 30_000,
    executeTask: async (task: ScheduledTaskRow) => {
      const agentType = (task.agent_type ?? 'coding') as 'coding' | 'requirements' | 'design' | 'testing';
      let output = '';
      await new Promise<void>((resolve, reject) => {
        schedulerExecutor.execute({
          sessionId: `sched-${task.id}-${Date.now()}`,
          prompt: task.prompt ?? '',
          workDirectory: task.work_directory ?? process.cwd(),
          agentType,
          mode: 'cli',
          onEvent: (event) => {
            if (event.type === 'text_delta' && event.content) {
              output += event.content;
            }
            if (event.type === 'turn_end') resolve();
            if (event.type === 'error') reject(new Error(event.errorMessage ?? 'Task execution error'));
          },
        }).catch(reject);
      });
      return { status: 'success', result: output.slice(0, 500) };
    },
  });
  taskScheduler.start();

  // On macOS, hide window on close (close-to-tray); on other platforms, quit
  mainWindow.on('close', (event) => {
    if (!isQuitting && process.platform === 'darwin') {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await initialize();
  } catch (err) {
    console.error('[FATAL] Failed to initialize application:', err);
    dialog.showErrorBox(
      '初始化失败',
      `ClawDesktop2 启动失败：${err instanceof Error ? err.message : String(err)}`,
    );
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      registerIpcHandlers(mainWindow);
      createTray(mainWindow);
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopChannelRouter?.();
  stopChannelRouter = null;
  taskScheduler?.stop();
  void stopPreviewServer().catch((err) => {
    console.warn('[QUIT] Stop preview server failed:', err instanceof Error ? err.message : String(err));
  });
  cleanupOrphans().catch((err) => {
    console.warn('[QUIT] Orphan container cleanup failed:', err instanceof Error ? err.message : String(err));
  });
  closeDatabase();
});
