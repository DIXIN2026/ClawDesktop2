/**
 * Design Preview Server
 * Manages Vite Dev Server lifecycle for design agent preview
 */
import { spawn, execSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const PORT_RANGE_START = 15173;
const PORT_RANGE_END = 15183;

interface PreviewServer {
  process: ChildProcess;
  port: number;
  url: string;
  directory: string;
}

let activeServer: PreviewServer | null = null;

function findAvailablePort(): number {
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    try {
      execSync(`lsof -i :${port}`, { encoding: 'utf-8', timeout: 2000 });
    } catch {
      // Port is available (lsof exits with error when no process is found)
      return port;
    }
  }
  throw new Error(`No available ports in range ${PORT_RANGE_START}-${PORT_RANGE_END}`);
}

function initDesignTemplate(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const indexHtml = join(dir, 'index.html');
  if (!existsSync(indexHtml)) {
    writeFileSync(indexHtml, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Design Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
`);
  }

  const mainTsx = join(dir, 'main.tsx');
  if (!existsSync(mainTsx)) {
    writeFileSync(mainTsx, `import React from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Design Preview</h1>
      <p className="text-gray-600 mt-2">Components will appear here when generated.</p>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
`);
  }
}

export async function startPreviewServer(directory: string): Promise<string> {
  // Stop existing server first
  await stopPreviewServer();

  const dir = join(directory, 'design');
  initDesignTemplate(dir);

  const port = findAvailablePort();

  const proc = spawn('npx', ['vite', '--port', String(port), '--host', 'localhost'], {
    cwd: dir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0' },
  });

  const url = `http://localhost:${port}`;

  activeServer = {
    process: proc,
    port,
    url,
    directory: dir,
  };

  proc.on('error', (err) => {
    console.error('[DesignPreview] Server error:', err.message);
    activeServer = null;
  });

  proc.on('close', () => {
    if (activeServer?.process === proc) {
      activeServer = null;
    }
  });

  // Wait for server to be ready
  await waitForServer(url, 15000);

  return url;
}

export async function stopPreviewServer(): Promise<void> {
  if (activeServer) {
    const proc = activeServer.process;
    activeServer = null;

    if (!proc.killed) {
      proc.kill('SIGTERM');
      // Give it 3s to gracefully terminate
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
          resolve();
        }, 3000);
        proc.on('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}

export function getPreviewServer(): PreviewServer | null {
  return activeServer;
}

export type DeviceSize = 'mobile' | 'tablet' | 'desktop' | 'full';

export function getDeviceDimensions(size: DeviceSize): { width: number; height: number } {
  switch (size) {
    case 'mobile': return { width: 375, height: 812 };
    case 'tablet': return { width: 768, height: 1024 };
    case 'desktop': return { width: 1440, height: 900 };
    case 'full': return { width: 1920, height: 1080 };
  }
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const interval = 500;

  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`Preview server did not start within ${timeoutMs}ms`);
}
