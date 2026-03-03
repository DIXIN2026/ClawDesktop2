/**
 * System Tray
 * Creates a system tray icon with context menu
 */
import { Tray, Menu, nativeImage, app } from 'electron';
import type { BrowserWindow } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let tray: Tray | null = null;

function getTrayIcon(): Electron.NativeImage {
  const iconsDir = app.isPackaged
    ? join(process.resourcesPath, 'resources', 'icons')
    : join(__dirname, '../../resources/icons');

  // macOS uses template images (auto dark/light)
  if (process.platform === 'darwin') {
    const icon = nativeImage.createFromPath(join(iconsDir, 'tray-icon.png'));
    icon.setTemplateImage(true);
    return icon;
  }

  return nativeImage.createFromPath(join(iconsDir, 'icon.png'));
}

export function createTray(mainWindow: BrowserWindow): void {
  const icon = getTrayIcon();
  if (icon.isEmpty()) return; // Skip tray if no icon available

  tray = new Tray(icon);
  tray.setToolTip('ClawDesktop2');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow.show();
    }
  });
}

export { tray };
