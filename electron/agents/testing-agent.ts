/**
 * Testing Agent
 * Automated testing and quality assurance:
 * 1. Requirements completeness check
 * 2. Code standards check
 * 3. Unit test generation & execution
 * 4. Security vulnerability scan
 * 5. Quality report generation
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { CodingAgentEvent } from '../providers/types.js';

export type TestingStep =
  | 'requirements-check'
  | 'code-standards'
  | 'test-generation'
  | 'test-execution'
  | 'security-scan'
  | 'quality-report';

export interface TestResult {
  passed: number;
  failed: number;
  skipped: number;
  coverage?: number;
  details: string;
}

export interface SecurityFinding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  rule: string;
  file: string;
  line?: number;
  message: string;
}

export interface QualityReport {
  timestamp: number;
  requirementsScore: number;  // 0-100
  codeQualityScore: number;
  testCoverage: number;
  securityScore: number;
  overallScore: number;
  findings: string[];
  recommendations: string[];
}

export interface TestingAgentConfig {
  onEvent: (event: CodingAgentEvent) => void;
  onStepChange: (step: TestingStep) => void;
  callLLM: (params: {
    system: string;
    messages: Array<{
      role: 'user' | 'assistant';
      content: string | Array<
        { type: 'text'; text: string } |
        { type: 'image'; mimeType: string; data: string }
      >;
    }>;
  }) => AsyncIterable<string>;
  workDirectory: string;
  prdContent?: string;
  initialAttachments?: Array<{ mimeType: string; data: string }>;
}

const REQUIREMENTS_CHECK_PROMPT = `你是一个 QA 专家。对照以下 PRD 文档，检查代码实现的完整性。

对每个需求点：
- ✅ 已实现
- ⚠️ 部分实现（说明缺失部分）
- ❌ 未实现

输出格式：
## 需求完整性检查
### P0 需求
- ✅/⚠️/❌ 需求描述...
### P1 需求
- ...
### 完成率: X%`;

const CODE_STANDARDS_PROMPT = `你是一个代码审查专家。检查以下代码是否符合最佳实践：
1. TypeScript 类型安全（无 any）
2. 错误处理完整性
3. 命名规范（camelCase 变量/函数，PascalCase 类型/组件）
4. 文件长度（<500 LOC 建议）
5. 关注点分离
6. 安全性（无硬编码密钥、无注入风险）

输出格式：
## 代码规范检查
### 问题列表
- [SEVERITY] file:line — 描述
### 统计
- 严重: X, 警告: Y, 建议: Z`;

const TEST_GEN_PROMPT = `你是一个测试工程师。为以下代码生成单元测试。

使用 vitest 测试框架。每个测试：
1. 描述清晰的测试名称
2. Arrange-Act-Assert 模式
3. 边界条件覆盖
4. Mock 外部依赖

输出完整的测试文件代码：`;

const SECURITY_PROMPT = `你是一个安全审计专家。扫描以下代码中的安全漏洞：
1. OWASP Top 10
2. 命令注入
3. 路径遍历
4. XSS
5. 敏感数据泄露
6. 不安全的依赖

输出格式（JSON 数组）：
[{"severity": "high", "rule": "CWE-78", "file": "...", "line": 42, "message": "..."}]`;

export class TestingAgent {
  private config: TestingAgentConfig;
  private aborted = false;
  private initialAttachmentsUsed = false;
  private report: QualityReport;

  constructor(config: TestingAgentConfig) {
    this.config = config;
    this.report = {
      timestamp: Date.now(),
      requirementsScore: 0,
      codeQualityScore: 0,
      testCoverage: 0,
      securityScore: 0,
      overallScore: 0,
      findings: [],
      recommendations: [],
    };
  }

  async run(): Promise<QualityReport> {
    const steps: TestingStep[] = [
      'requirements-check',
      'code-standards',
      'test-generation',
      'test-execution',
      'security-scan',
      'quality-report',
    ];

    for (const step of steps) {
      if (this.aborted) break;

      this.config.onStepChange(step);
      this.config.onEvent({
        type: 'tool_start',
        toolName: `testing:${step}`,
        timestamp: Date.now(),
      });

      const startTime = Date.now();

      switch (step) {
        case 'requirements-check':
          await this.runRequirementsCheck();
          break;
        case 'code-standards':
          await this.runCodeStandards();
          break;
        case 'test-generation':
          await this.runTestGeneration();
          break;
        case 'test-execution':
          await this.runTestExecution();
          break;
        case 'security-scan':
          await this.runSecurityScan();
          break;
        case 'quality-report':
          this.generateReport();
          break;
      }

      this.config.onEvent({
        type: 'tool_end',
        toolName: `testing:${step}`,
        content: `Completed in ${Date.now() - startTime}ms`,
        timestamp: Date.now(),
      });
    }

    this.config.onEvent({ type: 'turn_end', timestamp: Date.now() });
    return this.report;
  }

  abort(): void {
    this.aborted = true;
  }

  private async collectStream(system: string, userContent: string): Promise<string> {
    let result = '';
    const includeInitialAttachments = !this.initialAttachmentsUsed
      && Array.isArray(this.config.initialAttachments)
      && this.config.initialAttachments.length > 0;
    const messageContent = includeInitialAttachments
      ? [
          ...(userContent.length > 0 ? [{ type: 'text' as const, text: userContent }] : []),
          ...this.config.initialAttachments!.map((attachment) => ({
            type: 'image' as const,
            mimeType: attachment.mimeType,
            data: attachment.data,
          })),
        ]
      : userContent;
    if (includeInitialAttachments) {
      this.initialAttachmentsUsed = true;
    }
    const stream = this.config.callLLM({
      system,
      messages: [{ role: 'user', content: messageContent }],
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

  private async runRequirementsCheck(): Promise<void> {
    if (!this.config.prdContent) {
      this.config.onEvent({
        type: 'text_delta',
        content: '\n⚠️ 无 PRD 文档，跳过需求完整性检查\n',
        timestamp: Date.now(),
      });
      this.report.requirementsScore = -1;
      return;
    }

    // List source files for context
    let fileList: string;
    try {
      fileList = execFileSync('find', ['src', '-name', '*.ts', '-o', '-name', '*.tsx'], {
        cwd: this.config.workDirectory,
        encoding: 'utf-8',
        timeout: 5000,
      }).split('\n').slice(0, 50).join('\n');
    } catch {
      fileList = '(无法列出文件)';
    }

    const result = await this.collectStream(
      REQUIREMENTS_CHECK_PROMPT,
      `PRD:\n${this.config.prdContent}\n\n项目文件:\n${fileList}`,
    );

    // Extract completion percentage
    const match = result.match(/完成率:\s*(\d+)%/);
    if (match) {
      this.report.requirementsScore = parseInt(match[1], 10);
    }
  }

  private async runCodeStandards(): Promise<void> {
    // Run linter first — using execFileSync to prevent shell injection
    let lintOutput: string;
    try {
      lintOutput = execFileSync('npx', ['eslint', 'src/', '--format', 'compact'], {
        cwd: this.config.workDirectory,
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      // eslint exits non-zero when it finds issues, capture stdout from the error
      if (err && typeof err === 'object' && 'stdout' in err) {
        lintOutput = String((err as { stdout: unknown }).stdout);
      } else {
        lintOutput = err instanceof Error ? err.message : String(err);
      }
    }

    const result = await this.collectStream(
      CODE_STANDARDS_PROMPT,
      `Lint 输出:\n${lintOutput.slice(0, 5000)}`,
    );

    // Parse severity counts
    const criticalMatch = result.match(/严重:\s*(\d+)/);
    const warningMatch = result.match(/警告:\s*(\d+)/);
    const criticals = criticalMatch ? parseInt(criticalMatch[1], 10) : 0;
    const warnings = warningMatch ? parseInt(warningMatch[1], 10) : 0;

    this.report.codeQualityScore = Math.max(0, 100 - criticals * 20 - warnings * 5);
    if (criticals > 0) this.report.findings.push(`发现 ${criticals} 个严重代码问题`);
    if (warnings > 0) this.report.findings.push(`发现 ${warnings} 个代码警告`);
  }

  private async runTestGeneration(): Promise<void> {
    // Find files without tests
    let srcFiles: string;
    try {
      srcFiles = execFileSync('find', [
        'src', '-name', '*.ts', '-not', '-name', '*.test.ts', '-not', '-name', '*.d.ts',
      ], { cwd: this.config.workDirectory, encoding: 'utf-8', timeout: 5000 })
        .split('\n').slice(0, 10).join('\n');
    } catch {
      srcFiles = '';
    }

    if (!srcFiles.trim()) {
      this.config.onEvent({
        type: 'text_delta',
        content: '\n无需要测试的源文件\n',
        timestamp: Date.now(),
      });
      return;
    }

    // Read first few files for test generation
    const files = srcFiles.trim().split('\n').slice(0, 3);
    for (const file of files) {
      if (this.aborted) break;

      let content: string;
      try {
        content = readFileSync(join(this.config.workDirectory, file), 'utf-8');
      } catch {
        continue;
      }

      if (content.length > 0) {
        await this.collectStream(
          TEST_GEN_PROMPT,
          `文件: ${file}\n\n${content.slice(0, 8000)}`,
        );
      }
    }
  }

  private async runTestExecution(): Promise<void> {
    let testOutput: string;
    try {
      testOutput = execFileSync('npx', ['vitest', 'run', '--reporter=verbose'], {
        cwd: this.config.workDirectory,
        encoding: 'utf-8',
        timeout: 60000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      // vitest exits non-zero on test failure, capture stdout
      if (err && typeof err === 'object' && 'stdout' in err) {
        testOutput = String((err as { stdout: unknown }).stdout);
      } else {
        testOutput = err instanceof Error ? err.message : String(err);
      }
    }

    this.config.onEvent({
      type: 'text_delta',
      content: `\n## 测试执行结果\n\`\`\`\n${testOutput.slice(0, 5000)}\n\`\`\`\n`,
      timestamp: Date.now(),
    });

    // Parse test results
    const passedMatch = testOutput.match(/(\d+)\s*pass/i);
    const failedMatch = testOutput.match(/(\d+)\s*fail/i);
    const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
    const failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
    const total = passed + failed || 1;
    this.report.testCoverage = Math.round((passed / total) * 100);
  }

  private async runSecurityScan(): Promise<void> {
    // Gather code for security analysis
    let sampleCode = '';
    try {
      const files = execFileSync('find', [
        'src', '-name', '*.ts', '-not', '-name', '*.test.ts',
      ], { cwd: this.config.workDirectory, encoding: 'utf-8', timeout: 5000 })
        .split('\n').filter(Boolean).slice(0, 5);
      for (const f of files) {
        try {
          const content = readFileSync(join(this.config.workDirectory, f), 'utf-8');
          sampleCode += `\n// === ${f} ===\n${content.split('\n').slice(0, 100).join('\n')}`;
        } catch { /* skip unreadable */ }
      }
    } catch {
      sampleCode = '';
    }

    const result = await this.collectStream(
      SECURITY_PROMPT,
      sampleCode.slice(0, 10000),
    );

    // Parse security findings
    let findings: SecurityFinding[] = [];
    try {
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        findings = JSON.parse(jsonMatch[0]) as SecurityFinding[];
      }
    } catch {
      // Parse failed, treat as no findings
    }

    const criticalCount = findings.filter(f => f.severity === 'critical' || f.severity === 'high').length;
    this.report.securityScore = Math.max(0, 100 - criticalCount * 25 - findings.length * 5);

    if (findings.length > 0) {
      this.report.findings.push(`发现 ${findings.length} 个安全问题（${criticalCount} 个高危）`);
    }
  }

  private generateReport(): void {
    const scores = [
      this.report.requirementsScore >= 0 ? this.report.requirementsScore : null,
      this.report.codeQualityScore,
      this.report.testCoverage,
      this.report.securityScore,
    ].filter((s): s is number => s !== null);

    this.report.overallScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;

    // Generate recommendations
    if (this.report.requirementsScore >= 0 && this.report.requirementsScore < 80) {
      this.report.recommendations.push('需求覆盖率不足，建议补充缺失的功能实现');
    }
    if (this.report.codeQualityScore < 80) {
      this.report.recommendations.push('代码质量需要改善，重点关注严重问题');
    }
    if (this.report.testCoverage < 70) {
      this.report.recommendations.push('测试覆盖率偏低，建议增加单元测试');
    }
    if (this.report.securityScore < 80) {
      this.report.recommendations.push('存在安全风险，建议优先修复高危漏洞');
    }

    const reportText = `
# 质量评估报告

## 评分
| 指标 | 得分 |
|------|------|
| 需求完整性 | ${this.report.requirementsScore >= 0 ? `${this.report.requirementsScore}/100` : '未评估'} |
| 代码质量 | ${this.report.codeQualityScore}/100 |
| 测试覆盖率 | ${this.report.testCoverage}% |
| 安全评分 | ${this.report.securityScore}/100 |
| **综合评分** | **${this.report.overallScore}/100** |

## 发现的问题
${this.report.findings.map(f => `- ${f}`).join('\n') || '- 无'}

## 改进建议
${this.report.recommendations.map(r => `- ${r}`).join('\n') || '- 无'}
`;

    this.config.onEvent({
      type: 'text_delta',
      content: reportText,
      timestamp: Date.now(),
    });
  }
}
