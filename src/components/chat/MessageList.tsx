import { useEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from '@/stores/chat';

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
}

export function MessageList({ messages, isStreaming }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const streamScrollFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    if (!isStreaming) {
      if (streamScrollFrameRef.current !== null) {
        cancelAnimationFrame(streamScrollFrameRef.current);
        streamScrollFrameRef.current = null;
      }
      return;
    }

    const tick = () => {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      streamScrollFrameRef.current = requestAnimationFrame(tick);
    };
    streamScrollFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (streamScrollFrameRef.current !== null) {
        cancelAnimationFrame(streamScrollFrameRef.current);
        streamScrollFrameRef.current = null;
      }
    };
  }, [isStreaming]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3 px-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <MessageSquare className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-foreground">
              开始对话
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              发送一条消息开始与 AI 智能体对话。你可以提问、请求修改代码，
              或让它协助处理你的项目。
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div ref={containerRef} className="max-w-3xl mx-auto py-4 space-y-1">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
