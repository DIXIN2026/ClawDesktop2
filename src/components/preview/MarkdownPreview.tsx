import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

// ── Component ──────────────────────────────────────────────────────

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  return (
    <div
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none',
        // Heading styles
        'prose-headings:font-semibold prose-headings:tracking-tight',
        // Link styles
        'prose-a:text-primary prose-a:no-underline hover:prose-a:underline',
        // Code block styles
        'prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-zinc-800 prose-pre:rounded-lg',
        'prose-code:text-pink-400 prose-code:before:content-none prose-code:after:content-none',
        // Table styles
        'prose-table:border-collapse prose-th:border prose-th:border-border prose-th:px-3 prose-th:py-2',
        'prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2',
        // Image styles
        'prose-img:rounded-lg prose-img:border prose-img:border-border',
        className,
      )}
    >
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  );
}
