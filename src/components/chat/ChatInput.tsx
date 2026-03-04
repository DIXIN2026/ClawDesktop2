import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Square, ImagePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ChatAttachment } from '@/stores/chat';

interface ChatInputProps {
  onSend: (content: string, attachments?: ChatAttachment[]) => void;
  onAbort: () => void;
  isStreaming: boolean;
  disabled?: boolean;
}

const MAX_HEIGHT = 200;
const MIN_HEIGHT = 44;
const MAX_ATTACHMENTS = 4;
const MAX_IMAGE_SIZE_BYTES = 3 * 1024 * 1024;

async function readImageAttachment(file: File): Promise<ChatAttachment> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error(`Invalid image format: ${file.name}`);
  }
  return {
    type: 'image',
    mimeType: match[1] ?? (file.type || 'image/png'),
    data: match[2] ?? '',
    name: file.name,
    size: file.size,
  };
}

export function ChatInput({ onSend, onAbort, isStreaming, disabled }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    if ((trimmed.length === 0 && attachments.length === 0) || disabled) return;
    onSend(trimmed, attachments);
    setValue('');
    setAttachments([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    // Reset height
    const el = textareaRef.current;
    if (el) {
      el.style.height = `${MIN_HEIGHT}px`;
    }
  }, [value, attachments, disabled, onSend]);

  const handlePickImages = useCallback(() => {
    if (disabled || isStreaming) return;
    fileInputRef.current?.click();
  }, [disabled, isStreaming]);

  const handleFilesSelected = useCallback(async (fileList: FileList | null) => {
    if (!fileList) return;
    const files = Array.from(fileList).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return;

    const next: ChatAttachment[] = [];
    for (const file of files) {
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        continue;
      }
      if (attachments.length + next.length >= MAX_ATTACHMENTS) {
        break;
      }
      try {
        next.push(await readImageAttachment(file));
      } catch {
        // Ignore malformed file
      }
    }

    if (next.length > 0) {
      setAttachments((prev) => [...prev, ...next].slice(0, MAX_ATTACHMENTS));
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [attachments.length]);

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

  const canSend = (value.trim().length > 0 || attachments.length > 0) && !disabled && !isStreaming;

  return (
    <div className="border-t border-border p-4">
      <div className="max-w-3xl mx-auto space-y-2">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment, idx) => (
              <div key={`${attachment.name ?? 'image'}-${idx}`} className="relative rounded-md border border-border p-1 bg-background">
                <img
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                  alt={attachment.name ?? `image-${idx + 1}`}
                  className="h-16 w-16 object-cover rounded"
                />
                <button
                  type="button"
                  onClick={() => {
                    setAttachments((prev) => prev.filter((_, i) => i !== idx));
                  }}
                  className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-black/70 text-white flex items-center justify-center"
                  title="Remove image"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-end">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFilesSelected(e.target.files);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0 h-[44px] w-[44px]"
            title="Attach images"
            onClick={handlePickImages}
            disabled={disabled || isStreaming || attachments.length >= MAX_ATTACHMENTS}
          >
            <ImagePlus className="h-4 w-4" />
          </Button>

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
    </div>
  );
}
