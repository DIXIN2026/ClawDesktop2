# ClawDesktop2 × Pencil 集成方案（修正版 / 可落地版）

## 1. 文档定位
- 目标：在当前 ClawDesktop2 项目中，以最小风险接入 Pencil，增强设计交付能力。
- 原则：基于当前仓库与 `../pencil` 的真实能力设计方案，不预设不存在的 headless SDK、Bridge 协议或自动编辑接口。
- 输出：给出可直接进入开发的 MVP 方案、后续扩展路径、任务拆解、验收标准与风险边界。

## 2. 结论摘要
- **适合接入，但不适合按旧方案直接接入。**
- 当前最合适的定位是：**把 Pencil 作为外部原型工具和交接工具接入**，而不是立即把它当作可被 agent 完整编排的执行引擎。
- 第一阶段应优先做：
  - Pencil 可检测
  - 设计任务自动生成 Pencil 交接包
  - 从 Chat 一键在 Pencil 中打开交接包或参考图
  - 在 Chat 中查看交接状态与产物目录
- 第一阶段不应做：
  - `DesignOps -> pencil.applyOps` 自动编辑链路
  - 完整生命周期托管 `start/stop/open/apply/export/close`
  - 把 Pencil 执行事件完全映射为 agent tool stream
  - 自动审核闭环依赖 Pencil 产物作为主事实来源

## 3. 为什么需要修正

### 3.1 当前 ClawDesktop2 的设计链路并非原型执行链路
- 现有 design agent 的主流程是：页面结构生成、组件上下文、React 代码生成、校验、本地预览、截图自检。
- 当前产物核心是 React 代码和本地预览 URL，而不是结构化原型文档。
- 因此把 Pencil 直接插入为“设计执行层”，会改变当前设计 agent 的职责边界，成本高于旧方案描述。

### 3.2 `../pencil` 当前更像 GUI 应用，不是现成 Bridge 服务
- `../pencil` 是独立 Electron 应用，当前代码中没有稳定的外部 Bridge 协议定义。
- 它支持通过启动参数打开 `.ep` / `.epgz` 文档，或打开图片并转为新文档。
- 但它的打开、保存、导出流程仍大量依赖 GUI 交互与内部视图逻辑，不适合作为现成 headless sidecar 直接编排。

### 3.3 安全边界不能按旧文档放宽
- Pencil 自身 Electron 配置较宽松，不应嵌入主应用或与主进程共享信任域。
- 因此必须坚持“外部进程、弱集成、路径白名单”的策略。

## 4. 修正后的产品定位

### 4.1 第一阶段定位
- **Pencil 是可选外部原型工具。**
- ClawDesktop2 继续负责：
  - AI 推理
  - React 代码生成
  - 本地网页预览
  - 设计说明与交接包生成
- Pencil 负责：
  - 打开参考素材
  - 承载人工微调或原型编辑
  - 产出人工确认后的原型文件

### 4.2 第二阶段定位
- 只有在我们维护了受控的 Pencil fork，且为其补齐最小脚本化入口后，才进入“弱自动化桥接”。
- 第二阶段也只建议覆盖：
  - 打开文档
  - 打开参考图
  - 导出当前文档
- **不建议在第二阶段直接做节点级自动编辑。**

## 5. 能力分级模型

为避免方案与现实能力脱节，集成按能力分级实现。

### Level 0：未安装 / 不可用
- Claw 只能生成 Pencil 交接包。
- 用户可手动打开交接目录。
- 不提供“在 Pencil 中打开”按钮，或按钮置灰。

### Level 1：原版 Pencil 可启动
- Claw 可检测本机 Pencil 可执行入口或指定 repo 启动脚本。
- Claw 可生成交接包并一键用 Pencil 打开：
  - `.epgz` 模板文档
  - 或参考图 `reference.png`
- 这是推荐的 MVP 目标。

### Level 2：受控 Fork + 最小 Bridge
- 仅当 Pencil fork 内新增稳定本地 Bridge 时启用。
- Claw 可调用最小命令：
  - `status`
  - `openDocument`
  - `openReferenceImage`
  - `exportCurrentDocument`
- 仍不做 `applyOps`。

## 6. MVP 目标与非目标

### 6.1 MVP 目标
1. 设计任务完成后，自动生成 Pencil 交接包。
2. 如果检测到 Pencil，可从 Chat 一键打开交接包中的文档或参考图。
3. 用户可从 Chat 打开交接目录，查看 `.md/.json/.png/.epgz` 等产物。
4. 失败时不影响现有 design agent 的 React 代码产出与网页预览。

### 6.2 MVP 非目标
- 不把 Pencil 作为 design agent 的主执行器。
- 不要求 Pencil 自动生成页面节点。
- 不要求 Pencil 导出过程实时流式回传。
- 不要求审核状态直接写回 Pencil 文档。
- 不新增 Pencil 专属模型配置或 API Key。

## 7. 修正后的架构

### 7.1 逻辑链路
1. 用户在 Chat 发起设计任务。
2. design agent 继续生成 React 代码、预览 URL、截图与说明。
3. 主进程根据本轮结果生成 Pencil 交接包。
4. 若检测到 Pencil，用户可点击“在 Pencil 中打开”。
5. Claw 调起外部 Pencil，打开交接包中的 `.epgz` 模板或 `reference.png`。
6. 用户在 Pencil 内完成人工编辑。
7. Chat 侧仅记录交接包、打开状态、目录位置与后续回收的产物路径。

### 7.2 模块分层
- **AI 决策层**：沿用现有 provider/router + design agent。
- **产物整理层**：新增 pencil handoff builder，负责生成交接包。
- **Pencil 集成层**：新增 pencil service，负责检测与启动外部 Pencil。
- **交互展示层**：Chat 展示交接卡片、目录入口、打开状态。

### 7.3 关键设计原则
- 现有 design agent 不降级。
- Pencil 集成失败不得影响 React 产物与预览链路。
- 所有路径写入限制在 `workDirectory` 内。
- 不在 Renderer 直接拉起外部进程。
- 不预设原版 Pencil 支持 headless 或稳定远程控制。

## 8. 交接包设计（MVP）

### 8.1 输出目录
- 推荐目录：`artifacts/pencil/<sessionId>/`

### 8.2 最小产物集合
- `handoff.md`
  - 设计任务摘要
  - 页面清单
  - 关键交互说明
  - 设计约束
- `metadata.json`
  - `sessionId`
  - `createdAt`
  - `sourcePreviewUrl`
  - `artifactPaths`
  - `pencilCapabilityLevel`
- `reference.png`
  - 若当前轮次有预览截图，则写入该文件
- `generated-files.json`
  - 当前轮生成的 React 文件清单
- `template.epgz`（可选）
  - 若项目内有稳定模板，则复制到交接目录

### 8.3 打开策略
- 若存在 `template.epgz`，优先用 Pencil 打开该文档。
- 若不存在模板但存在 `reference.png`，则用 Pencil 打开图片作为新文档参考源。
- 若两者都不存在，则仅打开交接目录，不再强行拉起 Pencil。

## 9. 主进程协议（MVP）

MVP 不再定义旧方案中的 `pencil.applyOps` 等虚构命令，而是定义真实可实现的 IPC。

### 9.1 IPC 命令集合
- `pencil:status`
- `pencil:open-handoff`
- `pencil:open-path`
- `pencil:reveal-artifacts`

### 9.2 `pencil:status` 返回结构
```json
{
  "available": true,
  "level": 1,
  "launchMode": "repo-script",
  "resolvedCommand": "../pencil/node_modules/.bin/electron",
  "reason": null
}
```

### 9.3 `pencil:open-handoff` 请求结构
```json
{
  "sessionId": "chat-session-id",
  "workDirectory": "/abs/workdir",
  "preferred": "template-or-image"
}
```

### 9.4 `pencil:open-path` 请求结构
```json
{
  "path": "/abs/workdir/artifacts/pencil/session-1/reference.png"
}
```

### 9.5 `pencil:reveal-artifacts` 请求结构
```json
{
  "sessionId": "chat-session-id",
  "workDirectory": "/abs/workdir"
}
```

## 10. 目录与文件改动清单

## 10.1 MVP 新增文件
- `electron/integrations/pencil/types.ts`
- `electron/integrations/pencil/service.ts`
- `electron/integrations/pencil/handoff.ts`
- `electron/integrations/pencil/index.ts`
- `electron/integrations/pencil/__tests__/service.test.ts`
- `electron/integrations/pencil/__tests__/handoff.test.ts`

## 10.2 MVP 修改文件
- `electron/main/ipc-handlers.ts`
- `electron/preload/index.ts`
- `src/services/ipc.ts`
- `electron/agents/design-agent.ts`
- `electron/engine/agent-executor.ts`
- `src/stores/chat.ts`
- `src/pages/Chat/index.tsx`

## 10.3 Phase 2 才考虑新增的文件
- `electron/integrations/pencil/bridge-client.ts`
- `electron/integrations/pencil/protocol.ts`

说明：这两个文件只有在 Pencil fork 具备本地 Bridge 入口后才成立，MVP 不应提前引入。

## 11. 任务拆解（可直接建 Issue）

## 11.1 Epic-A Pencil 检测与启动

### ISSUE-001 定义 Pencil 能力类型与状态模型
- 目标：定义 `Level 0/1/2` 能力模型与启动结果结构。
- 改动文件：
  - `electron/integrations/pencil/types.ts`
- 实现要点：
  - 定义 `PencilCapabilityLevel`。
  - 定义 `PencilStatus`、`PencilLaunchResult`、`PencilHandoffInfo`。
- 验收标准：
  - 类型可被 service、IPC、前端状态复用。
- 预计工时：0.5 人天
- 依赖：无

### ISSUE-002 实现 Pencil 检测与启动服务
- 目标：检测 Pencil 可用性并安全打开目标文件。
- 改动文件：
  - `electron/integrations/pencil/service.ts`
  - `electron/integrations/pencil/__tests__/service.test.ts`
- 实现要点：
  - 检测 repo 脚本、已安装可执行程序或配置路径。
  - 支持打开 `.epgz` 或图片文件。
  - 所有目标路径必须位于 `workDirectory` 内。
  - 启动失败返回结构化错误，不抛散乱异常。
- 验收标准：
  - 可区分 `unavailable`、`launch-failed`、`unsafe-path`。
  - 合法路径可被成功传递给 Pencil。
- 预计工时：1 人天
- 依赖：ISSUE-001

## 11.2 Epic-B 交接包生成

### ISSUE-003 实现 Pencil 交接包构建器
- 目标：把 design agent 当前轮结果整理为稳定交接目录。
- 改动文件：
  - `electron/integrations/pencil/handoff.ts`
  - `electron/integrations/pencil/__tests__/handoff.test.ts`
- 实现要点：
  - 生成 `handoff.md`、`metadata.json`、`generated-files.json`。
  - 若有预览截图，则保存 `reference.png`。
  - 若存在模板资源，则复制 `template.epgz`。
- 验收标准：
  - 无截图时仍可成功生成交接包。
  - 多次执行同一 session 时行为幂等。
- 预计工时：1 人天
- 依赖：ISSUE-001

### ISSUE-004 在 design 链路中接入 handoff 生成
- 目标：设计任务完成后自动产出 Pencil 交接包。
- 改动文件：
  - `electron/agents/design-agent.ts`
  - `electron/engine/agent-executor.ts`
- 实现要点：
  - 保持现有 React 代码产出与预览不变。
  - 设计任务结束后调用 handoff builder。
  - 以 `tool_output` 或 `file_changed` 形式反馈产物位置。
- 验收标准：
  - 即使 Pencil 不可用，也能生成交接包。
  - 不破坏现有 `preview_ready` 事件。
- 预计工时：1 人天
- 依赖：ISSUE-003

## 11.3 Epic-C IPC 与前端入口

### ISSUE-005 暴露 Pencil IPC 能力
- 目标：对外提供状态检测、打开交接包、打开路径、展示目录能力。
- 改动文件：
  - `electron/main/ipc-handlers.ts`
  - `electron/preload/index.ts`
  - `src/services/ipc.ts`
- 实现要点：
  - 增加 `pencil:status`
  - 增加 `pencil:open-handoff`
  - 增加 `pencil:open-path`
  - 增加 `pencil:reveal-artifacts`
- 验收标准：
  - Renderer 能拿到结构化结果。
  - 非法路径被拒绝并返回可读错误。
- 预计工时：1 人天
- 依赖：ISSUE-002、ISSUE-003

### ISSUE-006 Chat 侧增加 Pencil 交接卡片
- 目标：在 Chat 中展示 Pencil 交接产物与操作入口。
- 改动文件：
  - `src/stores/chat.ts`
  - `src/pages/Chat/index.tsx`
- 实现要点：
  - 展示交接目录、参考图、模板文档。
  - 提供“在 Pencil 中打开”“打开目录”按钮。
  - Pencil 不可用时展示降级说明。
- 验收标准：
  - 用户可从当前会话直接进入交接流程。
  - 不影响现有网页 Design Preview 的显示。
- 预计工时：1 人天
- 依赖：ISSUE-004、ISSUE-005

## 11.4 Epic-D 安全与稳定性

### ISSUE-007 路径白名单与错误映射
- 目标：保证所有打开与写入操作均在工作目录内。
- 改动文件：
  - `electron/integrations/pencil/service.ts`
  - `electron/main/ipc-handlers.ts`
- 实现要点：
  - 统一 `resolve + relative` 校验。
  - 拒绝路径穿越、绝对外链、空路径。
  - 错误码收敛为有限集合。
- 验收标准：
  - 恶意路径样例可被拦截。
  - 打开失败原因可被前端稳定展示。
- 预计工时：0.5 人天
- 依赖：ISSUE-002

### ISSUE-008 测试与回归门槛
- 目标：为 MVP 建立可持续回归的质量网。
- 改动文件：
  - `electron/integrations/pencil/__tests__/*`
  - 如有需要，增加 `src/stores/__tests__/chat.pencil.test.ts`
- 实现要点：
  - 覆盖检测成功、不可用、非法路径、交接包生成、前端降级展示。
- 验收标准：
  - `pnpm run lint`
  - `pnpm run typecheck`
  - `pnpm test`
  - 全部通过
- 预计工时：1 人天
- 依赖：ISSUE-001~007

## 12. 依赖关系图（MVP）
- ISSUE-001 → ISSUE-002
- ISSUE-001 → ISSUE-003 → ISSUE-004
- ISSUE-002 + ISSUE-003 → ISSUE-005 → ISSUE-006
- ISSUE-002 → ISSUE-007
- ISSUE-001~007 → ISSUE-008

## 13. 验收标准（MVP）
- 设计任务结束后可在工作目录生成稳定的 Pencil 交接包。
- Pencil 不可用时，用户仍可查看并打开交接目录。
- Pencil 可用时，用户可从 Chat 一键打开交接包中的 `.epgz` 或 `reference.png`。
- Pencil 集成失败不会影响 React 代码产出、网页预览、对话主流程。
- 所有写入与打开路径都受 `workDirectory` 白名单限制。
- lint/typecheck/test 全部通过。

## 14. 第二阶段（可选）

只有在我们维护 Pencil fork 并新增稳定本地入口后，才进入第二阶段。

### 14.1 第二阶段目标
- 在不改变主产品边界的前提下，实现最小自动化桥接。

### 14.2 第二阶段允许做的能力
- `status`
- `openDocument`
- `openReferenceImage`
- `exportCurrentDocument`

### 14.3 第二阶段仍不建议做的能力
- `applyOps`
- 页面节点自动创建与布局
- 让 LLM 直接控制 Pencil 内部对象树
- 用 Pencil 产物替代 React 预览作为主交付物

### 14.4 第二阶段新增文件
- `electron/integrations/pencil/bridge-client.ts`
- `electron/integrations/pencil/protocol.ts`

### 14.5 第二阶段前置条件
- Pencil fork 提供稳定入口。
- Bridge 协议有版本号和错误码定义。
- 导出链路可自动化且具备超时恢复。

## 15. 风险与回滚

### 风险 1：Pencil 在不同机器上的启动入口不一致
- 预案：能力检测支持 repo 脚本、配置路径、系统可执行程序三种来源。
- 回滚：禁用“在 Pencil 中打开”，保留交接包生成。

### 风险 2：预览截图不可用
- 预案：交接包允许没有 `reference.png`。
- 回滚：只保留 `handoff.md + metadata.json + generated-files.json`。

### 风险 3：Pencil 启动失败或用户环境缺依赖
- 预案：所有失败都降级为“打开目录”。
- 回滚：隐藏 Pencil 打开入口，不影响设计任务主流程。

### 风险 4：安全边界扩大
- 预案：不嵌入 Pencil，不信任外部路径，不把 Renderer 变成启动入口。
- 回滚：关闭全部 Pencil IPC，仅保留纯文件交接模式。

## 16. 排期建议

### Week 1
- A 线：ISSUE-001/002/007
- B 线：ISSUE-003/004

### Week 2
- A 线：ISSUE-005
- B 线：ISSUE-006/008

## 17. Day-1 开工清单
- 建立 `electron/integrations/pencil/` 目录与基础类型。
- 先完成 `pencil:status` 与本地检测逻辑。
- 落地交接包目录结构与 `handoff.md` 生成。
- 在 design 任务完成后输出交接包路径。
- 在 Chat 中先放出“打开目录”入口，再补“在 Pencil 中打开”。

## 18. 完成定义（MVP DoD）
- ClawDesktop2 能稳定生成 Pencil 交接包。
- 用户能在 Chat 中定位交接包并进入 Pencil 编辑流程。
- Pencil 集成是可选能力，而不是主流程硬依赖。
- 任何 Pencil 相关失败都不会破坏现有 design agent 主流程。
- 代码与测试门槛全部通过。

## 19. 明确不做列表
- 不做 `pencil.applyOps`。
- 不做 `pencil.saveDoc/exportHtml/exportPng/closeDoc` 这类基于虚构 Bridge 的命令。
- 不做 Pencil 全生命周期托管状态机。
- 不做把 Pencil 事件强塞进现有 `chat:stream` 作为核心交互模型。
- 不做“Pencil 产物 + React 代码产物”双主线并行编排。

以上限制不是长期结论，而是为了保证当前阶段方案真实、可落地、可维护。
