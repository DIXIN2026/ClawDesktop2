import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  onSend: (content: string) => void;
  onAbort: () => void;
  isStreaming: boolean;
  disabled?: boolean;
}

const MAX_HEIGHT = 200;
const MIN_HEIGHT = 44;

export function ChatInput({ onSend, onAbort, isStreaming, disabled }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    // Reset height
    const el = textareaRef.current;
    if (el) {
      el.style.height = `${MIN_HEIGHT}px`;
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (isStreaming) return;
        handleSend();
      }
    },
    [handleSend, isStreaming],
  );

  const canSend = value.trim().length > 0 && !disabled && !isStreaming;

  return (
    <div className="border-t border-border p-4">
      <div className="max-w-3xl mx-auto flex gap-2 items-end">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
            disabled={disabled}
            rows={1}
            className={cn(
              'flex w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm',
              'ring-offset-background placeholder:text-muted-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'resize-none overflow-y-auto',
            )}
            style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT }}
          />
        </div>

        {isStreaming ? (
          <Button
            onClick={onAbort}
            size="icon"
            variant="destructive"
            className="shrink-0 h-[44px] w-[44px]"
            title="Stop generation"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={handleSend}
            size="icon"
            className="shrink-0 h-[44px] w-[44px]"
            disabled={!canSend}
            title="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
