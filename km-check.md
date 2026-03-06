# ClawDesktop2 多智能体架构分析与优化方案

> 生成时间: 2026-03-05
> 分析范围: ClawDesktop2 多智能体编排系统

---

## 1. 执行摘要

本报告对 ClawDesktop2 的多智能体架构进行了深度分析，识别了当前系统的优势与不足，并提出了基于 Agents TEAM 模式的优化方案，参考 Codex 桌面版的功能特征，以提升 Chat 交互的完成度和用户体验。

### 核心发现

- **当前架构**: 4 类 Agent（coding/requirements/design/testing）独立运行，缺乏真正的协作机制
- **主要问题**: Agent 间协作不足、任务状态追踪粗糙、错误恢复能力弱
- **优化方向**: 引入 TeamOrchestrator、增强任务可视化、实现智能 Agent 调度

---

## 2. 当前架构分析

### 2.1 系统架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        Renderer (React 19)                       │
│  ├─ Chat Page (SessionList, MessageList, ChatInput)             │
│  ├─ Stores (chat, agents, providers, git)                       │
│  └─ Services (IPC 通信层)                                        │
├─────────────────────────────────────────────────────────────────┤
│  IPC Bridge (白名单模式: VALID_INVOKE_CHANNELS)                 │
├─────────────────────────────────────────────────────────────────┤
│                        Main Process (Electron)                   │
│  ├─ IPC Handlers (chat:send → agentExecutor.execute)            │
│  ├─ Agent Executor (CLI/API 双模式 + Specialized Agents)        │
│  ├─ Message Bus (Pub/Sub + Direct Message)                      │
│  └─ Specialized Agents                                          │
│     ├─ RequirementsAgent (6-step workflow)                      │
│     ├─ DesignAgent (6-pass generation)                          │
│     └─ TestingAgent (6-step QA pipeline)                        │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Agent 类型与执行模式

| Agent 类型 | 执行模式 | 核心功能 | 步骤/阶段 |
|------------|----------|----------|-----------|
| `coding` | CLI/API 双模式 | 代码生成、编辑、终端执行 | 单轮对话 |
| `requirements` | API 模式 | 需求分析、PRD 生成 | summarize → research → clarify → review → generate-prd → user-review |
| `design` | API 模式 | UI 设计、代码生成、预览 | structure → context → codegen → validate → preview → visual-check |
| `testing` | API 模式 | 测试生成、执行、安全扫描 | requirements-check → code-standards → test-generation → test-execution → security-scan → quality-report |

### 2.3 事件流架构

```typescript
// 核心事件类型 (electron/providers/types.ts)
interface CodingAgentEvent {
  type: 'text_delta' | 'tool_start' | 'tool_output' | 'tool_end' |
        'file_changed' | 'approval_req' | 'clarification_req' |
        'preview_ready' | 'turn_end' | 'error';
  timestamp: number;
  // ... 其他字段
}
```

**事件流生命周期**:

```
用户发送消息
    ↓
ipc.sendMessage() → main process
    ↓
agentExecutor.execute()
    ↓
Event Stream:
├── text_delta: 增量文本输出 → 实时渲染到 MessageBubble
├── tool_start: 工具开始 → 显示 ToolCallDisplay (running)
├── tool_output: 工具输出 → 更新 ToolCallDisplay
├── tool_end: 工具结束 → 更新 ToolCallDisplay (completed)
├── file_changed: 文件变更 → 触发 Git Store 刷新
├── preview_ready: 预览就绪 → 显示 DesignPreview
├── approval_req: 需要审批 → 显示 ApprovalDialog
├── clarification_req: 需要澄清 → 显示 ClarificationDialog
├── turn_end: 一轮结束 → 停止 streaming 状态
└── error: 错误 → 显示错误信息
    ↓
insertMessage() → SQLite 持久化
```

---

## 3. 问题诊断

### 3.1 架构层面问题

#### 问题 1: Agent 间缺乏真正的协作机制

**现状**:
- 4 个 Agent 类型各自独立运行，通过 `agentType` 参数切换
- MessageBus 仅用于注册/注销 Agent，没有实现任务分发和结果汇总
- 没有 Orchestrator 来协调多 Agent 协作

**代码位置**: `electron/engine/agent-executor.ts:241-274`

```typescript
// 每个 session 只能运行一个 Agent，没有并行或协作
if (activeSessions.has(sessionId)) {
  throw new Error(`Session ${sessionId} is already running`);
}
```

#### 问题 2: 任务状态追踪不够精细

**现状**:
- 只有 `isStreaming` 布尔状态，没有细粒度的步骤状态
- Specialized Agents 内部有步骤，但状态只通过 `tool_start/tool_end` 暴露
- 没有任务进度、预计剩余时间等信息

**影响**: 用户无法了解 Agent 执行的具体阶段和剩余工作量

#### 问题 3: 错误处理和恢复机制简单

**现状**:
- 错误仅通过 `error` 事件传递，显示为文本消息
- 没有错误分类（可恢复/不可恢复）
- 没有重试机制或备选策略

**代码位置**: `electron/engine/agent-executor.ts:1079-1090`

```typescript
}).catch((err) => {
  const errorMessage = err instanceof Error ? err.message : String(err);
  mainWindow.webContents.send('chat:stream', {
    type: 'error',
    errorMessage,
    timestamp: Date.now(),
  });
});
```

### 3.2 Chat 交互层面问题

| 问题 | 描述 | 影响 |
|------|------|------|
| ToolCall 展示信息有限 | 仅显示 toolName、status、input/output | 缺乏执行时间线、资源消耗等信息 |
| 缺乏任务规划可视化 | 用户不知道 Agent 会执行哪些步骤 | 透明度低，信任度不足 |
| Agent 切换体验不佳 | Agent 类型切换是全局的 | 当前会话切换 Agent 需要创建新会话 |
| 缺乏智能推荐 | 没有根据任务内容自动推荐 Agent | 用户需要手动选择 |

---

## 4. 优化方案: Agents TEAM 模式

### 4.1 参考: Codex 桌面版功能特征

1. **Multi-Agent Collaboration**: Coding Agent + Testing Agent + Review Agent 协作
2. **Task Planning & Execution**: 任务分解、执行跟踪、进度可视化
3. **Code Review & Testing Pipeline**: 代码审查流程、自动化测试集成
4. **GitHub Integration**: PR 创建、Review 流程、CI/CD 集成
5. **Approval Workflow**: 精细化的审批流程（文件级、命令级）
6. **Context Awareness**: 项目结构感知、依赖关系分析

### 4.2 优化架构设计

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Agents TEAM 模式 - 优化架构                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      TeamOrchestrator                                │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │   │
│  │  │   Planner    │  │  TaskQueue   │  │  ResultMerge │               │   │
│  │  │   Agent      │  │              │  │     Agent    │               │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│           ┌──────────────────┼──────────────────┐                          │
│           ▼                  ▼                  ▼                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                     │
│  │   Coding    │    │ Requirements│    │   Design    │                     │
│  │    Agent    │    │    Agent    │    │    Agent    │                     │
│  └─────────────┘    └─────────────┘    └─────────────┘                     │
│         │                  │                  │                            │
│         └──────────────────┼──────────────────┘                            │
│                            ▼                                               │
│                   ┌─────────────┐                                          │
│                   │  Testing    │                                          │
│                   │   Agent     │                                          │
│                   └─────────────┘                                          │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                           Chat 交互增强                                      │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     TaskPlanPanel (新组件)                           │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  📋 Task Plan                                                │   │   │
│  │  │  [ ] 1. Analyze requirements ................... [pending]   │   │   │
│  │  │  [✓] 2. Generate code .......................... [completed] │   │   │
│  │  │  [→] 3. Run tests .............................. [running]   │   │   │
│  │  │  [ ] 4. Security scan .......................... [pending]   │   │   │
│  │  │  ─────────────────────────────────────────────────────────   │   │   │
│  │  │  Progress: 50% | Est. remaining: 2m 30s                      │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     EnhancedToolCall (增强组件)                      │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  🔧 Bash.execute_command                         [12.3s] ✓   │   │   │
│  │  │  ├─ Input:  { command: "npm test", cwd: "..." }              │   │   │
│  │  │  ├─ Output: (stdout: 150 lines)                              │   │   │
│  │  │  └─ Files changed: 3 files (diff view)                       │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     AgentCollaborationView (新组件)                  │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  🤖 Coding Agent → Testing Agent                            │   │   │
│  │  │     "Code generated, please review and test"                │   │   │
│  │  │  🤖 Testing Agent → Coding Agent                             │   │   │
│  │  │     "Found 2 issues: ..."                                   │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 核心优化点详解

#### 优化 1: 引入 TeamOrchestrator

**目标**: 实现多 Agent 协作的任务规划和执行

**关键接口设计**:

```typescript
// electron/engine/team-orchestrator.ts
export interface TeamTask {
  id: string;
  type: 'plan' | 'code' | 'test' | 'review' | 'design';
  description: string;
  assignedAgent: AgentType;
  dependencies: string[]; // 依赖的其他任务 ID
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  input: unknown;
  output?: unknown;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  retryCount: number;
  maxRetries: number;
}

export interface TeamExecutionPlan {
  id: string;
  sessionId: string;
  goal: string;
  tasks: TeamTask[];
  parallelGroups: string[][]; // 可以并行执行的任务组
  createdAt: number;
  estimatedDurationMs?: number;
}

export class TeamOrchestrator {
  async createPlan(goal: string, context: SessionContext): Promise<TeamExecutionPlan>;
  async executePlan(plan: TeamExecutionPlan, onEvent: OrchestratorEventHandler): Promise<void>;
  async retryTask(planId: string, taskId: string): Promise<void>;
  async skipTask(planId: string, taskId: string): Promise<void>;
  async abortPlan(planId: string): Promise<void>;
}
```

#### 优化 2: 增强事件系统

**目标**: 支持任务规划、进度追踪、Agent 协作消息

**新增事件类型**:

```typescript
// electron/providers/types.ts
export interface EnhancedCodingAgentEvent extends CodingAgentEvent {
  // 任务规划事件
  type: 'task_plan_created' | 'task_started' | 'task_progress' |
        'task_completed' | 'task_failed' | 'task_skipped' | ...;

  // 任务规划相关
  taskPlan?: {
    id: string;
    tasks: Array<{
      id: string;
      description: string;
      agent: AgentType;
      status: TaskStatus;
      progress: number; // 0-100
    }>;
    overallProgress: number;
    estimatedRemainingMs: number;
  };

  // Agent 协作消息
  collaborationMessage?: {
    from: AgentType;
    to: AgentType;
    message: string;
    context: unknown;
  };

  // 增强的工具调用信息
  enhancedToolCall?: {
    id: string;
    name: string;
    status: ToolCallStatus;
    input: unknown;
    output?: unknown;
    startedAt: number;
    completedAt?: number;
    durationMs?: number;
    filesChanged?: string[];
    gitDiff?: string;
    resourceUsage?: {
      cpuPercent?: number;
      memoryMB?: number;
    };
  };
}
```

#### 优化 3: Chat Store 扩展

**目标**: 支持任务规划状态管理和执行统计

```typescript
// src/stores/chat.ts (优化后)
interface EnhancedChatState extends ChatState {
  // 任务规划状态
  activeTaskPlan: TaskPlan | null;
  taskHistory: TaskPlan[];

  // Agent 协作状态
  agentCollaborations: AgentCollaborationMessage[];

  // 增强的工具调用状态
  toolCallTimeline: EnhancedToolCall[];

  // 执行统计
  executionStats: {
    totalDurationMs: number;
    tokensUsed: number;
    apiCalls: number;
    filesChanged: number;
  };
}

interface TaskPlan {
  id: string;
  sessionId: string;
  goal: string;
  tasks: Task[];
  status: 'planning' | 'executing' | 'completed' | 'failed' | 'paused';
  startedAt: number;
  completedAt?: number;
}
```

#### 优化 4: 新 UI 组件

| 组件名 | 功能描述 |
|--------|----------|
| `TaskPlanPanel` | 显示任务规划、进度条、预计剩余时间；支持展开/收起每个任务的详情；支持暂停/继续/重试/跳过任务 |
| `AgentCollaborationView` | 显示 Agent 之间的协作消息流；类似聊天界面，但展示 Agent 之间的沟通 |
| `ExecutionTimeline` | 时间线视图展示所有工具调用；支持缩放、筛选、查看详情 |
| `EnhancedToolCall` | 增强的工具调用展示，包含执行时间、资源消耗、文件变更关联 |

---

## 5. 实施路线图

### Phase 1: 基础增强 (2-3 周)

**目标**: 增强事件系统和现有组件

**任务清单**:
- [ ] 扩展 `CodingAgentEvent` 类型，添加任务规划相关事件
- [ ] 在 Specialized Agents 中注入更多细粒度状态事件
- [ ] 增强 `ToolCallDisplay` 组件，展示执行时间、资源消耗
- [ ] 添加文件变更关联展示
- [ ] 添加任务规划状态管理到 Chat Store
- [ ] 添加执行统计信息

**关键文件**:
- `electron/providers/types.ts`
- `electron/agents/requirements-agent.ts`
- `electron/agents/design-agent.ts`
- `electron/agents/testing-agent.ts`
- `src/components/chat/ToolCallDisplay.tsx`
- `src/stores/chat.ts`

### Phase 2: Team Orchestrator (3-4 周)

**目标**: 实现多 Agent 协作核心

**任务清单**:
- [ ] 实现 `TeamOrchestrator` 类
- [ ] 实现任务规划生成（基于 LLM）
- [ ] 实现任务队列和依赖管理
- [ ] 实现并行执行控制
- [ ] 扩展 MessageBus，支持 Agent 间直接消息
- [ ] 实现结果传递和上下文共享
- [ ] 实现 `TaskPlanPanel` 组件
- [ ] 实现执行时间线视图

**关键文件**:
- `electron/engine/team-orchestrator.ts` (新建)
- `electron/engine/message-bus.ts`
- `src/components/chat/TaskPlanPanel.tsx` (新建)
- `src/components/chat/ExecutionTimeline.tsx` (新建)

### Phase 3: 高级功能 (2-3 周)

**目标**: 实现智能调度和性能优化

**任务清单**:
- [ ] 基于用户输入自动推荐 Agent 类型
- [ ] 动态任务重分配
- [ ] 自动重试策略
- [ ] 备选 Agent 切换
- [ ] 流式事件批处理优化
- [ ] 大型任务的分片执行

**关键文件**:
- `electron/engine/agent-selector.ts` (新建)
- `electron/engine/retry-policy.ts` (新建)

---

## 6. 关键改进代码示例

### 6.1 增强的 Agent 执行状态暴露

```typescript
// electron/agents/requirements-agent.ts (改进后)
export class RequirementsAgent {
  async run(): Promise<RequirementsContext> {
    for (const step of steps) {
      // 发送详细的步骤状态事件
      this.config.onEvent({
        type: 'task_started',
        taskId: `requirements:${step}`,
        taskName: this.getStepDisplayName(step),
        progress: steps.indexOf(step) / steps.length,
        timestamp: Date.now(),
      });

      try {
        await this.runStep(step);

        this.config.onEvent({
          type: 'task_completed',
          taskId: `requirements:${step}`,
          result: this.getStepResult(step),
          timestamp: Date.now(),
        });
      } catch (error) {
        this.config.onEvent({
          type: 'task_failed',
          taskId: `requirements:${step}`,
          error: error instanceof Error ? error.message : String(error),
          recoverable: this.isStepRecoverable(step),
          timestamp: Date.now(),
        });

        if (!this.isStepRecoverable(step)) throw error;
      }
    }
  }
}
```

### 6.2 Chat Store 任务规划处理

```typescript
// src/stores/chat.ts (改进后)
ipc.onChatStream((event) => {
  switch (event.type) {
    case 'task_plan_created':
      set({
        activeTaskPlan: event.taskPlan,
        isStreaming: true
      });
      break;

    case 'task_started':
    case 'task_progress':
    case 'task_completed':
    case 'task_failed':
      set((state) => ({
        activeTaskPlan: state.activeTaskPlan
          ? updateTaskInPlan(state.activeTaskPlan, event)
          : null
      }));
      break;

    case 'turn_end':
      set((state) => ({
        isStreaming: false,
        taskHistory: state.activeTaskPlan
          ? [...state.taskHistory, state.activeTaskPlan]
          : state.taskHistory,
        activeTaskPlan: null
      }));
      break;
  }
});
```

### 6.3 任务规划面板组件

```tsx
// src/components/chat/TaskPlanPanel.tsx
export function TaskPlanPanel({ plan }: { plan: TaskPlan }) {
  const completedTasks = plan.tasks.filter(t => t.status === 'completed').length;
  const progress = (completedTasks / plan.tasks.length) * 100;

  return (
    <div className="task-plan-panel">
      <div className="task-plan-header">
        <h3>📋 Execution Plan</h3>
        <Progress value={progress} className="w-full" />
        <span className="text-sm text-muted-foreground">
          {completedTasks}/{plan.tasks.length} tasks •
          Est. {formatDuration(plan.estimatedRemainingMs)}
        </span>
      </div>

      <div className="task-list">
        {plan.tasks.map(task => (
          <TaskItem
            key={task.id}
            task={task}
            onRetry={() => handleRetry(task.id)}
            onSkip={() => handleSkip(task.id)}
          />
        ))}
      </div>
    </div>
  );
}
```

---

## 7. 风险与缓解策略

| 风险 | 可能性 | 影响 | 缓解策略 |
|------|--------|------|----------|
| 向后兼容性破坏 | 高 | 高 | 保持现有事件类型，新增事件作为扩展；提供迁移指南 |
| 性能开销增加 | 中 | 中 | 事件批处理；虚拟列表渲染大量任务；按需加载 |
| LLM 规划不准确 | 中 | 高 | 人工确认任务规划；支持手动调整；A/B 测试 |
| 复杂度增加 | 高 | 中 | 模块化设计；完善的单元测试；渐进式 rollout |

---

## 8. 成功指标

### 8.1 技术指标

- 任务规划准确率 > 80%
- Agent 协作消息延迟 < 100ms
- 大型任务（>20 步）执行成功率 > 90%
- 错误恢复成功率 > 70%

### 8.2 用户体验指标

- 用户满意度提升 30%
- 任务完成时间缩短 25%
- 手动干预次数减少 40%
- Chat 功能使用率提升 50%

---

## 9. 附录

### 9.1 关键文件清单

| 文件路径 | 作用 | 修改建议 |
|----------|------|----------|
| `electron/engine/agent-executor.ts` | Agent 执行核心 | 集成 TeamOrchestrator |
| `electron/engine/message-bus.ts` | Agent 通信 | 增强消息类型 |
| `electron/providers/types.ts` | 类型定义 | 扩展事件类型 |
| `electron/agents/*.ts` | Specialized Agents | 注入细粒度状态 |
| `src/stores/chat.ts` | Chat 状态管理 | 扩展状态定义 |
| `src/components/chat/*.tsx` | Chat UI 组件 | 新增可视化组件 |

### 9.2 相关文档

- [CLAUDE.md](./CLAUDE.md) - 项目开发规范
- [start.md](./start.md) - 产品愿景和路线图

---

*本文档由 Claude Code 生成，基于对 ClawDesktop2 代码库的深度分析。*
