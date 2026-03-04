# ClawDesktop2 — 综合分析与能力提升方案

> 分析日期：2026-03-04  
> 文档状态：可执行方案（分析阶段，不修改任何代码）  
> 覆盖范围：① Claude Memory 方案研究 ② Agent Swarm/Team 方案研究 ③ Bug 与未完成功能清单 ④ 可执行改进方案

---

## 第一部分：Claude Memory 方案研究

### 1.1 官方方案：MCP Memory Server

Anthropic 官方发布了 `@modelcontextprotocol/server-memory`（v2026.1.26），基于**知识图谱**架构：

```
知识图谱三要素：
├── Entities    — 实体节点（用户、项目、偏好等）
├── Relations   — 有向关系（实体间连接）
└── Observations— 原子事实（附着在实体上的字符串）
```

**优点**：结构化、可查询、持久化跨会话  
**缺点**：需要外部 MCP Server 进程，对话上下文感知弱

### 1.2 项目现有方案：CoPaw 双层记忆

ClawDesktop2 已在 `electron/memory/` 实现了一套**完整的双层记忆系统**：

```
Layer 1: Raw Chunks（原始消息层）
  ├── 存储：SQLite memory_chunks 表
  ├── 搜索：FTS5 全文检索（BM25）+ 可选向量相似度
  └── 索引：memory_fts 虚拟表

Layer 2: Compaction（压缩摘要层）
  ├── 触发：token 数超过阈值（maxTokens × 0.7）
  ├── 策略：保留最近 N 条 + LLM 生成摘要
  └── 存储：SQLite memory_summaries 表
```

**混合搜索权重**（可配置）：
```
最终分数 = 向量相似度 × 0.7 + BM25分数 × 0.3
```

**Context 注入格式**：
```xml
<previous-summary>...（上轮压缩摘要，占 40% token 预算）</previous-summary>
<relevant-memories>...（语义检索结果，占剩余 50%）</relevant-memories>
```

### 1.3 当前记忆系统的问题（严重）

| 问题 | 级别 | 说明 |
|------|------|------|
| **embeddingAdapter 未传入 executor** | 🔴 P0 | `chat:send` 调用 `agentExecutor.execute()` 时缺少 `embeddingAdapter` 参数，导致所有对话记忆功能实际上**不工作** |
| **Memory UI 入口缺失** | 🔴 P0 | `useMemoryStore` 定义了但没有任何 UI 组件使用，用户无法查看/搜索/管理记忆 |
| **Settings 无 Memory 配置页** | 🟡 P1 | 无法在 UI 中调整 compactRatio、embeddingEnabled 等参数 |
| **Ollama embedding 依赖** | 🟡 P1 | 向量嵌入仅支持 Ollama，若未运行则降级为纯 BM25，但用户不知情 |

### 1.4 MCP Memory Server 是否适用本项目

**结论：不建议引入，使用现有方案并修复即可。**

理由：
- 本项目已有完整双层记忆架构，只是集成 Bug 导致未生效
- MCP Memory Server 需要额外进程，与 ClawDesktop2 "轻量单进程"设计冲突
- 本地 SQLite + FTS5 在桌面应用中性能优于外部 MCP 进程

**建议增强点**：参考 MCP Memory Server 的**知识图谱思想**，为用户添加"用户偏好记忆"功能（如记住用户常用语言、代码风格等），可作为 P2 功能迭代。

---

## 第二部分：Agent Swarm / Team 方案研究

### 2.1 Anthropic 官方多智能体架构

根据 Anthropic 2026 年最新文档，官方推荐的核心模式是 **Orchestrator-Worker 模式**：

```
Orchestrator（Claude Opus 4.6）
  ├── 分析任务、制定计划
  ├── 派发子任务给 Sub-agents
  └── 汇总结果、生成最终输出

Sub-agents（Claude Sonnet / Haiku）
  ├── Explore Agent  — 快速只读代码库搜索
  ├── Plan Agent     — 上下文收集与规划
  └── General Agent  — 复杂多步任务执行
```

**关键数据**：多智能体系统在复杂任务上比单智能体性能提升 **90%+**，token 用量解释了 80% 的性能方差。

**何时使用多智能体**：
1. 上下文污染降低单智能体性能时
2. 任务可并行化时
3. 专业化分工能提升工具选择准确性时

**Anthropic 警告**：很多团队构建复杂多智能体后发现，改进单智能体提示词即可达到同等效果。

### 2.2 Claude Code Agent Teams（实验特性）

Claude Code 在 2026 年推出了 **Agent Teams** 实验功能：
- 多个 Claude Code 会话可**直接通信**
- 共享任务列表
- 独立消息传递
- 超越 Sub-agents 的协同能力

### 2.3 项目现有多智能体实现

ClawDesktop2 已实现了相当完整的多智能体基础设施：

```
已实现：
├── Orchestrator（electron/engine/orchestrator.ts）
│   ├── 顺序管道（Sequential Pipeline）
│   ├── 并行执行组（Parallel Group）
│   ├── 条件跳转（Condition Evaluation）
│   └── 合并策略（all/fastest/consensus）
├── MessageBus（electron/engine/message-bus.ts）
│   ├── Pub/Sub 消息模式
│   ├── 直接消息传递
│   └── Agent 注册/状态管理
├── AgentMailbox（electron/engine/agent-mailbox.ts）
│   ├── 优先级队列
│   └── 消息过滤
└── Pipeline UI（src/pages/Agents/index.tsx）
    └── 可视化 Pipeline 编辑器
```

### 2.4 当前多智能体的问题

| 问题 | 级别 | 说明 |
|------|------|------|
| **orchestrator:progress 前端未监听** | 🔴 P0 | IPC preload 中有 `orchestrator:progress` 通道，但前端 Agents 页面未订阅，Pipeline 执行进度无法在 UI 中显示 |
| **MessageBus 与 Orchestrator 脱节** | 🟡 P1 | Orchestrator 内部只用了 agentExecutor，未利用 MessageBus 的跨 Agent 通信能力，智能体间无法互相感知状态 |
| **Agent 间无数据共享协议** | 🟡 P1 | Pipeline steps 通过文本拼接传递结果，设计智能体产出的文件无法直接被测试智能体感知 |
| **并行组 fastest 策略有 Bug** | 🟡 P1 | `executeParallelGroup` 中 `fastest` 策略创建了 sessionId 数组但实际用的是 Promise.race，abort 调用可能针对错误的 sessionId |

### 2.5 是否引入新的 Agent Swarm 框架

**结论：不引入外部框架，优化现有实现。**

理由：
- LangChain/CrewAI/AutoGen 均需要 Python 运行时，与 Electron/TypeScript 架构不兼容
- 现有 Orchestrator + MessageBus 架构设计合理，只需修复集成问题
- 引入外部框架会大幅增加包体积和复杂度

**建议增强方向**（可作为 P1）：
- 为 Pipeline 增加**智能体间文件系统共享**（通过工作目录约定）
- 增加 **handoff 消息协议**（需求智能体 → 编码智能体的上下文传递）
- 在 Settings 中增加 **Pipeline 模板库**（预设常用工作流）

---

## 第三部分：Bug 与未完成功能清单

### 3.1 严重 Bug（P0 — 功能完全失效）

#### Bug-1：记忆系统在对话中不生效
**文件**：`electron/main/ipc-handlers.ts`，`chat:send` handler（约第 760 行）  
**问题**：`agentExecutor.execute()` 调用时缺少 `embeddingAdapter` 参数

```typescript
// ❌ 当前代码（embeddingAdapter 未传入）
agentExecutor.execute({
  sessionId, prompt, workDirectory, agentType, mode,
  cliBackend, providerId, modelId, apiKey, baseUrl, apiProtocol,
  onEvent: (event) => { ... }
});

// ✅ 应该传入
agentExecutor.execute({
  sessionId, prompt, workDirectory, agentType, mode,
  cliBackend, providerId, modelId, apiKey, baseUrl, apiProtocol,
  embeddingAdapter: createEmbeddingAdapter(/* provider, key */),  // ← 缺失
  onEvent: (event) => { ... }
});
```

**影响**：`buildAgentContext()` 中 `embeddingAdapter` 为 null，所有对话历史不会被向量化索引，`searchMemory()` 向量搜索无结果，记忆压缩 (compaction) 中的嵌入生成跳过。

#### Bug-2：Orchestrator Pipeline 进度无法在 UI 显示
**文件**：`src/pages/Agents/index.tsx`  
**问题**：前端 Pipeline Editor 有"运行"按钮，调用了 `ipc.executePipeline()`，但没有监听 `orchestrator:progress` 事件，导致执行进度对用户不可见。

```typescript
// ❌ 当前代码（只有执行，没有进度监听）
const handleRun = async (pipeline: Pipeline) => {
  await ipc.executePipeline({ ...pipeline });
  // 没有 listen('orchestrator:progress', ...)
};
```

#### Bug-3：设计智能体预览 URL 无法推送到前端
**文件**：`electron/engine/agent-executor.ts` 中 `executeSpecializedAgent`  
**问题**：`startPreviewServer()` 调用后返回 URL，但 agent-executor 通过 `onEvent` 推送的 `file_changed` 事件中没有携带 `previewUrl`，前端 `DesignPreview` 组件无法知道应该加载哪个 URL。

#### Bug-4：并行组 fastest 策略 abort 目标错误
**文件**：`electron/engine/orchestrator.ts`，`executeParallelGroup` 方法  
**问题**：创建的 `sessionIds` 数组与 `Promise.race` 实际执行的 session 不对应（`executeSingleStep` 内部自己生成了 sessionId），abort 调用会针对错误的 session。

---

### 3.2 未完成需求功能（PRD 要求但代码缺失）

#### Feature-1：Memory 管理 UI 完全缺失（P0）
**PRD 要求**：用户可查看、搜索记忆，可删除记忆条目  
**实现状态**：
- ✅ `useMemoryStore` 在 `src/stores/memory.ts` 完整定义
- ✅ IPC 通道全部注册（memory:search/stats/config:get/config:set/delete/delete-session/reindex）
- ❌ **没有任何 UI 组件调用 `useMemoryStore`**
- ❌ **Settings 页面无 Memory 配置入口**（SETTINGS_NAV 中只有通用/供应商/安全/关于）

#### Feature-2：Worktree 管理 UI 缺失（P1）
**PRD 要求**：左侧栏展示 Worktree 列表，支持创建/切换/删除  
**实现状态**：
- ✅ Git IPC 通道注册（git:worktree-list/create/remove）
- ✅ `ipc.ts` 有 `board:issues:start` 时创建 worktree 的调用
- ❌ **Chat 左侧栏无 Worktree 区域显示**
- ❌ **没有专门的 worktree 管理组件**

#### Feature-3：图片上传/发送支持缺失（P1）
**PRD 要求**：Chat 中支持发送图片，图片附件支持  
**实现状态**：
- ❌ `ChatInput.tsx` 无文件/图片上传入口
- ❌ `chat:send` IPC handler 无 attachments 处理
- ❌ `MessageBubble.tsx` 无图片渲染逻辑
- 数据库 `messages.attachments` 字段已预留（JSON 格式）

#### Feature-4：Memory 设置无 UI 入口（P1）
**PRD 要求**：用户可配置 compactRatio、embeddingEnabled 等参数  
**实现状态**：
- ✅ IPC memory:config:get/set 已实现
- ❌ Settings 页面无 Memory 配置路由（SETTINGS_NAV 缺少 Memory 项）

#### Feature-5：设计预览面板未集成到 Chat（P0）
**PRD 要求**：设计智能体执行时右侧面板展示实时预览  
**实现状态**：
- ✅ `DesignPreview.tsx` 组件完整（支持多设备尺寸）
- ✅ `design-preview.ts` Vite Dev Server 管理完整
- ❌ `Chat/index.tsx` 中右侧面板**只有 ReviewPanel**，没有根据 agentType 切换为 DesignPreview
- ❌ previewUrl 无法从后端传递到前端

#### Feature-6：Pipeline 执行进度 UI 缺失（P1）
**PRD 要求**：多智能体 Pipeline 执行时展示实时步骤进度  
**实现状态**：
- ✅ `orchestrator:progress` IPC 通道已在 preload 注册
- ✅ 后端 orchestrator 已推送 progress 事件
- ❌ 前端 Agents 页面未订阅 `orchestrator:progress` 事件
- ❌ 无步骤进度条/状态显示组件

#### Feature-7：邮箱渠道未实现（P1）
**PRD 要求**：支持 SMTP 邮件发送任务结果通知  
**实现状态**：
- ✅ `electron/channels/email/` 目录结构已规划
- ❌ 目录内无任何实现文件
- ❌ Channels UI 无邮箱配置入口

#### Feature-8：Skills AI 生成功能缺失（P2）
**PRD 要求**：根据用户需求 AI 自动生成技能  
**实现状态**：
- ❌ 无任何实现

---

### 3.3 安全漏洞

#### Vuln-1：IPC 参数验证不一致
**文件**：`electron/main/ipc-handlers.ts`  
**问题**：部分 handler 使用 `args[1] as string` 直接类型断言，未验证类型；`ipc-validators.ts` 已有验证工具但未被所有 handler 使用。

```typescript
// ❌ 不安全的参数获取
const sessionId = args[1] as string; // 未验证 args[1] 是否存在或是否为字符串

// ✅ 应该使用验证器
const sessionId = validateString(args[1], 'sessionId');
```

**影响**：恶意渲染进程可传入非预期类型导致主进程崩溃（DoS）。

#### Vuln-2：技能 endpoint URL 无域名白名单
**文件**：`electron/main/ipc-handlers.ts`，`/skill` 命令处理  
**问题**：技能工具的 `endpoint` 字段直接被 `fetch()` 调用，无域名白名单检查，恶意技能可访问任意 URL 包括内网地址（SSRF）。

#### Vuln-3：rate-limiter 未全局启用
**文件**：`electron/security/rate-limiter.ts` 存在，但未在 IPC handlers 中统一应用。

---

### 3.4 代码质量问题

| 问题 | 文件 | 说明 |
|------|------|------|
| 测试覆盖率极低 | 全局 | 仅 2 个 vitest 测试文件，33 个用例，核心 agent-executor/orchestrator 无测试 |
| 错误处理不统一 | ipc-handlers.ts | 部分 `throw Error`，部分 `return { success: false }`，渲染层处理不一致 |
| 设计预览 CDN 依赖 | design-preview.ts | `initDesignTemplate` 中使用 `cdn.tailwindcss.com`，离线环境不可用 |
| 中英文混合日志 | 全局 | console 日志同时出现中文和英文，不利于后续 i18n |
| 超时常量散布 | agent-executor.ts | 600000/180000 魔法数字，未提取到配置文件 |

---

## 第四部分：可执行改进方案

### 4.1 优先级矩阵

| 优先级 | 事项 | 预估工时 | 影响 |
|--------|------|----------|------|
| **P0-1** | 修复 embeddingAdapter 传入 chat:send | 1h | 记忆系统全面生效 |
| **P0-2** | 新增 Memory 管理 UI（Settings → Memory 页） | 4h | 用户可管理记忆 |
| **P0-3** | 修复设计预览 URL 推送到前端 | 2h | 设计智能体预览可用 |
| **P1-1** | 修复 orchestrator:progress 前端监听 | 2h | Pipeline 进度可视化 |
| **P1-2** | 新增 Worktree 管理 UI | 4h | 多任务并行开发可用 |
| **P1-3** | 新增图片上传/发送支持 | 6h | Chat 多模态 |
| **P1-4** | 修复并行 fastest 策略 abort Bug | 1h | Orchestrator 稳定性 |
| **P1-5** | IPC 参数验证统一 | 3h | 安全加固 |
| **P1-6** | 技能 endpoint URL 白名单 | 1h | SSRF 防护 |
| **P2-1** | 邮箱渠道实现 | 8h | 任务通知完整 |
| **P2-2** | Memory 知识图谱增强 | 12h | 跨会话持久记忆 |

---

### 方案一：修复 Bug-1（embeddingAdapter 传入）

**文件**：`electron/main/ipc-handlers.ts`  
**位置**：`chat:send` handler，`agentExecutor.execute()` 调用处（约第 760 行）

**执行步骤**：

```typescript
// Step 1: 在 chat:send handler 顶部，API mode 下创建 embeddingAdapter
let embeddingAdapter = null;
if (mode === 'api' && providerId) {
  const key = await getApiKey(providerId);
  const provider = registry.getById(providerId);
  if (provider && key) {
    embeddingAdapter = createEmbeddingAdapter(provider, key);
  }
}

// Step 2: 将 embeddingAdapter 传入 agentExecutor.execute()
agentExecutor.execute({
  sessionId, prompt, workDirectory, agentType, mode,
  cliBackend, providerId, modelId, apiKey, baseUrl, apiProtocol,
  embeddingAdapter,   // ← 新增这一行
  onEvent: (event) => { ... }
});
```

**验证方法**：
1. 启动应用，配置 Ollama（本地）或 Anthropic API 作为 Provider
2. 在 Chat 中发送几条消息
3. 调用 `ipc.memoryStats()` 确认 `totalChunks > 0` 且 `chunksWithEmbeddings > 0`

---

### 方案二：新增 Memory 管理 UI

**位置**：Settings 页面新增 Memory 子页面

**执行步骤**：

**Step 1** — 创建 `src/pages/Settings/Memory.tsx` 组件，包含：
- 记忆统计卡片（totalChunks、totalSummaries、chunksWithEmbeddings）
- 记忆配置项（compactRatio 滑块、keepRecentMessages 数字输入、embeddingEnabled 开关）
- 当前会话记忆搜索（输入关键词 → 展示相关记忆）
- 清空记忆按钮（当前会话 / 全部）

**Step 2** — 在 `src/pages/Settings/index.tsx` 的 `SETTINGS_NAV` 中增加 Memory 项：
```typescript
{ label: '记忆', path: '/settings/memory', icon: Brain }
```

**Step 3** — 在 Settings Routes 中注册：
```typescript
<Route path="memory" element={<MemorySettings />} />
```

---

### 方案三：修复设计预览 URL 推送

**文件**：`electron/engine/agent-executor.ts` + `electron/main/ipc-handlers.ts`

**执行步骤**：

**Step 1** — 在 `CodingAgentEvent` 类型中增加 `preview_ready` 事件：
```typescript
// electron/providers/types.ts
| { type: 'preview_ready'; previewUrl: string; directory: string }
```

**Step 2** — 在 `executeSpecializedAgent`（设计智能体）启动预览后推送事件：
```typescript
const previewUrl = await startPreviewServer(workDirectory);
options.onEvent({ type: 'preview_ready', previewUrl, directory: workDirectory });
```

**Step 3** — 在 `chat:send` 的 `onEvent` 中处理 `preview_ready`：
```typescript
if (event.type === 'preview_ready') {
  mainWindow.webContents.send('chat:stream', {
    sessionId, messageId: assistantMessageId,
    type: 'preview_ready',
    previewUrl: event.previewUrl,
    timestamp: Date.now(),
  });
}
```

**Step 4** — 前端 `src/stores/chat.ts` 监听 `preview_ready` 并存储 previewUrl 到 session state

**Step 5** — `Chat/index.tsx` 根据 agentType 和 previewUrl 切换右侧面板：
```typescript
{agentType === 'design' && previewUrl
  ? <DesignPreview url={previewUrl} />
  : <ReviewPanel />
}
```

---

### 方案四：修复 orchestrator:progress 前端监听

**文件**：`src/pages/Agents/index.tsx`

**执行步骤**：

**Step 1** — 在 AgentsPage 组件中添加 progress 状态：
```typescript
const [pipelineProgress, setPipelineProgress] = useState<PipelineProgress | null>(null);
```

**Step 2** — 在 useEffect 中订阅 orchestrator:progress：
```typescript
useEffect(() => {
  const unsub = window.electron?.ipcRenderer.on(
    'orchestrator:progress',
    (progress: PipelineProgress) => setPipelineProgress(progress)
  );
  return () => unsub?.();
}, []);
```

**Step 3** — 展示 Pipeline 执行进度：
- 每个 Step 显示 pending/running/completed/failed/skipped 状态
- 当前运行步骤高亮 + 加载动画
- 完成后显示每步耗时和输出摘要

---

### 方案五：新增 Worktree 管理 UI

**文件**：`src/pages/Chat/index.tsx` 中左侧栏

**执行步骤**：

**Step 1** — 在 `src/stores/git.ts` 中增加 worktree 状态：
```typescript
worktrees: GitWorktree[];
loadWorktrees: () => Promise<void>;
createWorktree: (branch: string, path: string) => Promise<void>;
removeWorktree: (path: string) => Promise<void>;
```

**Step 2** — 在 Chat 左侧栏（SessionList 下方）增加 Worktrees 区块：
```
── Worktrees ────────────
  main  (当前)
  feature/task-001
  + 新建工作区
```

**Step 3** — 点击 Worktree 时切换 workDirectory 并刷新 ReviewPanel 的 git diff

---

### 方案六：图片上传/发送支持

**执行步骤**：

**Step 1** — `src/components/chat/ChatInput.tsx` 增加图片按钮 + 拖拽上传区域

**Step 2** — 选择图片后通过 Electron dialog API 读取文件，转为 base64

**Step 3** — `chat:send` IPC 增加 `attachments` 字段：
```typescript
interface SendOptions {
  attachments?: Array<{ type: 'image'; base64: string; mimeType: string }>;
}
```

**Step 4** — API mode 下将图片附件加入 Anthropic messages 的 content 数组（vision 支持）

**Step 5** — `MessageBubble.tsx` 增加图片渲染逻辑

---

### 方案七：IPC 参数验证统一（安全加固）

**执行步骤**：

**Step 1** — 在 `electron/security/ipc-validators.ts` 完善验证函数：
```typescript
export function requireString(val: unknown, name: string): string { ... }
export function requireObject(val: unknown, name: string): Record<string, unknown> { ... }
```

**Step 2** — 对 `chat:send`、`sessions:create`、`providers:configure` 等高风险 handler 全部替换为验证器

**Step 3** — 技能 endpoint 增加域名白名单检查：
```typescript
const ALLOWED_SKILL_HOSTS = ['localhost', '127.0.0.1', '::1'];
function validateSkillEndpoint(url: string): void {
  const parsed = new URL(url);
  if (!ALLOWED_SKILL_HOSTS.includes(parsed.hostname) && !isInAllowlist(parsed.hostname)) {
    throw new Error(`Skill endpoint host not allowed: ${parsed.hostname}`);
  }
}
```

---

## 第五部分：Claude Memory + Agent Team 在本项目的最佳实践

### 5.1 记忆分层设计建议

```
当前设计（已有）：               建议增强（新增）：
├── 短期记忆（对话 context）      ├── 用户偏好记忆（跨会话持久）
├── 压缩摘要（session 级）        ├── 项目知识库（工作区级）
└── BM25 + 向量搜索               └── 技能使用历史（智能推荐）
```

**用户偏好记忆**实现建议：
- 在 `memory_chunks` 中增加 `source = 'user_preference'` 类型
- 识别用户消息中的偏好表达（"我喜欢用 TypeScript"、"不要加注释"等）
- 每次对话开始时自动注入用户偏好

### 5.2 多智能体协作最佳实践

建议在现有 Orchestrator 基础上增加以下**预设 Pipeline 模板**：

```yaml
# 需求到代码全流程
Pipeline: "需求 → 代码"
steps:
  - agent: requirements
    prompt: "分析以下需求，生成 PRD"
  - agent: design       # 并行
    agent: coding       # 并行
    merge: all
  - agent: testing
    input: previous_step
    condition: "not_empty"

# 代码审查 + 修复
Pipeline: "代码审查"
steps:
  - agent: testing
    prompt: "检查代码质量，生成报告"
  - agent: coding
    input: previous_step
    prompt: "根据审查报告修复问题"
    condition: "contains:问题"
```

### 5.3 与 Claude Code Agent Teams 的结合

当 ClawDesktop2 用 `claude` CLI 作为编码后端时，可利用 Claude Code 的 Agent Teams 特性：
- 主 Chat 会话作为 Orchestrator
- 为每个任务启动独立的 claude 子会话
- 通过 `--resume` 参数实现跨会话连续性
- 当前 `CodingSession.sessionId` 机制已为此预留接口

---

## 附录：快速行动清单

以下是按优先级排列的可立即执行的代码修改，每项均有明确文件和行号：

```
🔴 立即修复（1天内）：
□ ipc-handlers.ts:760 — 给 agentExecutor.execute() 传入 embeddingAdapter
□ agent-executor.ts — 增加 preview_ready 事件类型和推送逻辑
□ orchestrator.ts:executeParallelGroup — 修复 fastest 策略 abort 目标

🟡 本周完成（1周内）：
□ Settings/Memory.tsx — 新建 Memory 管理页面（复用 useMemoryStore）
□ Settings/index.tsx — SETTINGS_NAV 添加 Memory 项
□ Agents/index.tsx — 订阅 orchestrator:progress 并展示进度
□ Chat/index.tsx — 根据 agentType 切换右侧面板（Review vs DesignPreview）

🟢 迭代完成（2-3周）：
□ Chat 左侧栏 — 新增 Worktree 管理区块
□ ChatInput.tsx — 新增图片上传功能
□ ipc-validators.ts — 统一 IPC 参数验证
□ 技能 endpoint — 增加域名白名单
□ electron/channels/email/ — 实现 SMTP 邮件通知
```

---

> 文档版本：v1.0  
> 生成时间：2026-03-04  
> 下一步：用户确认优先级后，逐项执行修复
