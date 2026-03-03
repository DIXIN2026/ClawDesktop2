/**
 * Requirements Agent
 * 6-step workflow: summarize → research → clarify → review → generate PRD → user review
 * Runs via Provider API (no container isolation needed)
 */
import type { CodingAgentEvent } from '../providers/types.js';

export type RequirementsStep =
  | 'summarize'
  | 'research'
  | 'clarify'
  | 'review'
  | 'generate-prd'
  | 'user-review';

export interface RequirementsContext {
  userInput: string;
  summary?: string;
  researchFindings?: string;
  clarifications?: Array<{ question: string; answer?: string }>;
  reviewNotes?: string;
  prdContent?: string;
  currentStep: RequirementsStep;
}

export interface RequirementsAgentConfig {
  onEvent: (event: CodingAgentEvent) => void;
  onStepChange: (step: RequirementsStep) => void;
  onClarificationNeeded: (questions: string[]) => Promise<Record<string, string>>;
  callLLM: (params: {
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }) => AsyncIterable<string>;
}

const STEP_PROMPTS: Record<RequirementsStep, string> = {
  summarize: `你是一个专业的需求分析师。请总结归纳以下用户需求，提取核心功能点、用户故事和约束条件。
输出格式：
## 需求总结
### 核心功能
- ...
### 用户故事
- 作为<角色>，我希望<功能>，以便<价值>
### 约束条件
- ...`,

  research: `你是一个市场调研专家。根据以下需求总结，进行竞品分析和技术可行性评估。
输出格式：
## 竞品调研
### 相关产品
- 产品名：功能对比
### 技术方案
- 推荐技术栈和架构
### 风险评估
- 潜在风险和应对策略`,

  clarify: `你是一个需求分析师。根据以下需求信息，列出需要向用户澄清的问题。
每个问题要具体、可回答，避免开放式问题。
输出格式（JSON 数组）：
["问题1", "问题2", ...]`,

  review: `你是一个高级需求审核专家。审核以下需求文档的完整性、一致性和可行性。
输出格式：
## 审核结果
### 完整性检查
- ✅/❌ 检查项...
### 一致性检查
- ✅/❌ 检查项...
### 建议改进
- ...`,

  'generate-prd': `你是一个资深产品经理。根据所有收集到的信息，生成一份完整的产品需求文档(PRD)。
包含以下章节：
1. 概述
2. 目标用户
3. 功能需求（按优先级排序：P0/P1/P2）
4. 非功能需求
5. 用户流程图（文字描述）
6. 数据模型
7. API 设计
8. 里程碑计划
9. 验收标准`,

  'user-review': `文档已生成，等待用户审核。`,
};

export class RequirementsAgent {
  private context: RequirementsContext;
  private config: RequirementsAgentConfig;
  private aborted = false;

  constructor(userInput: string, config: RequirementsAgentConfig) {
    this.context = {
      userInput,
      currentStep: 'summarize',
    };
    this.config = config;
  }

  async run(): Promise<RequirementsContext> {
    const steps: RequirementsStep[] = ['summarize', 'research', 'clarify', 'review', 'generate-prd', 'user-review'];

    for (const step of steps) {
      if (this.aborted) break;

      this.context.currentStep = step;
      this.config.onStepChange(step);
      this.config.onEvent({
        type: 'tool_start',
        toolName: `requirements:${step}`,
        timestamp: Date.now(),
      });

      const startTime = Date.now();

      switch (step) {
        case 'summarize':
          await this.runSummarize();
          break;
        case 'research':
          await this.runResearch();
          break;
        case 'clarify':
          await this.runClarify();
          break;
        case 'review':
          await this.runReview();
          break;
        case 'generate-prd':
          await this.runGeneratePRD();
          break;
        case 'user-review':
          // Final step — just emit the PRD
          this.config.onEvent({
            type: 'text_delta',
            content: this.context.prdContent ?? '',
            timestamp: Date.now(),
          });
          break;
      }

      this.config.onEvent({
        type: 'tool_end',
        toolName: `requirements:${step}`,
        content: `Step completed`,
        timestamp: Date.now(),
      });

      const durationMs = Date.now() - startTime;
      console.log(`[RequirementsAgent] Step "${step}" completed in ${durationMs}ms`);
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

  private async runSummarize(): Promise<void> {
    this.context.summary = await this.collectStream(
      STEP_PROMPTS.summarize,
      this.context.userInput,
    );
  }

  private async runResearch(): Promise<void> {
    this.context.researchFindings = await this.collectStream(
      STEP_PROMPTS.research,
      `需求总结：\n${this.context.summary}`,
    );
  }

  private async runClarify(): Promise<void> {
    const questionsRaw = await this.collectStream(
      STEP_PROMPTS.clarify,
      `需求总结：\n${this.context.summary}\n\n竞品调研：\n${this.context.researchFindings}`,
    );

    // Parse questions from LLM output
    let questions: string[] = [];
    try {
      const jsonMatch = questionsRaw.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        questions = JSON.parse(jsonMatch[0]) as string[];
      }
    } catch {
      questions = questionsRaw.split('\n').filter(l => l.trim().startsWith('-') || l.trim().match(/^\d+\./)).map(l => l.replace(/^[-\d.]+\s*/, '').trim());
    }

    if (questions.length > 0) {
      const answers = await this.config.onClarificationNeeded(questions);
      this.context.clarifications = questions.map(q => ({
        question: q,
        answer: answers[q],
      }));
    }
  }

  private async runReview(): Promise<void> {
    const clarificationText = this.context.clarifications
      ?.map(c => `Q: ${c.question}\nA: ${c.answer ?? '未回答'}`)
      .join('\n\n') ?? '';

    this.context.reviewNotes = await this.collectStream(
      STEP_PROMPTS.review,
      `需求总结：\n${this.context.summary}\n\n竞品调研：\n${this.context.researchFindings}\n\n澄清：\n${clarificationText}`,
    );
  }

  private async runGeneratePRD(): Promise<void> {
    const clarificationText = this.context.clarifications
      ?.map(c => `Q: ${c.question}\nA: ${c.answer ?? '未回答'}`)
      .join('\n\n') ?? '';

    this.context.prdContent = await this.collectStream(
      STEP_PROMPTS['generate-prd'],
      `需求总结：\n${this.context.summary}\n\n竞品调研：\n${this.context.researchFindings}\n\n澄清：\n${clarificationText}\n\n审核意见：\n${this.context.reviewNotes}`,
    );
  }
}
