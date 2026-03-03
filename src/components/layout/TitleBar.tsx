import { Minus, Square, X } from 'lucide-react';

export function TitleBar() {
  const isMac = window.electron?.platform === 'darwin';

  const handleMinimize = () => window.electron?.ipcRenderer.invoke('window:minimize');
  const handleMaximize = () => window.electron?.ipcRenderer.invoke('window:maximize');
  const handleClose = () => window.electron?.ipcRenderer.invoke('window:close');

  return (
    <div className="drag-region h-10 flex items-center justify-between bg-background border-b border-border shrink-0">
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
            className="h-10 w-11 flex items-center justify-center hover:bg-muted transition-colors"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            onClick={handleMaximize}
            className="h-10 w-11 flex items-center justify-center hover:bg-muted transition-colors"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleClose}
            className="h-10 w-11 flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {isMac && <div className="w-4 shrink-0" />}
    </div>
  );
}
