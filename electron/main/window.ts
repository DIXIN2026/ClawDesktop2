/**
 * Window state persistence
 * Saves and restores window position, size, and maximized state
 */
import type { BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';

interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

function getStatePath(): string {
  const userDataPath = app.getPath('userData');
  return join(userDataPath, 'window-state.json');
}

export function restoreWindowState(): WindowState | null {
  try {
    const data = readFileSync(getStatePath(), 'utf-8');
    return JSON.parse(data) as WindowState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[WARN] Failed to restore window state:', err instanceof Error ? err.message : String(err));
    }
    return null;
  }
}

export function saveWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;

  const isMaximized = win.isMaximized();
  const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();

  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized,
  };

  try {
    const dir = app.getPath('userData');
    mkdirSync(dir, { recursive: true });
    writeFileSync(getStatePath(), JSON.stringify(state));
  } catch (err) {
    console.warn('[WARN] Failed to save window state:', err instanceof Error ? err.message : String(err));
  }
}
