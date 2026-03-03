import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { User, Bot, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ToolCallDisplay } from './ToolCallDisplay';
import { CodePreview } from '@/components/preview/CodePreview';
import type { ChatMessage } from '@/stores/chat';
import type { ComponentPropsWithoutRef } from 'react';

interface MessageBubbleProps {
  message: ChatMessage;
}

function StreamingCursor() {
  return (
    <span className="inline-block w-2 h-4 ml-0.5 bg-foreground animate-pulse rounded-sm" />
  );
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isSystem = message.role === 'system';
  const isStreaming = message.isStreaming === true;

  if (isSystem) {
    return (
      <div className="flex items-start gap-2 mx-auto max-w-2xl px-4 py-2">
        <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="text-sm text-muted-foreground italic">{message.content}</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex gap-3 px-4 py-3',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      {isAssistant && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bot className="h-4 w-4" />
        </div>
      )}

      <div
        className={cn(
          'max-w-[80%] rounded-lg px-4 py-2.5',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted/60',
        )}
      >
        {isUser ? (
          <div className="text-sm whitespace-pre-wrap break-words">
            {message.content}
          </div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none break-words">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                pre({ children, ...props }: ComponentPropsWithoutRef<'pre'>) {
                  return (
                    <pre
                      className="overflow-x-auto rounded-md bg-muted p-3 text-xs"
                      {...props}
                    >
                      {children}
                    </pre>
                  );
                },
                code({
                  children,
                  className,
                  ...props
                }: ComponentPropsWithoutRef<'code'> & { inline?: boolean }) {
                  const isInline = !className;
                  if (isInline) {
                    return (
                      <code
                        className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono"
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  }
                  const langMatch = /language-([\w-]+)/.exec(className ?? '');
                  const language = langMatch?.[1] ?? 'text';
                  return (
                    <CodePreview
                      code={String(children).replace(/\n$/, '')}
                      language={language}
                      className="my-2"
                    />
                  );
                },
                table({ children, ...props }: ComponentPropsWithoutRef<'table'>) {
                  return (
                    <div className="overflow-x-auto">
                      <table className="border-collapse text-sm" {...props}>
                        {children}
                      </table>
                    </div>
                  );
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
            {isStreaming && !message.content && (
              <div className="flex items-center gap-1 text-muted-foreground text-sm">
                <span className="animate-pulse">Thinking</span>
                <span className="animate-bounce" style={{ animationDelay: '0.1s' }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: '0.3s' }}>.</span>
              </div>
            )}
            {isStreaming && message.content && <StreamingCursor />}
          </div>
        )}

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.toolCalls.map((tc) => (
              <ToolCallDisplay key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}
      </div>

      {isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}
