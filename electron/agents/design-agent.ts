/**
 * Design Agent
 * 6-pass generation pipeline:
 * 1. Page structure design (JSON)
 * 2. Component library context (shadcn/ui)
 * 3. Component code generation (React + shadcn/ui + Tailwind)
 * 4. AST validation + AI repair loop
 * 5. Write files + preview
 * 6. Visual self-check (P1)
 */
import type { CodingAgentEvent } from '../providers/types.js';

export type DesignPass =
  | 'structure'
  | 'context'
  | 'codegen'
  | 'validate'
  | 'preview'
  | 'visual-check';

export interface PageStructure {
  name: string;
  route: string;
  layout: string;
  components: ComponentSpec[];
}

export interface ComponentSpec {
  name: string;
  type: string;
  props: Record<string, string>;
  children?: ComponentSpec[];
  description: string;
}

export interface DesignContext {
  userInput: string;
  pageStructure?: PageStructure;
  componentLibraryContext?: string;
  generatedCode?: Map<string, string>; // filename → code
  validationErrors?: Array<{ file: string; error: string; line?: number }>;
  previewUrl?: string;
  currentPass: DesignPass;
}

export interface DesignAgentConfig {
  onEvent: (event: CodingAgentEvent) => void;
  onPassChange: (pass: DesignPass) => void;
  callLLM: (params: {
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }) => AsyncIterable<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  startPreview?: (dir: string) => Promise<string>; // returns preview URL
  validateCode?: (code: string, filename: string) => Promise<Array<{ error: string; line?: number }>>;
}

const STRUCTURE_PROMPT = `你是一个 UI/UX 设计专家和前端架构师。
根据用户的需求描述，设计页面结构。

输出严格的 JSON 格式：
{
  "name": "页面名称",
  "route": "/path",
  "layout": "描述整体布局",
  "components": [
    {
      "name": "ComponentName",
      "type": "组件类型 (container/form/list/card/modal/nav/...)",
      "props": { "key": "value type" },
      "children": [],
      "description": "组件用途描述"
    }
  ]
}`;

const CONTEXT_PROMPT = `你是一个 shadcn/ui 和 Tailwind CSS 专家。
根据以下页面结构，列出每个组件需要使用的:
1. shadcn/ui 基础组件 (Button, Card, Input, Dialog 等)
2. Tailwind CSS 类名方案
3. Radix UI 原语 (如果需要)
4. lucide-react 图标建议

输出格式：
## ComponentName
- shadcn/ui: Button, Card, ...
- 布局: flex flex-col gap-4 ...
- 图标: IconName from lucide-react
- 交互: onClick, onChange, ...`;

const CODEGEN_PROMPT = `你是一个资深 React + TypeScript 开发者。
根据以下页面结构和组件库上下文，生成完整的 React 组件代码。

技术栈要求:
- React 19 + TypeScript
- shadcn/ui 组件 (从 @/components/ui/ 导入)
- Tailwind CSS 4 样式
- lucide-react 图标
- 不使用 any 类型
- 使用函数组件 + hooks
- 每个组件单独一个文件

每个文件用以下格式输出:
\`\`\`tsx filename="ComponentName.tsx"
// 代码内容
\`\`\``;

const VALIDATE_PROMPT = `你是一个代码审查专家。以下 React/TypeScript 代码有语法错误。
请修复所有错误并返回完整的修复后代码。

错误信息:
{errors}

原始代码:
{code}

输出修复后的完整代码：`;

/**
 * Validate that a filename from LLM output is a safe relative path.
 * Blocks path traversal (../), absolute paths, and null bytes.
 */
function isSafeFilename(filename: string): boolean {
  if (!filename || filename.length > 255) return false;
  // Block null bytes, absolute paths, and traversal
  if (filename.includes('\0')) return false;
  if (filename.startsWith('/') || filename.startsWith('\\')) return false;
  if (/\.\.[/\\]/.test(filename)) return false;
  // Block Windows-style absolute paths (C:\, D:\)
  if (/^[a-zA-Z]:[/\\]/.test(filename)) return false;
  // Only allow reasonable characters for component filenames
  if (!/^[\w./-]+\.tsx?$/.test(filename)) return false;
  return true;
}

export class DesignAgent {
  private context: DesignContext;
  private config: DesignAgentConfig;
  private aborted = false;

  constructor(userInput: string, config: DesignAgentConfig) {
    this.context = {
      userInput,
      generatedCode: new Map(),
      currentPass: 'structure',
    };
    this.config = config;
  }

  async run(): Promise<DesignContext> {
    const passes: DesignPass[] = ['structure', 'context', 'codegen', 'validate', 'preview', 'visual-check'];

    for (const pass of passes) {
      if (this.aborted) break;

      this.context.currentPass = pass;
      this.config.onPassChange(pass);
      this.config.onEvent({
        type: 'tool_start',
        toolName: `design:${pass}`,
        timestamp: Date.now(),
      });

      const startTime = Date.now();

      switch (pass) {
        case 'structure':
          await this.runStructurePass();
          break;
        case 'context':
          await this.runContextPass();
          break;
        case 'codegen':
          await this.runCodegenPass();
          break;
        case 'validate':
          await this.runValidatePass();
          break;
        case 'preview':
          await this.runPreviewPass();
          break;
        case 'visual-check':
          await this.runVisualCheckPass();
          break;
      }

      this.config.onEvent({
        type: 'tool_end',
        toolName: `design:${pass}`,
        content: `Pass completed in ${Date.now() - startTime}ms`,
        timestamp: Date.now(),
      });
    }

    this.config.onEvent({ type: 'turn_end', timestamp: Date.now() });
    return this.context;
  }

  abort(): void {
    this.aborted = true;
  }

  private async collectStream(system: string, userContent: string): Promise<string> {
    let result = '';
    const stream = this.config.callLLM({
      system,
      messages: [{ role: 'user', content: userContent }],
    });
    for await (const chunk of stream) {
      if (this.aborted) break;
      result += chunk;
      this.config.onEvent({
        type: 'text_delta',
        content: chunk,
        timestamp: Date.now(),
      });
    }
    return result;
  }

  private async runStructurePass(): Promise<void> {
    const raw = await this.collectStream(STRUCTURE_PROMPT, this.context.userInput);

    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        this.context.pageStructure = JSON.parse(jsonMatch[0]) as PageStructure;
      }
    } catch (err) {
      this.config.onEvent({
        type: 'error',
        errorMessage: `Failed to parse page structure: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      });
    }
  }

  private async runContextPass(): Promise<void> {
    if (!this.context.pageStructure) {
      this.config.onEvent({
        type: 'error',
        errorMessage: 'No page structure available for context pass',
        timestamp: Date.now(),
      });
      return;
    }

    this.context.componentLibraryContext = await this.collectStream(
      CONTEXT_PROMPT,
      JSON.stringify(this.context.pageStructure, null, 2),
    );
  }

  private async runCodegenPass(): Promise<void> {
    if (!this.context.pageStructure || !this.context.componentLibraryContext) {
      this.config.onEvent({
        type: 'error',
        errorMessage: 'Missing structure or context for code generation',
        timestamp: Date.now(),
      });
      return;
    }

    const raw = await this.collectStream(
      CODEGEN_PROMPT,
      `页面结构:\n${JSON.stringify(this.context.pageStructure, null, 2)}\n\n组件库上下文:\n${this.context.componentLibraryContext}`,
    );

    // Parse code blocks with filenames
    const codeBlockRegex = /```tsx\s+filename="([^"]+)"\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    while ((match = codeBlockRegex.exec(raw)) !== null) {
      const filename = match[1];
      const code = match[2].trim();

      // Validate filename to prevent path traversal from LLM output
      if (!isSafeFilename(filename)) {
        this.config.onEvent({
          type: 'error',
          errorMessage: `Blocked unsafe filename from LLM: "${filename}"`,
          timestamp: Date.now(),
        });
        continue;
      }

      this.context.generatedCode?.set(filename, code);
      this.config.onEvent({
        type: 'file_changed',
        filePath: filename,
        timestamp: Date.now(),
      });
    }
  }

  private async runValidatePass(): Promise<void> {
    if (!this.context.generatedCode || this.context.generatedCode.size === 0) return;

    const allErrors: Array<{ file: string; error: string; line?: number }> = [];
    const MAX_REPAIR_ATTEMPTS = 2;

    for (const [filename, code] of this.context.generatedCode) {
      if (this.aborted) break;

      if (!this.config.validateCode) continue;

      let currentCode = code;
      let attempts = 0;

      while (attempts < MAX_REPAIR_ATTEMPTS) {
        const errors = await this.config.validateCode(currentCode, filename);
        if (errors.length === 0) break;

        attempts++;
        this.config.onEvent({
          type: 'tool_start',
          toolName: `design:repair-${filename}`,
          toolInput: { attempt: attempts, errors: errors.length },
          timestamp: Date.now(),
        });

        const errorsText = errors.map(e => `Line ${e.line ?? '?'}: ${e.error}`).join('\n');
        const repaired = await this.collectStream(
          VALIDATE_PROMPT
            .replace('{errors}', errorsText)
            .replace('{code}', currentCode),
          `修复 ${filename} 中的 ${errors.length} 个错误`,
        );

        const codeMatch = repaired.match(/```tsx?\n([\s\S]*?)```/);
        if (codeMatch) {
          currentCode = codeMatch[1].trim();
          this.context.generatedCode.set(filename, currentCode);
        }

        this.config.onEvent({
          type: 'tool_end',
          toolName: `design:repair-${filename}`,
          timestamp: Date.now(),
        });
      }

      if (this.config.validateCode) {
        const remaining = await this.config.validateCode(currentCode, filename);
        allErrors.push(...remaining.map(e => ({ file: filename, ...e })));
      }
    }

    this.context.validationErrors = allErrors;
  }

  private async runPreviewPass(): Promise<void> {
    if (!this.context.generatedCode || this.context.generatedCode.size === 0) return;

    // Write all generated files (re-validate filenames before writing)
    for (const [filename, code] of this.context.generatedCode) {
      if (this.aborted) break;
      if (!isSafeFilename(filename)) {
        this.config.onEvent({
          type: 'error',
          errorMessage: `Skipping unsafe filename: "${filename}"`,
          timestamp: Date.now(),
        });
        continue;
      }
      await this.config.writeFile(filename, code);
    }

    // Start preview server if available
    if (this.config.startPreview) {
      try {
        this.context.previewUrl = await this.config.startPreview('design/');
        this.config.onEvent({
          type: 'text_delta',
          content: `\n\n预览地址: ${this.context.previewUrl}\n`,
          timestamp: Date.now(),
        });
      } catch (err) {
        this.config.onEvent({
          type: 'error',
          errorMessage: `Preview server failed: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        });
      }
    }
  }

  private async runVisualCheckPass(): Promise<void> {
    // P1 feature: visual self-check via screenshot → vision model
    // Placeholder for now
    this.config.onEvent({
      type: 'text_delta',
      content: '\n设计预览已生成。视觉自检功能将在后续版本中添加。\n',
      timestamp: Date.now(),
    });
  }
}
