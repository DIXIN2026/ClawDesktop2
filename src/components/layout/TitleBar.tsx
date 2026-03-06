import { Minus, Square, X } from 'lucide-react';

export function TitleBar() {
  const isMac = window.electron?.platform === 'darwin';

  const handleMinimize = () => window.electron?.ipcRenderer.invoke('window:minimize');
  const handleMaximize = () => window.electron?.ipcRenderer.invoke('window:maximize');
  const handleClose = () => window.electron?.ipcRenderer.invoke('window:close');

  return (
    <div className="drag-region flex h-10 shrink-0 items-center justify-between border-b border-border/70 bg-background/90">
      {/* macOS: leave space for traffic lights */}
      {isMac && <div className="w-[72px] shrink-0" />}

      <div className="flex-1 text-center text-xs text-muted-foreground font-medium select-none">
        ClawDesktop2
      </div>

      {/* Windows/Linux: custom window controls */}
      {!isMac && (
        <div className="no-drag flex items-center">
          <button
            onClick={handleMinimize}
            className="flex h-10 w-11 items-center justify-center rounded-md transition-colors hover:bg-muted"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            onClick={handleMaximize}
            className="flex h-10 w-11 items-center justify-center rounded-md transition-colors hover:bg-muted"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleClose}
            className="flex h-10 w-11 items-center justify-center rounded-md transition-colors hover:bg-destructive hover:text-destructive-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {isMac && <div className="w-4 shrink-0" />}
    </div>
  );
}
