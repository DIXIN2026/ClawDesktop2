# ClawDesktop2 产品需求文档 (PRD) - 最终确定版

> 版本: v3.1
> 创建日期: 2026-02-28
> 更新日期: 2026-02-28
> 状态: 待用户审核
> 架构方案: 混合架构（NanoClaw 模式 + OpenClaw 飞书提取 + 多模型 Provider 系统）

---

## 一、产品概述

### 1.1 产品定位

**ClawDesktop2** 是一款多 Agents 智能体可视化桌面应用。采用 NanoClaw 的安全架构模式，直接集成 Claude Agent SDK 驱动四大专业智能体（编码/需求/设计/测试），提取 OpenClaw 飞书扩展实现渠道通信，借鉴 Codex 桌面版的三面板 UI 架构。

### 1.2 核心价值

- **多智能体协作**：四大专业智能体覆盖软件开发全生命周期
- **多模型支持**：统一 Provider 系统，支持 Local CLI / API Key / Coding Plan 三类接入，每个智能体可独立配置模型
- **安全可控**：NanoClaw 级别的 OS 容器隔离 + 挂载安全 + IPC 授权
- **轻量独立**：不依赖 OpenClaw Gateway，单进程内嵌服务，秒级启动
- **飞书集成**：提取 OpenClaw 飞书扩展，支持流式卡片、WebSocket 双向通信
- **技能扩展**：集成 ClawHub 技能商店，支持 AI 自动生成技能

### 1.3 架构决策记录

| 决策项 | 选择 | 依据 |
|--------|------|------|
| 是否依赖 OpenClaw | 否 | NanoClaw 独立运行更轻量，自定义空间大 |
| AI 运行时 | 多模型 Provider 系统 | 借鉴 OpenClaw Provider + opencode 多模型设计 |
| 飞书渠道 | 提取 OpenClaw `/extensions/feishu/` | 已有完整实现，可独立运行 |
| 安全机制 | NanoClaw 容器隔离模式 | OS 级隔离优于应用层权限检查 |
| 桌面 UI 架构 | Codex 桌面版三面板布局 | 左侧栏 + 中央对话 + 右侧 Diff/Review |
| 代码编辑器 | CodeMirror 6 | 轻量、模块化、适合嵌入式场景 |
| 组件库 | shadcn/ui | 无锁定、可定制、与 TailwindCSS 深度集成 |
| 容器运行时 | Docker（macOS 检测到 Apple Container 时自动切换） | Docker 为默认，Apple Container 为 macOS 优化路径 |

---

## 二、核心功能模块

### 2.1 多 Agents 智能体系统

#### 2.1.1 编码智能体 (Coding Agent)

**职责**：执行代码编写、修改、重构等开发任务

**核心能力**：
| 能力 | 描述 | 优先级 |
|------|------|--------|
| 代码生成 | 根据需求文档生成代码 | P0 |
| 代码修改 | 修改指定文件或代码块 | P0 |
| Git 操作 | commit, branch, worktree 管理 | P0 |
| Diff 预览 | 实时展示代码变更对比 | P0 |
| 工具调用展示 | Chat 中实时展示 Agent 的每步操作（读文件、执行命令、编辑等） | P0 |
| 审批流程 | 敏感操作（Shell 命令、工作区外写入）弹窗审批 | P0 |
| Undo/Redo | 基于 Git 快照的操作回滚（回滚上一轮 Agent 的所有变更） | P1 |
| 代码重构 | 智能代码重构建议与执行 | P2 |

##### 执行模式

编码智能体采用 **CLI 优先策略**。启动时自动检测本地已安装的 AI 编码 CLI，用户在 Settings → Providers 中选定一个 CLI 作为编码后端。若无任何 CLI 可用，降级为通过 Provider 系统 API 直连模式（容器内运行）。

```
┌─────────────────────────────────────────────────────────────────┐
│                    编码智能体双模式架构                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  模式 A: CLI 后端（默认，宿主进程子进程）                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 检测已安装 CLI → 用户选定后端 → 子进程调用                  │  │
│  │                                                           │  │
│  │ • claude   → JSONL 事件流 (--output-format stream-json)   │  │
│  │ • opencode → JSONL 事件流 (--output json)                 │  │
│  │ • gemini   → JSONL 事件流 (--output json)                 │  │
│  │                                                           │  │
│  │ 安全模型: CLI 自身沙箱（claude 有 Seatbelt/Landlock,      │  │
│  │          opencode 有 workspace 限制）                      │  │
│  │ 优势: 利用 CLI 自身工具链、hooks、上下文管理               │  │
│  │ 限制: 审批由 CLI 自身处理，ClawDesktop2 无法拦截           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  模式 B: API 直连（降级，容器内运行）                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 通过 Provider 系统调用 AI API，容器内执行                   │  │
│  │                                                           │  │
│  │ 工具集 (复用 NanoClaw allowedTools):                      │  │
│  │ • Bash, Read, Write, Edit, Glob, Grep — 文件/Shell       │  │
│  │ • WebSearch, WebFetch — 联网搜索                          │  │
│  │ • Task, TaskOutput — 子任务                               │  │
│  │                                                           │  │
│  │ 安全模型: 三层安全（审批 + 挂载白名单 + 容器隔离）          │  │
│  │ 优势: 完全可控的审批流程，支持任意 Provider 模型           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  统一输出层 (两种模式共用):                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ CodingAgentEvent 统一事件流:                               │  │
│  │ • text_delta    — 模型文字流 (Chat 面板实时渲染)          │  │
│  │ • tool_start    — 工具开始 (展示 emoji + 工具名 + 参数)   │  │
│  │ • tool_output   — 工具输出 (折叠展示，可展开)             │  │
│  │ • tool_end      — 工具完成 (耗时 + 结果摘要)             │  │
│  │ • file_changed  — 文件变更 (触发 Review 面板 Diff 更新)   │  │
│  │ • approval_req  — 审批请求 (弹窗，仅 API 模式)           │  │
│  │ • turn_end      — 本轮完成 (创建 Git 快照用于 Undo)      │  │
│  │ • error         — 错误 (展示错误信息 + 重试按钮)         │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

##### CLI Agent 统一接口

```typescript
interface CliAgentBackend {
  id: string;              // 'claude-code', 'opencode', 'gemini-cli'
  name: string;            // 'Claude Code'
  command: string;         // CLI 可执行文件名
  installed: boolean;
  version?: string;
}

interface CliAgentRunner {
  detect(): Promise<{ installed: boolean; version?: string }>;

  execute(params: {
    prompt: string;
    workDirectory: string;
    sessionId?: string;    // 用于续接上次会话
    model?: string;
    timeout?: number;
  }): AsyncIterable<CodingAgentEvent>;   // 统一事件流

  abort(): Promise<void>;
}
```

**CLI 输出解析**：每种 CLI 都输出 JSONL 事件流，由对应适配器解析并映射为统一的 `CodingAgentEvent`：

| CLI | 启动参数 | 事件格式 | 适配重点 |
|-----|----------|----------|----------|
| `claude` | `--output-format stream-json -p <prompt> --cwd <dir>` | `{type, subtype, ...}` JSONL | tool_use/result 映射 |
| `opencode` | `--output json -m <model>` | JSONL 事件流 | 模型切换、file change 事件 |
| `gemini` | `--output json` | JSONL 事件流 | Google 特有工具格式转换 |

##### API 直连模式（容器内 Agent）

复用 NanoClaw 的容器 Agent 架构：

```typescript
// 容器内 Agent 执行流程（复用 NanoClaw container/agent-runner 模式）

// 1. 启动容器，通过 stdin 注入任务和密钥
containerInput = {
  prompt: string;
  sessionId?: string;       // SDK session ID
  resumeAt?: string;        // 从特定 assistant UUID 恢复
  workDirectory: string;
  secrets: Record<string, string>;  // API Key（stdin 注入，不落磁盘）
};

// 2. 容器内调用 Claude Agent SDK
for await (const message of query({
  prompt: messageStream,    // AsyncIterable — 保持 session 存活，允许多轮推入
  options: {
    cwd: '/workspace',
    resume: sessionId,
    allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
    permissionMode: 'bypassPermissions',
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [sanitizeBashHook] }],  // 清理密钥
      PreCompact: [archiveConversationHook],   // 压缩前归档对话
    }
  }
})) {
  writeOutput(message);     // Sentinel 标记协议输出
}

// 3. 主机解析 Sentinel 标记对
// ---NANOCLAW_OUTPUT_START---
// {"status":"success", "result":"...", "newSessionId":"..."}
// ---NANOCLAW_OUTPUT_END---
```

**MessageStream 多轮推入**（NanoClaw 关键创新）：容器不会在单次查询后销毁，而是通过 AsyncIterable 保持 SDK session 存活。用户在 Chat 中发送新消息时，直接推入 MessageStream，Agent 继续处理，无需重启容器。

##### 会话续接机制

```typescript
interface CodingSession {
  sessionId?: string;       // CLI session ID 或 SDK session ID
  resumeAt?: string;        // 最后 assistant message UUID（API 模式）
  mode: 'cli' | 'api';
  gitSnapshotRef?: string;  // 本轮开始前的 Git commit ref（用于 Undo）
}

// 续接流程:
// 1. Chat 会话恢复时，从 SQLite 读取 CodingSession
// 2. CLI 模式: 传入 sessionId 参数（claude --resume <id>）
// 3. API 模式: 传入 sessionId + resumeAt 给容器 SDK
// 4. 新 sessionId 从 Agent 输出中更新并持久化
```

##### 审批流程（API 直连模式）

参考 Codex 三模式 + OpenClaw 两阶段协议：

```
审批策略（用户可在 Settings 中配置）:
┌────────────────────────────────────────────────────────────────┐
│ suggest（默认）: 每个文件变更和 Shell 命令都需审批              │
│ auto-edit      : 文件变更自动通过，Shell 命令需审批            │
│ full-auto      : 工作区内操作自动通过，工作区外仍需审批        │
└────────────────────────────────────────────────────────────────┘

审批 UI 交互:
┌───────────────────────────────────────────┐
│ 🛠️ Shell 命令审批                         │
│ ┌───────────────────────────────────────┐ │
│ │ $ npm install express                 │ │
│ │ 工作目录: /Users/xxx/project          │ │
│ └───────────────────────────────────────┘ │
│                                           │
│ [批准] [批准并记住此类命令] [拒绝] [取消] │
└───────────────────────────────────────────┘
```

注意：CLI 模式下审批由 CLI 自身处理（如 claude 的 suggest/auto-edit/full-auto 模式），ClawDesktop2 不做额外拦截。

##### Undo/Redo 机制

基于 Git 快照实现（参考 Codex backtrack）：

```
每轮 Agent 执行前:
1. 记录当前 Git HEAD → gitSnapshotRef
2. 记录当前工作区 dirty 文件列表

每轮 Agent 执行后:
3. 用户可点击 [Undo] 回滚到 gitSnapshotRef:
   git stash      (保存 Agent 变更到 stash)
   git reset --hard gitSnapshotRef
4. 用户可点击 [Redo] 恢复:
   git stash pop   (恢复 Agent 变更)

多轮历史:
5. 每轮 turn_end 事件在 SQLite 记录 { turnId, gitSnapshotRef, timestamp }
6. 用户可在 Undo 历史面板选择任意轮次回滚
```

##### 工具调用展示（Chat 面板）

参考 OpenClaw tool-display 规格：

```
Chat 中工具调用展示:
┌──────────────────────────────────────────────────────┐
│ 🤖 编码智能体 (Claude Opus 4.6)                      │
│                                                      │
│ 让我先看看项目结构...                                  │
│                                                      │
│ 📖 Read src/index.ts                      [0.2s] ✅  │
│ ┊  ▸ 展开查看内容                                     │
│                                                      │
│ 🔍 Grep "export function" --type ts       [0.3s] ✅  │
│ ┊  ▸ 找到 12 个匹配                                  │
│                                                      │
│ 现在我来修改登录逻辑...                                │
│                                                      │
│ ✍️ Edit src/auth/login.ts                  [0.1s] ✅  │
│ ┊  ▸ 查看 Diff（+15, -3）                            │
│                                                      │
│ 🛠️ Shell: npm test                         等待审批  │
│ ┊  [批准] [拒绝]                                      │
│                                                      │
│ 🛠️ Shell: npm test                        [3.2s] ✅  │
│ ┊  ▸ 展开查看输出 (15 tests passed)                  │
│                                                      │
│ 修改完成，所有测试通过。                               │
│                                               [Undo] │
└──────────────────────────────────────────────────────┘
```

每个工具调用都可展开查看详细输入/输出，Edit 工具的变更会同步到右侧 Review 面板。

##### Review 面板联动

```
Agent 文件变更 → file_changed 事件 → Review 面板实时更新:

1. Agent 执行 Write/Edit/apply_patch → 触发 file_changed 事件
2. Review 面板收到事件 → 运行 git diff 获取最新变更
3. 文件列表自动更新:
   ┌─────────────────────┐
   │ Changed Files (3)   │
   │ A  src/new-file.ts  │   绿色 = 新增
   │ M  src/auth/login.ts│   黄色 = 修改
   │ D  src/old-utils.ts │   红色 = 删除
   └─────────────────────┘
4. 点击文件 → 展示该文件的 Diff
5. 支持逐文件/逐块 Stage/Revert（三级粒度）
6. Agent 轮次结束后 → 按钮: [Commit] [Push] [Undo 本轮]
```

##### 工作目录安全机制

复用 NanoClaw 挂载安全模块（仅 API 直连模式生效，CLI 模式由 CLI 自身沙箱保护）：
- 外部白名单 `~/.config/clawdesktop/mount-allowlist.json`（不在容器内挂载）
- 默认阻止模式: `.ssh, .gnupg, .aws, .env, credentials, id_rsa` 等
- 符号链接解析防遍历攻击
- 非主会话强制只读模式
- 工作目录外读写操作触发用户审批
- API Key 仅通过 stdin 注入容器（NanoClaw 零落地模式）
- PreToolUse Hook: 每次 Bash 命令前注入 `unset ANTHROPIC_API_KEY` 防止子进程继承密钥

##### 模型切换

用户可在 Chat 顶栏下拉菜单实时切换模型（参考 opencode `/models` 命令）。切换后：
- CLI 模式：传递 `--model` 参数给 CLI（如 `claude --model sonnet`）
- API 模式：更新 Provider 路由，下一条消息使用新模型
- 历史消息保留，`messages.model_used` 字段记录每条消息使用的模型

#### 2.1.2 需求智能体 (Requirements Agent)

**职责**：从用户想法到可执行需求文档的全流程管理

**工作流程**：
```
用户输入需求
    ↓
① 需求总结归纳 → 提炼核心功能点
    ↓
② 竞品调研 → 搜索 GitHub 项目、分析竞品
    ↓
③ 需求澄清 → 向用户提问确认关键细节
    ↓
④ 需求审核 → 可落地性、可执行性、安全性检查
    ↓
⑤ 生成 PRD → 结构化 Markdown 文档
    ↓
⑥ 用户审核 → 通过则完成，不通过则返回③循环
```

**输出产物**：
- 需求文档（Markdown）
- 功能清单（结构化 JSON）
- 技术栈建议
- 开发排期预估

**执行方式**：使用 Claude Agent SDK 直接驱动，无需容器隔离（纯文档生成任务）

#### 2.1.3 设计智能体 (Design Agent)

**职责**：根据需求文档生成可交互的 UI 原型

**核心能力**：
| 能力 | 描述 | 优先级 |
|------|------|--------|
| 页面结构设计 | 根据需求规划页面结构和组件树 | P0 |
| 组件代码生成 | 生成 React + shadcn/ui + TailwindCSS 组件 | P0 |
| 实时预览 | 内嵌 Vite Dev Server 实时渲染生成的组件 | P0 |
| 组件验证 | Babel AST 验证 import/JSX 合法性 + AI 自动修复 | P0 |
| 页面级迭代 | 用户在预览面板选择页面/组件，通过 Chat 指定修改 | P0 |
| AI 视觉反馈 | Agent 对生成结果截图 → 视觉模型自检 → 自动修复 | P1 |
| 响应式设计 | 多设备适配（桌面/平板/手机预览切换） | P1 |

##### 设计生成管线（参考 openv0 Multipass + OpenClaw Canvas + OpenPencil）

```
用户输入需求
    ↓
┌── Pass 1: 页面结构设计 ──────────────────────────────────────┐
│ AI 分析需求 → 输出结构化 JSON:                                │
│ {                                                            │
│   pages: [                                                   │
│     { name: "LoginPage", description: "...", components: [   │
│       { name: "LoginForm", props: [...], children: [...] }   │
│     ]}                                                       │
│   ],                                                         │
│   sharedComponents: ["Header", "Footer", "Sidebar"],         │
│   designTokens: { primary: "#2563eb", radius: "0.5rem" }    │
│ }                                                            │
└──────────────────────────────────────────────────────────────┘
    ↓
┌── Pass 2: 组件库上下文构建 ──────────────────────────────────┐
│ 从 shadcn/ui 组件库中检索相关组件的 API 文档和用法示例        │
│ • Button, Card, Dialog, Input, Table 等已有组件              │
│ • Lucide Icons 图标检索                                      │
│ • 构建 few-shot 上下文（随机采样组件示例，控制 token 预算）    │
└──────────────────────────────────────────────────────────────┘
    ↓
┌── Pass 3: 组件代码生成 ──────────────────────────────────────┐
│ AI 生成 React 组件代码:                                       │
│ • 约束: 仅使用 shadcn/ui + TailwindCSS + Lucide Icons        │
│ • 约束: 组件必须包含硬编码的 placeholder 数据（可预览）       │
│ • 约束: 每个组件独立文件，default export                      │
│ • 流式输出: 代码块逐步推送到预览面板                          │
└──────────────────────────────────────────────────────────────┘
    ↓
┌── Pass 4: AST 验证 + AI 修复循环 ────────────────────────────┐
│ Babel 解析生成的 JSX:                                         │
│ 1. 检查所有 import 是否在允许列表内（shadcn, lucide, react）  │
│ 2. 检查 JSX 中使用的组件是否都已 import                      │
│ 3. 移除未使用的 import                                        │
│ 4. 验证 TailwindCSS class 语法                               │
│                                                              │
│ 若验证失败 → 将错误信息反馈给 AI → 重新生成 → 最多重试 3 次   │
└──────────────────────────────────────────────────────────────┘
    ↓
┌── Pass 5: 写入文件 + 预览 ───────────────────────────────────┐
│ 写入工作目录 design/ 子目录:                                  │
│ design/                                                      │
│ ├── pages/                                                   │
│ │   ├── LoginPage.tsx                                        │
│ │   └── DashboardPage.tsx                                    │
│ ├── components/                                              │
│ │   ├── LoginForm.tsx                                        │
│ │   └── Sidebar.tsx                                          │
│ ├── tokens.css          # 设计令牌（CSS 变量）                │
│ ├── App.tsx             # 路由入口                            │
│ └── package.json        # 依赖声明                           │
│                                                              │
│ Vite Dev Server 自动热更新 → 预览面板实时渲染                  │
└──────────────────────────────────────────────────────────────┘
    ↓
┌── Pass 6 (P1): AI 视觉自检 ─────────────────────────────────┐
│ Agent 对预览面板截图 → 发送给视觉模型                         │
│ • 检查布局是否合理                                            │
│ • 检查组件是否正确渲染                                        │
│ • 发现问题 → 自动修复 → 重新截图验证                          │
│ 参考 OpenClaw Canvas 的 snapshot + A2UI 视觉反馈循环          │
└──────────────────────────────────────────────────────────────┘
```

##### 预览系统（参考 OpenClaw Canvas live-reload 机制）

```
预览架构:
┌────────────────────────────────────────────────────────────────┐
│                    设计预览面板                                  │
│                                                                │
│  ┌─ 预览区域（iframe） ────────────────────────────────────┐   │
│  │                                                         │   │
│  │  内嵌 Vite Dev Server (localhost:15173)                 │   │
│  │  ├── 监听 design/ 目录文件变更                           │   │
│  │  ├── HMR 热更新（Agent 每次写文件 → 自动刷新）           │   │
│  │  ├── TailwindCSS JIT 编译                               │   │
│  │  └── shadcn/ui 组件库预装                               │   │
│  │                                                         │   │
│  │  渲染: design/App.tsx → React Router → 各页面组件       │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                │
│  ┌─ 控制栏 ────────────────────────────────────────────────┐   │
│  │ [桌面] [平板] [手机]  |  页面: LoginPage ▼  | [刷新]   │   │
│  │                                                         │   │
│  │ 点击预览中的组件 → 高亮选中 → Chat 中自动填入:          │   │
│  │ "@设计 修改 LoginForm 组件: ..."                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

**预览 Vite Dev Server 生命周期**：
- 设计智能体首次执行时自动启动（端口 15173）
- 在 `design/` 目录初始化 Vite + React + TailwindCSS + shadcn/ui 模板
- Agent 每次写入/修改文件 → Vite HMR 自动热更新预览
- 支持设备尺寸切换（桌面 1440px / 平板 768px / 手机 375px）
- 用户关闭设计会话时自动停止 Dev Server

##### 迭代优化交互

```
用户在预览面板选中组件 → Chat 交互:

方式 1: 点击选中
  预览面板中点击 LoginForm → 自动填入 "@设计 修改 LoginForm:"
  用户补充: "... 添加记住密码复选框"

方式 2: 页面级指令
  "@设计 重新设计 DashboardPage，参考 Ant Design Pro 布局"

方式 3: 全局样式
  "@设计 将主色调从蓝色改为紫色" → 更新 tokens.css → 全局生效

迭代流程:
  用户指令 → Pass 3 (重新生成指定组件) → Pass 4 (验证) → Pass 5 (写入 + 预览)
  ※ 不重新执行 Pass 1-2，保留页面结构和上下文
```

##### 产出格式

```
design/
├── package.json          # { dependencies: { react, react-dom, react-router-dom, tailwindcss, ... } }
├── vite.config.ts        # Vite 配置（预览专用）
├── tailwind.config.ts    # TailwindCSS 配置
├── tokens.css            # 设计令牌: --color-primary, --radius, --font-family 等
├── App.tsx               # 路由入口（React Router）
├── pages/                # 页面组件（每页一个文件）
│   ├── LoginPage.tsx
│   └── DashboardPage.tsx
├── components/           # 共享组件
│   ├── Header.tsx
│   └── Sidebar.tsx
└── assets/               # 静态资源（图标、图片）
```

每个组件文件约束：
- TypeScript + JSX（`.tsx` 后缀）
- default export
- 仅依赖 `react`, `react-router-dom`, `@/components/ui/*`(shadcn), `lucide-react`
- TailwindCSS 原子类样式（不使用 `<style>` 块）
- 包含硬编码 placeholder 数据（可独立预览）

**执行方式**：容器内运行（API 直连模式），产出文件写入工作目录的 `design/` 子目录

#### 2.1.4 测试智能体 (Testing Agent)

**职责**：代码质量保证与测试执行

**工作流程**：
```
代码提交 → 静态分析 → 需求对照检查 → 生成测试 → 执行测试 → 质量报告
                                                    ↓
                                          发现问题 → 反馈到 Chat → 编码智能体修复
```

**核心检查项**：
- 需求完整性检查（对照 PRD）
- 代码规范检查（ESLint/TypeScript）
- 单元测试覆盖
- 安全漏洞扫描
- 性能指标检查

**输出报告**：
- 需求实现度评分（%）
- 代码质量评分（A/B/C/D）
- 测试覆盖率
- 问题清单与修复建议

**执行方式**：容器内运行，可访问工作目录（只读模式）

---

### 2.2 Skills 技能商店

#### 2.2.1 核心功能

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 技能浏览 | 浏览 ClawHub 所有可用技能 | P0 |
| 技能搜索 | 按关键词、类别搜索技能 | P0 |
| 技能安装 | 一键安装技能到本地 | P0 |
| 技能配置 | 配置技能参数 | P0 |
| 已安装管理 | 查看、更新、卸载已安装技能 | P0 |
| 技能更新 | 检测并更新技能版本 | P1 |
| AI 技能生成 | 根据用户需求自动生成定制技能 | P2 |

#### 2.2.2 技能来源

1. **ClawHub 官方仓库**（主要来源）
2. **Claude 官方 Skills**
3. **社区贡献**
4. **AI 生成**（P2）

#### 2.2.3 技能格式

采用 NanoClaw 的 Skills 格式（SKILL.md + manifest.yaml + add/ + modify/），兼容 Claude Code Skills 规范：

```
skills/{skill-name}/
  SKILL.md           # 技能说明文档
  manifest.yaml      # 元数据、依赖、环境变量
  tests/             # 集成测试
  add/               # 新增文件
  modify/            # 修改文件（三方合并）
```

#### 2.2.4 技能分类

```
技能分类：
├── 编码辅助（代码生成、审查、重构）
├── 文档处理（Markdown 生成、文档转换）
├── 数据处理（数据分析、可视化）
├── 自动化（定时任务、工作流）
└── 集成工具（GitHub、飞书、邮件）
```

---

### 2.3 定时任务管理

#### 2.3.1 任务类型

| 类型 | 格式 | 示例 |
|------|------|------|
| Cron 表达式 | 标准 cron | `0 9 * * 1` (每周一 9 点) |
| 间隔执行 | 毫秒间隔 | 每小时执行 |
| 一次性任务 | ISO 时间戳 | 2026-03-01 10:00 |

#### 2.3.2 执行模式（复用 NanoClaw 任务调度器设计）

```typescript
interface ScheduledTask {
  id: string;
  groupFolder: string;       // 关联的会话
  prompt: string;            // 执行指令
  scheduleType: 'cron' | 'interval' | 'once';
  scheduleValue: string;     // cron 表达式 / 毫秒数 / ISO 时间戳
  contextMode: 'isolated' | 'session';  // isolated: 独立上下文; session: 使用会话历史
  agentType: 'coding' | 'requirements' | 'design' | 'testing';
  status: 'active' | 'paused' | 'completed';
  nextRun: string;
  lastRun: string;
  reportChannel?: 'feishu' | 'email';  // 结果通知渠道
}
```

#### 2.3.3 管理界面

- 任务列表（状态、下次执行时间、历史记录）
- 创建/编辑任务表单
- 任务执行日志
- 任务开关控制

---

### 2.4 飞书渠道集成

#### 2.4.1 实现方案

**从 OpenClaw `/extensions/feishu/` 提取为独立模块**，该扩展已有完整实现：

| 能力 | OpenClaw 飞书扩展已有 | 说明 |
|------|---------------------|------|
| WebSocket 连接 | ✅ | 无需公网，适合本地桌面应用 |
| Webhook 回调 | ✅ | 需公网，作为备用方案 |
| 流式卡片 | ✅ | Card Kit 实时更新 |
| 富文本消息 | ✅ | Markdown、代码块、表格 |
| 消息分块 | ✅ | 4000 字符自动分块 |
| @提及处理 | ✅ | 群聊 @机器人触发 |
| 权限策略 | ✅ | DM/群聊策略、工具权限控制 |
| 多账号支持 | ✅ | 多租户配置 |

#### 2.4.2 双向通信

```
从 ClawDesktop2 发送到飞书：
Chat 消息 → 飞书格式化 → 流式卡片/文本 → 飞书 API

从飞书发送到 ClawDesktop2：
飞书消息 → WebSocket 接收 → 消息解析 → 权限检查 → 路由到对应 Agent → 执行 → 结果返回飞书
```

#### 2.4.3 配置项

```yaml
channels:
  feishu:
    enabled: true
    connectionMode: websocket   # 默认 websocket；仅当有公网 IP 时可手动切换为 webhook
    dmPolicy: open              # 默认开放私聊
    groupPolicy: open           # 默认开放群聊
    requireMention: true        # 群聊需要 @机器人
    streaming: true             # 启用流式卡片
    accounts:
      main:
        appId: "cli_xxx"
        appSecret: "xxx"
        botName: "ClawDesktop AI"
```

#### 2.4.4 邮箱渠道（P1）

支持通过邮箱发送任务执行结果通知，简单 SMTP 发送即可。

---

### 2.5 Chat 对话系统

#### 2.5.1 核心特性

| 特性 | 描述 | 优先级 |
|------|------|--------|
| 流式输出 | 实时展示 Agent 响应 | P0 |
| Markdown 渲染 | 支持 GFM 格式化显示 | P0 |
| 代码高亮 | 代码块语法高亮 | P0 |
| Diff 预览 | 代码变更差异对比（右侧 Review 面板，支持左右对比和行内模式） | P0 |
| Git 集成 | 右侧面板显示分支、文件变更，支持逐文件/逐块 stage/revert/commit/push | P0 |
| Undo/Redo | 操作历史记录，一键回滚上一轮 Agent 操作（参考 Codex backtrack） | P1 |
| Worktree 管理 | 创建隔离 Git 工作区，多任务并行开发 | P1 |
| 文件预览 | 预览代码文件、Markdown、图片 | P0 |
| 多会话管理 | 左侧栏管理独立会话，可关联任务/智能体 | P0 |
| 图片支持 | 发送和显示图片 | P1 |

#### 2.5.2 UI 布局（参考 Codex 桌面版三面板架构）

```
┌──────────────────────────────────────────────────────────────────┐
│ [左侧栏]              [中央对话面板]           [右侧 Review 面板] │
│                                                                  │
│ 会话列表               Agent 流式对话           Git Diff 视图     │
│ ├── 会话 1             ┌─────────────────┐     ┌──────────────┐  │
│ ├── 会话 2 (当前)      │ 消息流           │     │ 文件变更列表  │  │
│ ├── 会话 3             │ 代码块高亮       │     │ ├── file1.ts │  │
│ └── + 新会话           │ 工具调用展示     │     │ └── file2.ts │  │
│                        │                 │     │              │  │
│ ── Worktrees ──        │                 │     │ Diff 详情     │  │
│ ├── main              │                 │     │ (逐块 stage/  │  │
│ └── feature/xxx       │                 │     │  revert 控制) │  │
│                        │                 │     │              │  │
│                        ├─────────────────┤     │ [Commit]     │  │
│                        │ 输入框           │     │ [Push]       │  │
│                        │ @智能体 模型▼   │     │ [Create PR]  │  │
│                        └─────────────────┘     └──────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

右侧 Review 面板支持三级粒度操作（参考 Codex Review Pane）：
1. **全局级**：一键 Stage All / Revert All
2. **文件级**：逐文件 stage / unstage / revert
3. **代码块级**：逐 hunk stage / revert

#### 2.5.3 智能体交互方式

```
方式 1: 默认智能体
用户消息 → 当前选中的智能体处理

方式 2: @ 提及切换
@编码 修改登录页面 → 编码智能体处理
@需求 设计用户系统 → 需求智能体处理
@设计 设计登录页面 → 设计智能体处理
@测试 检查代码质量 → 测试智能体处理

方式 3: 任务驱动
从任务管理选择任务 → 自动创建会话 + Git 分支 → 编码智能体处理
```

---

### 2.6 安全机制

#### 2.6.1 安全架构（复用 NanoClaw 三层安全模型）

```
第一层: 用户审批层
┌─────────────────────────────────────────────────┐
│ • 工作目录外文件操作 → 弹窗审批                    │
│ • 敏感命令执行 → 确认对话框                        │
│ • 网络请求 → 域名白名单检查                        │
└─────────────────────────────────────────────────┘
                         ↓
第二层: 挂载安全模块（外部白名单，不在容器内）
┌─────────────────────────────────────────────────┐
│ • 白名单文件: ~/.config/clawdesktop/mount-allowlist.json │
│ • 阻止模式匹配 (.ssh, .aws, .env, credentials 等)│
│ • 符号链接解析防遍历攻击                           │
│ • 非主会话目录强制只读                             │
└─────────────────────────────────────────────────┘
                         ↓
第三层: 容器隔离层
┌─────────────────────────────────────────────────┐
│ • 进程隔离（容器内独立进程空间）                   │
│ • 文件系统隔离（仅挂载目录可见）                   │
│ • 网络隔离（默认禁用网络）                         │
│ • 非 root 用户 (uid 1000)                         │
│ • 临时容器（执行完毕自动销毁 --rm）                │
│ • Docker 为默认；macOS 检测到 Apple Container 自动切换 │
└─────────────────────────────────────────────────┘
```

#### 2.6.2 默认阻止模式

```typescript
const DEFAULT_BLOCKED_PATTERNS = [
  '.ssh', '.gnupg', '.aws', '.azure', '.gcloud', '.kube',
  '.docker', 'credentials', '.env', '.netrc', '.npmrc',
  '.pypirc', 'id_rsa', 'id_ed25519', 'private_key', '.secret'
];
```

#### 2.6.3 凭证安全（复用 NanoClaw 模式）

- API Key 仅通过 **stdin** 传入容器，不挂载为文件或环境变量
- 仅允许 `ANTHROPIC_API_KEY` 等必要凭证
- 日志中自动过滤凭证信息

#### 2.6.4 IPC 授权（复用 NanoClaw 模式）

- 每个会话拥有隔离的 IPC 命名空间
- 会话身份从目录结构验证（不信任 JSON 中的 sourceGroup）
- 非主会话不能操作其他会话的资源

---

### 2.7 预览功能

| 预览类型 | 支持格式 | 实现方式 |
|----------|----------|----------|
| 设计页面预览 | React 组件, HTML | 内嵌 iframe 沙箱渲染 |
| 代码文件预览 | 所有代码文件 | CodeMirror 6（只读模式） |
| Markdown 预览 | .md 文件 | react-markdown 渲染 |
| 图片预览 | png, jpg, gif, svg | 内置图片查看器 |
| Diff 预览 | Git diff | react-diff-viewer |

---

### 2.8 任务/Bug 管理系统

#### 2.8.1 任务状态流转

```
新建 → 待处理 → 进行中 → 待审核 → 已完成
  ↑                          │
  └──── 审核拒绝 ←───────────┘
```

#### 2.8.2 任务与 Chat 集成

```
1. 选择任务 → 点击"开始处理"
2. 自动创建专属 Chat 会话
3. 自动创建 Git 分支: feature/task-{id} 或 fix/bug-{id}
4. 在 Chat 中 @编码智能体 执行任务
5. 执行完毕 → 状态变为"待审核"
6. 用户审核通过 → "已完成"; 拒绝 → 返回"进行中"
```

#### 2.8.3 任务数据模型

```typescript
interface Task {
  id: string;
  title: string;
  description: string;
  type: 'feature' | 'bug' | 'improvement';
  status: 'new' | 'pending' | 'in_progress' | 'review' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignee: 'coding' | 'requirements' | 'design' | 'testing';
  chatSessionId?: string;
  gitBranch?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
```

---

### 2.9 多模型 Provider 系统

#### 2.9.1 功能概述

统一 Provider 系统支持三类 AI 接入方式，参考 OpenClaw Provider 架构和 opencode 多模型切换设计。每个智能体可独立配置模型，会话中可实时切换。

#### 2.9.2 Provider 三类接入

```
┌─────────────────────────────────────────────────────────────────┐
│                   Provider 系统 — 三类接入                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  类型 A: Local CLI（编码智能体专用）                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 检测本地已安装的 AI 编码 CLI，通过子进程调用              │    │
│  │ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────┐ │    │
│  │ │ claude     │ │ codex      │ │ opencode   │ │ gemini │ │    │
│  │ │ Claude Code│ │ Codex CLI  │ │ OpenCode   │ │Gemini  │ │    │
│  │ └────────────┘ └────────────┘ └────────────┘ └────────┘ │    │
│  │ 认证: CLI 自身管理                                        │    │
│  │ 用途: 编码智能体的 CLI 优先模式                            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  类型 B: API Key（标准 API 直连）                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 使用 API Key 直连厂商标准 API 端点                        │    │
│  │ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │    │
│  │ │Anthropic │ │ OpenAI   │ │ Google   │ │ DeepSeek     │ │    │
│  │ │ 标准 API │ │ 标准 API │ │ 标准 API │ │ 标准 API     │ │    │
│  │ └──────────┘ └──────────┘ └──────────┘ └──────────────┘ │    │
│  │ ┌──────────┐ ┌──────────┐ ┌────────────────────────────┐ │    │
│  │ │ Ollama   │ │OpenRouter│ │ 自定义 OpenAI 兼容端点     │ │    │
│  │ │ 本地模型 │ │ 路由     │ │ (用户自行填写 Base URL)    │ │    │
│  │ └──────────┘ └──────────┘ └────────────────────────────┘ │    │
│  │ 认证: API Key（存 OS 密钥链）                              │    │
│  │ 用途: 所有智能体的 API 直连模式                            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  类型 C: Coding Plan（订阅制，URL 不同于标准 API）               │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 使用专属 Coding Plan 端点，URL 与标准 API 不同            │    │
│  │                                                          │    │
│  │ ┌──────────────────────────────────────────────────────┐ │    │
│  │ │ 阿里云 Coding Plan (DashScope)                       │ │    │
│  │ │ Base URL: https://coding.dashscope.aliyuncs.com/v1   │ │    │
│  │ │ 协议: OpenAI 兼容                                     │ │    │
│  │ │ API Key 格式: sk-sp-xxxxx                             │ │    │
│  │ │ 模型: qwen-coder 系列                                 │ │    │
│  │ └──────────────────────────────────────────────────────┘ │    │
│  │                                                          │    │
│  │ ┌──────────────────────────────────────────────────────┐ │    │
│  │ │ Kimi Coding Plan (Moonshot)                          │ │    │
│  │ │ Base URL: https://api.kimi.com/coding/               │ │    │
│  │ │ 协议: Anthropic Messages API（注意：不是 OpenAI 兼容）│ │    │
│  │ │ API Key 格式: sk-kimi-xxxxxxxx                        │ │    │
│  │ │ 默认模型: k2p5 (Kimi K2.5)                            │ │    │
│  │ │ 上下文窗口: 262,144 tokens                            │ │    │
│  │ └──────────────────────────────────────────────────────┘ │    │
│  │                                                          │    │
│  │ ┌──────────────────────────────────────────────────────┐ │    │
│  │ │ 智谱 Coding Plan (Z.AI / GLM)                        │ │    │
│  │ │ Base URL (全球): https://api.z.ai/api/coding/paas/v4 │ │    │
│  │ │ Base URL (国内): https://open.bigmodel.cn/api/coding/paas/v4 │
│  │ │ 协议: OpenAI 兼容                                     │ │    │
│  │ │ 默认模型: glm-4.7                                     │ │    │
│  │ │ 注意: Coding Plan 不提供 glm-5，仅 glm-4.7 系列      │ │    │
│  │ └──────────────────────────────────────────────────────┘ │    │
│  │                                                          │    │
│  │ ┌──────────────────────────────────────────────────────┐ │    │
│  │ │ 火山引擎 Coding Plan (Doubao/ByteDance)              │ │    │
│  │ │ Base URL (国内): https://ark.cn-beijing.volces.com/api/coding/v3 │
│  │ │ Base URL (海外): https://ark.ap-southeast.bytepluses.com/api/coding/v3 │
│  │ │ 协议: OpenAI 兼容                                     │ │    │
│  │ │ 模型: ark-code-latest, doubao-seed-code, kimi-k2.5   │ │    │
│  │ └──────────────────────────────────────────────────────┘ │    │
│  │                                                          │    │
│  │ 认证: 各平台 API Key（存 OS 密钥链）                      │    │
│  │ 计费: 订阅制月费，非按 token 计费                          │    │
│  │ 用途: 所有智能体的 API 直连模式（替代标准 API Key）        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │            Provider 管理器                                │    │
│  │  • 自动发现（环境变量 + CLI + 本地服务）                   │    │
│  │  • 凭证管理（OS 密钥链 + stdin 传入容器）                  │    │
│  │  • 模型路由（智能体默认 → 任务覆盖 → 用户切换）           │    │
│  │  • 健康检查（启动时探测各 Provider 可用性）                │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

#### 2.9.3 Provider 配置数据模型

```typescript
// Provider 接入类型
type ProviderAccessType = 'local-cli' | 'api-key' | 'coding-plan';

// API 协议类型
type ApiProtocol = 'openai-compatible' | 'anthropic-messages' | 'ollama';

interface ProviderConfig {
  id: string;                    // 'anthropic', 'kimi-coding', 'zai-coding-global'
  name: string;                  // '阿里云 Coding Plan'
  accessType: ProviderAccessType;
  apiProtocol: ApiProtocol;
  baseUrl: string;               // API 端点
  envVar: string;                // 关联的环境变量名
  models: ModelDefinition[];
  status: 'available' | 'unconfigured' | 'error';
}

interface ModelDefinition {
  id: string;                    // 'claude-opus-4-6', 'k2p5', 'glm-4.7'
  name: string;                  // 'Claude Opus 4.6'
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: {
    reasoning: boolean;
    vision: boolean;
    codeGen: boolean;
    toolUse: boolean;
  };
  costPerMillionInput: number;   // 美元，Coding Plan 为 0
  costPerMillionOutput: number;
}
```

#### 2.9.4 模型引用格式

采用 OpenClaw 的 `provider/model-id` 格式：

```
anthropic/claude-opus-4-6          # Anthropic Claude
openai/gpt-4-turbo                 # OpenAI GPT
google/gemini-2.5-pro              # Google Gemini
deepseek/deepseek-r1               # DeepSeek
ollama/qwen2.5:32b                 # 本地 Ollama
kimi-coding/k2p5                   # Kimi Coding Plan
zai-coding/glm-4.7                 # 智谱 Coding Plan
dashscope-coding/qwen-coder        # 阿里云 Coding Plan
volcengine-coding/ark-code-latest  # 火山引擎 Coding Plan
```

#### 2.9.5 Provider 自动发现

```
启动时自动发现（按顺序执行）：

1. 环境变量扫描
   ANTHROPIC_API_KEY     → Anthropic Provider
   OPENAI_API_KEY        → OpenAI Provider
   GEMINI_API_KEY        → Google Provider
   DEEPSEEK_API_KEY      → DeepSeek Provider
   OPENROUTER_API_KEY    → OpenRouter Provider
   KIMI_API_KEY          → Kimi Coding Plan
   ZAI_API_KEY           → 智谱 Coding Plan
   DASHSCOPE_API_KEY     → 阿里云标准 API
   VOLCANO_ENGINE_API_KEY→ 火山引擎 Coding Plan
   BYTEPLUS_API_KEY      → BytePlus Coding Plan

2. 本地服务扫描
   localhost:11434 → Ollama（获取已下载模型列表）

3. CLI 工具检测（编码智能体）
   which claude   → Claude Code CLI
   which codex    → Codex CLI
   which opencode → OpenCode CLI
   which gemini   → Gemini CLI

4. 用户手动配置
   Settings → Providers 页面
```

#### 2.9.6 P0 支持的 Provider 列表

**类型 A: Local CLI**

| CLI | 命令 | 说明 |
|-----|------|------|
| **Claude Code** | `claude` | 最强编码能力，hooks 支持 |
| **Codex CLI** | `codex` | 自动沙箱，o4-mini |
| **OpenCode** | `opencode` | 多模型支持，Go 高性能 |
| **Gemini CLI** | `gemini` | Google 原生 |

**类型 B: API Key**

| 提供商 | API 协议 | 默认模型 | 环境变量 |
|--------|---------|----------|----------|
| **Anthropic** | anthropic-messages | Claude Opus 4.6 | `ANTHROPIC_API_KEY` |
| **OpenAI** | openai-compatible | GPT-4o | `OPENAI_API_KEY` |
| **Google** | openai-compatible | Gemini 2.5 Pro | `GEMINI_API_KEY` |
| **DeepSeek** | openai-compatible | DeepSeek V3 | `DEEPSEEK_API_KEY` |
| **Ollama** | ollama | 用户已下载模型 | 无需认证 |
| **OpenRouter** | openai-compatible | 路由到任意模型 | `OPENROUTER_API_KEY` |

**类型 C: Coding Plan**

| 提供商 | Base URL | API 协议 | 默认模型 | 环境变量 |
|--------|----------|---------|----------|----------|
| **阿里云** | `https://coding.dashscope.aliyuncs.com/v1` | openai-compatible | qwen-coder | `DASHSCOPE_API_KEY` (sk-sp-前缀) |
| **Kimi** | `https://api.kimi.com/coding/` | anthropic-messages | k2p5 | `KIMI_API_KEY` |
| **智谱(全球)** | `https://api.z.ai/api/coding/paas/v4` | openai-compatible | glm-4.7 | `ZAI_API_KEY` |
| **智谱(国内)** | `https://open.bigmodel.cn/api/coding/paas/v4` | openai-compatible | glm-4.7 | `ZAI_API_KEY` |
| **火山引擎(国内)** | `https://ark.cn-beijing.volces.com/api/coding/v3` | openai-compatible | ark-code-latest | `VOLCANO_ENGINE_API_KEY` |
| **火山引擎(海外)** | `https://ark.ap-southeast.bytepluses.com/api/coding/v3` | openai-compatible | ark-code-latest | `BYTEPLUS_API_KEY` |

#### 2.9.7 智能体默认模型配置

每个智能体的出厂默认模型如下，用户可在 Settings → Providers → 智能体默认模型中修改：

| 智能体 | 默认主模型 | 默认回退模型 |
|--------|-----------|-------------|
| 编码智能体 | `anthropic/claude-opus-4-6` | `openai/gpt-4o` |
| 需求智能体 | `anthropic/claude-sonnet-4-6` | `deepseek/deepseek-v3` |
| 设计智能体 | `anthropic/claude-opus-4-6` | `openai/gpt-4o` |
| 测试智能体 | `anthropic/claude-sonnet-4-6` | `deepseek/deepseek-v3` |

#### 2.9.8 会话中模型切换

Chat 顶栏显示当前智能体和模型，点击模型名称展开下拉菜单切换（参考 opencode `/models` 命令）：

```
Chat 顶栏:
┌──────────────────────────────────────────────┐
│ @编码智能体  │  模型: Claude Opus 4.6 ▼      │
│              │  ┌───────────────────────────┐ │
│              │  │ ── API Key ──            │ │
│              │  │ ★ Claude Opus 4.6        │ │
│              │  │   Claude Sonnet 4.6      │ │
│              │  │   GPT-4o                 │ │
│              │  │   DeepSeek V3            │ │
│              │  │ ── Coding Plan ──        │ │
│              │  │   Kimi K2.5              │ │
│              │  │   GLM 4.7               │ │
│              │  │ ── Local ──              │ │
│              │  │   Ollama: qwen2.5:32b    │ │
│              │  └───────────────────────────┘ │
└──────────────────────────────────────────────┘
```

切换后后续消息使用新模型处理，历史消息保留。

#### 2.9.9 CLI Agent 后端接口（编码智能体专用）

```typescript
interface CliAgentBackend {
  id: string;              // 'claude-code', 'codex', 'opencode', 'gemini-cli'
  name: string;            // 'Claude Code'
  command: string;         // CLI 命令名
  installed: boolean;
  version?: string;
}

interface CliAgentRunner {
  detect(): Promise<{ installed: boolean; version?: string }>;
  execute(params: {
    prompt: string;
    workDirectory: string;
    model?: string;
    timeout?: number;
  }): AsyncIterable<AgentOutput>;
  abort(): Promise<void>;
}
```

#### 2.9.10 凭证安全管理

- API Key 存储在 **OS 密钥链**（macOS Keychain / Windows Credential Manager）
- 运行时通过 **stdin** 传入容器
- 绝不明文存储在配置文件中
- Provider 配置（非密钥部分）存储在 SQLite

#### 2.9.11 Provider 配置界面

Settings → Providers 页面：

```
┌───────────────────────────────────────────────────────┐
│ AI 模型提供商                                          │
├───────────────────────────────────────────────────────┤
│                                                       │
│ ── API Key 提供商 ────────────────────────────────── │
│ ✅ Anthropic   Claude Opus/Sonnet/Haiku      [编辑]  │
│ ✅ OpenAI      GPT-4o                        [编辑]  │
│ ✅ DeepSeek    DeepSeek V3/R1                [编辑]  │
│ ⚙️ Google     发现 GEMINI_API_KEY            [启用]  │
│ ✅ Ollama      qwen2.5:32b, llama3.3         [编辑]  │
│                                                       │
│ ── Coding Plan 提供商 ──────────────────────────────│
│ ✅ Kimi Coding Plan    k2p5                  [编辑]  │
│ ✅ 智谱 Coding Plan    glm-4.7               [编辑]  │
│ ❌ 阿里云 Coding Plan  未配置                 [添加]  │
│                                                       │
│ ── 编码 CLI 工具 ──────────────────────────────────  │
│ ✅ claude  (v4.6.0) 已安装                            │
│ ✅ opencode(v2.1.0) 已安装                            │
│ ❌ gemini          未安装  [安装指南]                 │
│                                                       │
│ ── 智能体默认模型 ────────────────────────────────   │
│ 编码智能体:  [ Claude Opus 4.6      ▼ ]              │
│ 需求智能体:  [ Claude Sonnet 4.6    ▼ ]              │
│ 设计智能体:  [ Claude Opus 4.6      ▼ ]              │
│ 测试智能体:  [ Claude Sonnet 4.6    ▼ ]              │
│                                                       │
│ ── 自定义 OpenAI 兼容端点 ────────────────────────── │
│ [ + 添加自定义端点 ]                                  │
└───────────────────────────────────────────────────────┘
```

---

## 三、技术架构

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                  ClawDesktop2 桌面应用 (Electron)            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │           Electron 主进程 (Main Process)                │ │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────────────────┐  │ │
│  │  │ 窗口管理  │ │ 托盘管理  │ │ 内嵌服务（轻量级）    │  │ │
│  │  └──────────┘ └──────────┘ └────────────────────────┘  │ │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────────────────┐  │ │
│  │  │ IPC 桥接  │ │ 安全沙箱  │ │ 系统密钥链            │  │ │
│  │  └──────────┘ └──────────┘ └────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │ 核心引擎（NanoClaw 模式，单进程）                  │  │ │
│  │  │ ┌──────────┐ ┌──────────┐ ┌──────────┐           │  │ │
│  │  │ │容器运行器 │ │挂载安全  │ │IPC 授权  │           │  │ │
│  │  │ └──────────┘ └──────────┘ └──────────┘           │  │ │
│  │  │ ┌──────────┐ ┌──────────┐ ┌──────────┐           │  │ │
│  │  │ │任务调度器 │ │会话管理  │ │消息队列  │           │  │ │
│  │  │ └──────────┘ └──────────┘ └──────────┘           │  │ │
│  │  │ ┌──────────┐ ┌──────────┐ ┌──────────────┐       │  │ │
│  │  │ │飞书渠道  │ │Skills 管理│ │Provider 管理器│       │  │ │
│  │  │ └──────────┘ └──────────┘ └──────────────┘       │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                           │ IPC                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  React 渲染进程 — Codex 风格三面板布局                   │ │
│  │  ┌──────────┐ ┌──────────────────┐ ┌─────────────────┐ │ │
│  │  │ 左侧栏    │ │ 中央对话面板      │ │ 右侧 Review    │ │ │
│  │  │ 会话列表  │ │ Chat 流式对话     │ │ Git Diff 视图  │ │ │
│  │  │ Worktree │ │ 工具调用展示      │ │ Stage/Revert  │ │ │
│  │  └──────────┘ └──────────────────┘ └─────────────────┘ │ │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────────────────┐  │ │
│  │  │智能体管理│ │ Skills   │ │ 任务看板 / 定时任务    │  │ │
│  │  └──────────┘ └──────────┘ └────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
            │                            │
    Docker / Apple Container       飞书 WebSocket
    (编码/设计/测试智能体)           (双向通信)
```

**关键架构特点**：
- 无外部 Gateway 进程，核心引擎内嵌在 Electron 主进程（NanoClaw 模式）
- 三面板 UI 布局（参考 Codex 桌面版）：左侧栏 + 中央对话 + 右侧 Review
- 容器隔离在主进程中管理
- 飞书渠道作为独立模块在主进程运行
- 启动速度秒级

### 3.2 技术栈

| 层级 | 技术选型 | 版本 | 说明 |
|------|----------|------|------|
| **桌面框架** | Electron | 40+ | 跨平台桌面应用 |
| **UI 框架** | React | 19 | 组件化 UI |
| **状态管理** | Zustand | 5 | 轻量状态管理 |
| **样式** | TailwindCSS | 4 | 原子化 CSS |
| **组件库** | shadcn/ui | latest | 无锁定、可定制 |
| **代码编辑器** | CodeMirror | 6 | 轻量嵌入式代码编辑/预览 |
| **语言** | TypeScript | 5.9+ | 类型安全 |
| **构建** | Vite | 7 | 前端构建 |
| **AI SDK** | Claude Agent SDK | latest | 智能体驱动（API 降级模式后端） |
| **AI API** | 多模型 Provider | - | Local CLI / API Key / Coding Plan |
| **飞书 SDK** | @larksuiteoapi/node-sdk | ^1.59.0 | 飞书通信 |
| **容器** | Docker + Apple Container | - | Docker 默认；macOS 自动切换 |
| **数据库** | SQLite (better-sqlite3) | - | 本地数据存储 |
| **包管理** | pnpm | 9+ | 依赖管理 |
| **Diff 组件** | react-diff-viewer | - | Git Diff 展示 |
| **Markdown** | react-markdown | - | Markdown 渲染 |

### 3.3 目录结构

```
ClawDesktop2/
├── electron/                      # Electron 主进程
│   ├── main/                     # 主进程入口
│   │   ├── index.ts             # 应用入口
│   │   ├── ipc-handlers.ts      # IPC 处理器
│   │   ├── window.ts            # 窗口管理
│   │   ├── tray.ts              # 系统托盘
│   │   └── menu.ts              # 菜单管理
│   ├── engine/                    # 核心引擎（NanoClaw 模式）
│   │   ├── container-runner.ts  # 容器运行器（Docker 默认，macOS 检测 Apple Container）
│   │   ├── mount-security.ts    # 挂载安全模块
│   │   ├── ipc-auth.ts          # IPC 授权
│   │   ├── session-manager.ts   # 会话管理
│   │   ├── message-queue.ts     # 消息队列
│   │   ├── task-scheduler.ts    # 定时任务调度
│   │   └── agent-executor.ts    # Agent 执行器
│   ├── channels/                  # 渠道模块
│   │   ├── feishu/              # 飞书渠道（提取自 OpenClaw）
│   │   │   ├── index.ts
│   │   │   ├── bot.ts
│   │   │   ├── send.ts
│   │   │   ├── reply-dispatcher.ts
│   │   │   ├── monitor.ts
│   │   │   └── policy.ts
│   │   └── email/               # 邮箱渠道（P1）
│   ├── skills/                    # Skills 管理
│   │   ├── loader.ts            # 技能加载器
│   │   ├── registry.ts          # 技能注册表
│   │   └── clawhub.ts           # ClawHub 同步
│   ├── providers/                 # 多模型 Provider 系统
│   │   ├── registry.ts          # Provider 注册表
│   │   ├── discovery.ts         # 自动发现（环境变量 / CLI / 本地服务）
│   │   ├── router.ts            # 模型路由（智能体默认 → 任务覆盖 → 用户切换）
│   │   ├── adapters/            # API 适配器
│   │   │   ├── anthropic.ts     # Anthropic Messages API
│   │   │   ├── openai-compat.ts # OpenAI 兼容（OpenAI/Google/DeepSeek/OpenRouter/Coding Plan）
│   │   │   └── ollama.ts        # Ollama 本地模型
│   │   └── cli-agents/          # CLI Agent 后端（编码智能体）
│   │       ├── runner.ts        # 统一 CLI Runner 接口
│   │       ├── claude-code.ts   # Claude Code CLI
│   │       ├── codex.ts         # OpenAI Codex CLI
│   │       ├── opencode.ts      # OpenCode CLI
│   │       └── gemini-cli.ts    # Gemini CLI
│   ├── security/                  # 安全模块
│   │   ├── sandbox.ts           # 容器沙箱配置
│   │   ├── approval.ts          # 审批流程
│   │   └── credential.ts        # 凭证管理（密钥链 + stdin）
│   ├── preload/                   # 预加载脚本
│   │   └── index.ts             # IPC 桥接（白名单模式）
│   ├── utils/                     # 工具函数
│   │   ├── secure-storage.ts    # OS 密钥链
│   │   ├── device-identity.ts   # 设备认证
│   │   ├── logger.ts            # 日志
│   │   └── db.ts                # SQLite 操作
│   └── types/                     # 类型定义
│
├── src/                           # React 渲染进程
│   ├── App.tsx                   # 根组件 + 路由
│   ├── main.tsx                  # 入口
│   ├── pages/                    # 页面
│   │   ├── Chat/                # Chat 对话（三面板布局主页）
│   │   ├── Agents/              # 智能体管理
│   │   ├── Skills/              # Skills 商店
│   │   ├── Tasks/               # 任务管理看板
│   │   ├── Schedule/            # 定时任务
│   │   ├── Channels/            # 渠道配置
│   │   ├── Settings/            # 设置
│   │   └── Setup/               # 初始设置向导
│   ├── components/               # 公共组件
│   │   ├── ui/                  # shadcn/ui 基础组件
│   │   ├── chat/                # Chat 相关组件
│   │   ├── diff/                # Diff 视图组件
│   │   ├── review/              # 右侧 Review 面板（Git Diff + Stage/Revert）
│   │   ├── preview/             # 预览组件
│   │   ├── task-board/          # 任务看板
│   │   └── layout/              # 三面板布局组件
│   ├── stores/                   # Zustand 状态
│   │   ├── chat.ts
│   │   ├── agents.ts
│   │   ├── providers.ts
│   │   ├── skills.ts
│   │   ├── tasks.ts
│   │   ├── schedule.ts
│   │   ├── channels.ts
│   │   └── settings.ts
│   ├── hooks/                    # 自定义 Hooks
│   ├── services/                 # 服务层
│   │   └── ipc.ts               # IPC 调用封装
│   ├── types/                    # 类型定义
│   └── utils/                    # 工具函数
│
├── container/                     # 容器镜像
│   ├── Dockerfile               # 容器构建文件
│   ├── build.sh                 # 构建脚本
│   ├── agent-runner/            # 容器内 Agent 运行器
│   └── skills/                  # 内置技能
│
├── resources/                     # 应用资源
│   ├── icons/
│   └── assets/
│
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── electron-builder.yml
└── CLAUDE.md                     # Claude Code 协作规范
```

### 3.4 数据模型（SQLite）

```sql
-- 智能体配置
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('coding', 'requirements', 'design', 'testing')),
  status TEXT DEFAULT 'idle' CHECK(status IN ('idle', 'running', 'error')),
  config TEXT NOT NULL,  -- JSON: systemPrompt, skills, containerEnabled
  stats TEXT DEFAULT '{}',  -- JSON: totalTasks, successRate, avgTime
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Chat 会话
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  agent_id TEXT,
  task_id TEXT,
  work_directory TEXT,
  current_model TEXT,  -- 当前会话使用的模型 (provider/model-id 格式)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 消息记录
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  model_used TEXT,     -- 生成此消息的模型 (provider/model-id 格式)
  attachments TEXT,    -- JSON
  tool_calls TEXT,     -- JSON
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
);
CREATE INDEX idx_messages_session ON messages(session_id, created_at);

-- 任务/Bug
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK(type IN ('feature', 'bug', 'improvement')),
  status TEXT DEFAULT 'new' CHECK(status IN ('new', 'pending', 'in_progress', 'review', 'completed')),
  priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
  assignee TEXT CHECK(assignee IN ('coding', 'requirements', 'design', 'testing')),
  chat_session_id TEXT,
  git_branch TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_tasks_status ON tasks(status);

-- 定时任务
CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  schedule_type TEXT NOT NULL CHECK(schedule_type IN ('cron', 'interval', 'once')),
  schedule_value TEXT NOT NULL,
  context_mode TEXT DEFAULT 'isolated' CHECK(context_mode IN ('isolated', 'session')),
  agent_type TEXT NOT NULL CHECK(agent_type IN ('coding', 'requirements', 'design', 'testing')),
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed')),
  next_run TEXT,
  last_run TEXT,
  last_result TEXT,
  report_channel TEXT CHECK(report_channel IN ('feishu', 'email')),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_scheduled_next ON scheduled_tasks(next_run);

-- 任务执行日志
CREATE TABLE task_run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  run_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'failure', 'timeout')),
  result TEXT,
  error TEXT,
  FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
);

-- AI Provider 配置（非密钥部分，密钥存 OS 密钥链）
CREATE TABLE providers (
  id TEXT PRIMARY KEY,                -- 'anthropic', 'kimi-coding', 'zai-coding-global'
  name TEXT NOT NULL,
  access_type TEXT NOT NULL CHECK(access_type IN ('local-cli', 'api-key', 'coding-plan')),
  api_protocol TEXT CHECK(api_protocol IN ('anthropic-messages', 'openai-compatible', 'ollama')),
  base_url TEXT,
  env_var TEXT,                       -- 关联环境变量名
  status TEXT DEFAULT 'unconfigured' CHECK(status IN ('available', 'unconfigured', 'error')),
  discovered_from TEXT CHECK(discovered_from IN ('env', 'config', 'cli-detect', 'local-service', 'manual')),
  config TEXT,                        -- JSON: 额外配置
  updated_at TEXT NOT NULL
);

-- 模型目录
CREATE TABLE models (
  id TEXT NOT NULL,                   -- 'claude-opus-4-6', 'k2p5', 'glm-4.7'
  provider_id TEXT NOT NULL,          -- 'anthropic', 'kimi-coding'
  name TEXT NOT NULL,                 -- 'Claude Opus 4.6', 'Kimi K2.5'
  context_window INTEGER NOT NULL,
  max_output_tokens INTEGER NOT NULL,
  capabilities TEXT NOT NULL,         -- JSON: { reasoning, vision, codeGen, toolUse }
  cost_input REAL DEFAULT 0,          -- 每百万 token 美元（Coding Plan 为 0）
  cost_output REAL DEFAULT 0,
  PRIMARY KEY (provider_id, id),
  FOREIGN KEY (provider_id) REFERENCES providers(id)
);

-- 智能体模型映射
CREATE TABLE agent_model_mappings (
  agent_type TEXT PRIMARY KEY CHECK(agent_type IN ('coding', 'requirements', 'design', 'testing')),
  primary_model TEXT NOT NULL,        -- 'anthropic/claude-opus-4-6'
  fallback_model TEXT,                -- 'openai/gpt-4o'
  cli_backend TEXT,                   -- 'claude-code' | 'opencode' (编码智能体专用)
  updated_at TEXT NOT NULL
);

-- Skills 安装记录
CREATE TABLE installed_skills (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  category TEXT,
  config TEXT,  -- JSON
  installed_at TEXT NOT NULL
);

-- 飞书渠道状态
CREATE TABLE channel_state (
  channel TEXT PRIMARY KEY,
  config TEXT NOT NULL,  -- JSON
  status TEXT DEFAULT 'disconnected' CHECK(status IN ('connected', 'disconnected', 'error')),
  updated_at TEXT NOT NULL
);

-- Claude Agent 会话 ID
CREATE TABLE agent_sessions (
  session_key TEXT PRIMARY KEY,
  session_id TEXT NOT NULL
);

-- 路由状态
CREATE TABLE router_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

---

## 四、IPC 通道设计

### 4.1 主进程 ↔ 渲染进程

| 通道 | 方向 | 描述 |
|------|------|------|
| `engine:status` | Main → Renderer | 引擎状态变更 |
| `chat:send` | Renderer → Main | 发送消息 |
| `chat:stream` | Main → Renderer | 流式响应推送 |
| `chat:abort` | Renderer → Main | 中止执行 |
| `chat:history` | Renderer → Main | 获取历史消息 |
| `chat:switch-model` | Renderer → Main | 会话中切换模型 |
| `sessions:list` | Renderer → Main | 列出会话 |
| `sessions:create` | Renderer → Main | 创建会话 |
| `sessions:delete` | Renderer → Main | 删除会话 |
| `agents:list` | Renderer → Main | 列出智能体 |
| `agents:config` | Renderer → Main | 配置智能体 |
| `agents:stats` | Main → Renderer | 智能体状态更新 |
| `agents:set-model` | Renderer → Main | 设置智能体默认模型 |
| `skills:search` | Renderer → Main | 搜索技能 |
| `skills:install` | Renderer → Main | 安装技能 |
| `skills:uninstall` | Renderer → Main | 卸载技能 |
| `skills:list` | Renderer → Main | 已安装列表 |
| `tasks:list` | Renderer → Main | 任务列表 |
| `tasks:create` | Renderer → Main | 创建任务 |
| `tasks:update` | Renderer → Main | 更新任务 |
| `tasks:delete` | Renderer → Main | 删除任务 |
| `schedule:list` | Renderer → Main | 定时任务列表 |
| `schedule:create` | Renderer → Main | 创建定时任务 |
| `schedule:toggle` | Renderer → Main | 暂停/恢复定时任务 |
| `schedule:delete` | Renderer → Main | 删除定时任务 |
| `channels:status` | Main → Renderer | 渠道状态 |
| `channels:config` | Renderer → Main | 渠道配置 |
| `channels:test` | Renderer → Main | 测试连接 |
| `approval:request` | Main → Renderer | 安全审批请求弹窗 |
| `approval:response` | Renderer → Main | 审批结果 |
| `providers:list` | Renderer → Main | 列出所有 Provider（含三类） |
| `providers:discover` | Renderer → Main | 触发自动发现 |
| `providers:configure` | Renderer → Main | 配置 Provider（设置 API Key） |
| `providers:models` | Renderer → Main | 获取指定 Provider 可用模型列表 |
| `providers:health` | Renderer → Main | 检查 Provider 健康状态 |
| `providers:cli-status` | Renderer → Main | 获取 CLI 工具安装状态 |
| `settings:get` | Renderer → Main | 获取设置 |
| `settings:set` | Renderer → Main | 保存设置 |
| `file:open` | Renderer → Main | 打开文件 |
| `directory:select` | Renderer → Main | 选择目录 |
| `git:status` | Renderer → Main | Git 状态 |
| `git:diff` | Renderer → Main | Git diff |
| `git:commit` | Renderer → Main | Git commit |
| `git:push` | Renderer → Main | Git push |
| `git:stage` | Renderer → Main | Git stage（支持文件级和 hunk 级） |
| `git:unstage` | Renderer → Main | Git unstage |
| `git:revert` | Renderer → Main | Git revert（支持文件级和 hunk 级） |
| `git:undo` | Renderer → Main | Undo 上一轮 Agent 操作 |
| `git:worktree-list` | Renderer → Main | 列出 worktree |
| `git:worktree-create` | Renderer → Main | 创建 worktree |
| `git:worktree-remove` | Renderer → Main | 删除 worktree |

---

## 五、界面设计

### 5.1 导航结构

```
侧边栏导航（图标 + 文字，可收缩为纯图标模式）：
├── Chat         # 对话界面（默认页面，三面板布局）
├── Agents       # 智能体管理
├── Skills       # 技能商店
├── Tasks        # 任务/Bug 管理看板
├── Schedule     # 定时任务
├── Channels     # 渠道配置（飞书/邮箱）
└── Settings     # 设置（含 Providers 配置）
```

### 5.2 路由

```
/setup/*              — 初始设置向导（首次启动）
/                     — Chat（默认路由，三面板布局）
/agents               — 智能体管理
/skills               — Skills 商店
/tasks                — 任务/Bug 管理
/schedule             — 定时任务
/channels             — 渠道配置
/settings             — 通用设置
/settings/providers   — Provider 配置
/settings/security    — 安全设置
/settings/about       — 关于
```

---

## 六、开发计划

### Phase 1: 基础架构 + Provider 系统 (2-3 周)

- P1.1 Electron 项目初始化（三面板布局骨架，参考 Codex 桌面版）
- P1.2 核心引擎搭建（容器运行器、挂载安全、IPC 授权）
- P1.3 多模型 Provider 系统（三类接入：Local CLI / API Key / Coding Plan）
- P1.4 基础 UI 框架（React 19 + Zustand 5 + shadcn/ui + TailwindCSS 4）
- P1.5 IPC 通信桥接（白名单模式）
- P1.6 SQLite 数据库初始化
- P1.7 初始设置向导（Provider 配置 + API Key + 工作目录 + 容器运行时检测）

### Phase 2: Chat + 编码智能体 (3-4 周)

- P2.1 Chat 三面板布局（左侧栏 + 中央对话 + 右侧 Review 面板）
- P2.2 流式输出、Markdown 渲染、代码高亮（CodeMirror 6）
- P2.3 多会话管理 + 会话级模型切换
- P2.4 编码智能体实现（CLI 优先 + API 降级双模式）
- P2.5 CLI Agent Runner（Claude Code / Codex / OpenCode / Gemini CLI 适配）
- P2.6 容器隔离集成
- P2.7 右侧 Review 面板（Git Diff、三级粒度 Stage/Revert）
- P2.8 Git 操作（commit / push / branch / create PR）
- P2.9 Undo/Redo 机制（回滚上一轮 Agent 操作）

### Phase 3: 需求 + 设计智能体 (2-3 周)

- P3.1 需求智能体实现（6 步工作流编排、文档生成）
- P3.2 设计智能体实现（UI 原型生成、React 组件产出）
- P3.3 设计预览功能（iframe 沙箱渲染）
- P3.4 智能体管理页面

### Phase 4: 渠道 + 技能 + 定时任务 (2-3 周)

- P4.1 飞书渠道集成（从 OpenClaw 提取、适配）
- P4.2 Skills 技能商店（ClawHub 同步、安装管理）
- P4.3 定时任务管理（调度器、管理界面）

### Phase 5: 任务管理 + 测试智能体 (2 周)

- P5.1 测试智能体实现
- P5.2 任务/Bug 管理看板
- P5.3 任务与 Chat 集成（自动创建会话、Git 分支）
- P5.4 Worktree 管理

### Phase 6: 优化与发布 (1-2 周)

- P6.1 安全审计
- P6.2 性能优化
- P6.3 用户测试
- P6.4 Bug 修复
- P6.5 应用打包与分发

---

## 七、核心参考项目

### 7.1 直接复用的内部项目

| 项目 | 复用内容 |
|------|----------|
| **NanoClaw** | 容器运行器、挂载安全模块、IPC 授权、任务调度器、消息队列 |
| **OpenClaw** | 飞书渠道扩展（`/extensions/feishu/`）、Provider 系统设计模式、Coding Plan 端点配置 |

### 7.2 UI 架构参考

| 项目 | 参考内容 |
|------|----------|
| **Codex 桌面版** | 三面板布局（左侧栏 + 中央对话 + 右侧 Review）、Review Pane 三级粒度操作、Worktree 管理、backtrack 回滚 |

### 7.3 核心参考的外部项目

| 项目 | Stars | 参考内容 | 应用模块 |
|------|-------|----------|----------|
| **Cherry Studio** | 40,354 | Electron 多模型桌面应用 UI | Provider 配置 UI、模型切换 UX |
| **opencode** | 112,567 | 开源编码 Agent，多模型支持 | 编码智能体、模型切换设计、`provider/model-id` 格式 |
| **cc-switch** | 21,352 | 多 AI CLI 统一管理桌面应用 | CLI 后端统一管理 |
| **openv0** | 3,935 | AI 生成 UI 组件 | 设计智能体核心参考 |
| **CodeMachine-CLI** | 2,313 | 工作流定义语法、状态机 | 多智能体编排参考 |
| **humanlayer** | 9,563 | 审批 UI 组件设计 | 安全审批界面参考 |
| **E2B** | 11,062 | 沙箱化 Agent 执行环境 | 容器沙箱 API 参考 |

---

## 八、风险与依赖

### 8.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 容器运行时兼容性 | macOS/Linux 差异 | Docker 为默认，macOS 检测到 Apple Container 自动切换 |
| 飞书模块提取 | OpenClaw 飞书扩展有插件 SDK 依赖 | 逐步解耦，保留必要接口 |
| Claude Agent SDK 变更 | API 不兼容 | 锁定版本，封装适配层 |
| Electron 包体大 | 用户下载体验 | 按平台分包，增量更新 |
| Coding Plan 端点变更 | 厂商可能调整 URL | 配置化端点，用户可手动覆盖 |

### 8.2 外部依赖

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | >= 22 | 运行时 |
| Docker | latest | 默认容器运行时 |
| Git | >= 2.30 | 版本控制 + worktree |
| Claude Agent SDK | latest | AI 智能体（API 降级模式） |
| @larksuiteoapi/node-sdk | ^1.59.0 | 飞书 SDK |

---

> **文档状态**: v3.1 待用户审核
> **架构方案**: 混合架构（NanoClaw 模式 + OpenClaw 飞书提取 + 三类 Provider 系统）
> **v3.1 变更摘要**:
> 1. **编码智能体重构**: 定义统一 CodingAgentEvent 事件流（CLI/API 共用）、CLI JSONL 解析适配表、审批三模式（suggest/auto-edit/full-auto）、Git 快照 Undo 机制、工具调用实时展示、Review 面板联动、MessageStream 多轮续接、密钥零落地安全
> 2. **设计智能体重构**: 6 步生成管线（结构设计→上下文→生成→AST 验证→写入→视觉自检）、Vite Dev Server 实时预览、组件点击选中迭代、设计令牌系统、Babel AST 验证 + AI 修复循环、明确产出格式和文件约束
> 3. 参考项目: NanoClaw（MessageStream、容器 Agent、IPC 协议）、OpenClaw（工具展示、审批协议、Canvas 视觉反馈）、Codex（三模式审批、backtrack Undo）、openv0（Multipass 管线、AST 验证）、OpenPencil（设计令牌）
> **下一步**: 用户审核通过后，进入设计阶段
