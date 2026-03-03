import { useState, useCallback } from 'react';
import { Copy, Check, FileCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────

interface CodePreviewProps {
  code: string;
  language: string;
  filename?: string;
  className?: string;
}

// ── Minimal keyword highlighting ───────────────────────────────────

const KEYWORD_PATTERNS: Record<string, RegExp> = {
  js: /\b(const|let|var|function|return|if|else|for|while|import|export|from|default|class|async|await|new|this|typeof|null|undefined|true|false|try|catch|throw)\b/g,
  ts: /\b(const|let|var|function|return|if|else|for|while|import|export|from|default|class|async|await|new|this|typeof|null|undefined|true|false|type|interface|try|catch|throw)\b/g,
  py: /\b(def|class|import|from|return|if|elif|else|for|while|in|not|and|or|True|False|None|try|except|with|as|yield|async|await|lambda)\b/g,
  go: /\b(func|package|import|return|if|else|for|range|var|const|type|struct|interface|map|chan|go|defer|select|case|switch|nil|true|false)\b/g,
  rust: /\b(fn|let|mut|pub|use|mod|struct|enum|impl|trait|self|Self|return|if|else|for|while|loop|match|true|false|None|Some|Ok|Err)\b/g,
};

function resolvePattern(language: string): RegExp | null {
  const lang = language.toLowerCase();
  if (lang === 'typescript' || lang === 'tsx') return KEYWORD_PATTERNS['ts'] ?? null;
  if (lang === 'javascript' || lang === 'jsx') return KEYWORD_PATTERNS['js'] ?? null;
  if (lang === 'python') return KEYWORD_PATTERNS['py'] ?? null;
  if (lang === 'golang') return KEYWORD_PATTERNS['go'] ?? null;
  return KEYWORD_PATTERNS[lang] ?? null;
}

// ── Component ──────────────────────────────────────────────────────

export function CodePreview({ code, language, filename, className }: CodePreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  const lines = code.split('\n');
  const pattern = resolvePattern(language);

  return (
    <div className={cn('rounded-lg border bg-zinc-950 text-zinc-200 overflow-hidden', className)}>
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <FileCode className="h-3.5 w-3.5" />
          {filename && <span className="font-mono">{filename}</span>}
          {!filename && <span>{language}</span>}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-400" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {/* Code content */}
      <ScrollArea className="max-h-[500px]">
        <pre className="p-3 text-sm leading-relaxed">
          <code>
            {lines.map((line, idx) => (
              <div key={idx} className="flex">
                {/* Line number */}
                <span className="inline-block w-10 pr-4 text-right text-zinc-600 select-none shrink-0 font-mono text-xs leading-relaxed">
                  {idx + 1}
                </span>
                {/* Line content */}
                <span className="flex-1 font-mono text-xs leading-relaxed whitespace-pre">
                  {pattern
                    ? highlightLine(line, pattern)
                    : line || ' '}
                </span>
              </div>
            ))}
          </code>
        </pre>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}

// ── Highlight helper ───────────────────────────────────────────────

function highlightLine(line: string, pattern: RegExp): React.ReactNode {
  if (!line) return ' ';

  // Reset regex state for global patterns
  const regex = new RegExp(pattern.source, pattern.flags);
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }
    // Highlighted keyword
    parts.push(
      <span key={match.index} className="text-purple-400 font-semibold">
        {match[0]}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }

  return parts.length > 0 ? parts : line;
}
