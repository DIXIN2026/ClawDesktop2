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
    <div className="border-t border-border/60 bg-background/80 px-4 py-5 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl space-y-2">
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

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1">
            {attachments.map((attachment, idx) => (
              <div
                key={`${attachment.name ?? 'image'}-${idx}`}
                className="group relative overflow-hidden rounded-xl border border-border/70 bg-card p-1 shadow-sm"
              >
                <img
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                  alt={attachment.name ?? `image-${idx + 1}`}
                  className="h-16 w-16 rounded-lg object-cover"
                />
                <button
                  type="button"
                  onClick={() => {
                    setAttachments((prev) => prev.filter((_, i) => i !== idx));
                  }}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  title="移除图片"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card/80 px-3 py-3 shadow-sm">
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入你的需求，@上下文，或 /命令"
              disabled={disabled}
              rows={1}
              className={cn(
                'flex w-full resize-none overflow-y-auto rounded-xl border-0 bg-transparent px-1 py-1 text-sm',
                'placeholder:text-muted-foreground focus-visible:outline-none',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
              style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/70 pt-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 rounded-lg"
                title="添加图片"
                onClick={handlePickImages}
                disabled={disabled || isStreaming || attachments.length >= MAX_ATTACHMENTS}
              >
                <ImagePlus className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground">
                {attachments.length > 0
                  ? `已添加 ${attachments.length}/${MAX_ATTACHMENTS} 张图片`
                  : '支持图片输入'}
              </span>
            </div>
            {isStreaming ? (
              <Button
                onClick={onAbort}
                size="sm"
                variant="destructive"
                className="h-8 rounded-lg px-3"
                title="停止生成"
              >
                <Square className="mr-1.5 h-3.5 w-3.5" />
                停止
              </Button>
            ) : (
              <Button
                onClick={handleSend}
                size="sm"
                className="h-8 rounded-lg px-3"
                disabled={!canSend}
                title="发送消息"
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                发送
              </Button>
            )}
          </div>
        </div>
        <div className="px-1 text-[11px] text-muted-foreground">
          Enter 发送，Shift+Enter 换行
        </div>
      </div>
    </div>
  );
}
