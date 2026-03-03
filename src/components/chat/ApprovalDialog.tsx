import { useState, useEffect, useRef } from 'react';
import { ShieldAlert, Clock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { ApprovalRequest } from '@/stores/chat';

interface ApprovalDialogProps {
  approval: ApprovalRequest;
  onRespond: (approved: boolean) => void;
}

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function ApprovalDialog({ approval, onRespond }: ApprovalDialogProps) {
  const [remainingMs, setRemainingMs] = useState(TIMEOUT_MS);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const respondedRef = useRef(false);

  useEffect(() => {
    respondedRef.current = false;
    const startTime = Date.now();
    setRemainingMs(TIMEOUT_MS);

    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, TIMEOUT_MS - elapsed);
      setRemainingMs(remaining);

      if (remaining <= 0 && !respondedRef.current) {
        respondedRef.current = true;
        onRespond(false);
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [approval.id, onRespond]);

  const handleRespond = (approved: boolean) => {
    if (respondedRef.current) return;
    respondedRef.current = true;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    onRespond(approved);
  };

  const remainingSec = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(remainingSec / 60);
  const seconds = remainingSec % 60;
  const progressPercent = (remainingMs / TIMEOUT_MS) * 100;

  return (
    <Dialog open onOpenChange={() => handleRespond(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-yellow-500" />
            Approval Required
          </DialogTitle>
          <DialogDescription>
            The agent is requesting permission to perform the following action.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Action */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1">
              Action
            </div>
            <div className="rounded-md bg-muted p-3 text-sm font-mono">
              {approval.action}
            </div>
          </div>

          {/* Details */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1">
              Details
            </div>
            <pre className="rounded-md bg-muted p-3 text-xs font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
              {approval.details}
            </pre>
          </div>

          {/* Countdown */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>
                Auto-deny in {minutes}:{seconds.toString().padStart(2, '0')}
              </span>
            </div>
            <Progress value={progressPercent} className="h-1.5" />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="destructive"
            onClick={() => handleRespond(false)}
          >
            Deny
          </Button>
          <Button onClick={() => handleRespond(true)}>
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
