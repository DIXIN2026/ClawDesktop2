# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

| Task | Command |
|------|---------|
| Install deps | `pnpm install` |
| Dev server (Vite + Electron) | `pnpm dev` |
| Lint (ESLint, auto-fix) | `pnpm run lint` |
| Type check | `pnpm run typecheck` |
| Unit tests (all) | `pnpm test` |
| Single test file | `pnpm test path/to/file.test.ts` |
| Build | `pnpm run build` |
| Package for macOS | `pnpm run package:mac` |
| Package for Windows | `pnpm run package:win` |
| Package for Linux | `pnpm run package:linux` |

**Test notes**: Tests use Vitest with Node environment (forks pool, singleFork mode). Some tests requiring Electron renderer (e.g., `memory-store.test.ts`) are excluded. Test files are collocated in `__tests__/` directories.

## Architecture Overview

```
Renderer (React 19) --IPC--> Main Process (Electron 40) --WebSocket/SQLite--> AI Agents
```

**Core Stack**: Electron 40 + React 19 + Vite 7 + Tailwind CSS 4 + TypeScript (strict)

### Directory Structure

- **`electron/main/`** — App lifecycle, window management, system tray, menu
- **`electron/preload/`** — Context bridge with whitelisted IPC channels (security boundary)
- **`electron/engine/`** — Agent executor, container runtime, task scheduler, git operations, orchestrator
  - `process-supervisor/` — Process lifecycle management
- **`electron/providers/`** — LLM provider integrations
  - `adapters/` — Anthropic, OpenAI-compatible, Ollama API clients
  - `cli-agents/` — CLI tool wrappers (claude-code, codex, opencode, gemini-cli)
- **`electron/channels/`** — Messaging channel adapters with unified ChannelManager
  - `feishu/` — Full Feishu/Lark integration (bot, wiki, drive, mentions, streaming cards, permissions)
  - `feishu-desktop/` — Desktop-specific Feishu integration
  - `qq/` — QQ bot integration (gateway, media, rich-text, thread binding)
  - `email/` — Email channel for task notifications
- **`electron/agents/`** — Specialized agents: RequirementsAgent, DesignAgent, TestingAgent
- **`electron/memory/`** — Dual-layer memory: chunk storage, embeddings, compaction, FTS5 search
- **`electron/security/`** — Approval system, sandbox, rate limiting, credential management
- **`electron/skills/`** — Skill loader, ClawHub integration, built-in skills
- **`electron/utils/db.ts`** — SQLite database layer (better-sqlite3, WAL mode)

- **`src/`** — React renderer
  - `src/pages/` — Route pages (React Router v7 with HashRouter)
  - `src/components/` — UI components (Radix UI + Tailwind + lucide-react)
  - `src/stores/` — Zustand stores (chat, providers, agents, board, memory, git, settings)
  - `src/services/` — Service layer for IPC communication

- **`skills-engine/`** — Skill execution runtime
  - `apply.ts`, `file-ops.ts`, `fs-utils.ts` — Apply skill files to target directory
  - `customize.ts` — Skill customization/parameterization
  - `structured.ts` — Structured skill output parsing
  - `lock.ts` — Skill lock file management
  - `state.ts`, `backup.ts` — Skill state persistence and rollback
  - `manifest.ts`, `merge.ts`, `migrate.ts` — Skill manifest and migration
  - `init.ts`, `index.ts` — Entry points and initialization

### Key Architectural Patterns

**Agent Executor** (`electron/engine/agent-executor.ts`):
- Dual-mode dispatch: CLI mode (spawns claude-code/codex/opencode/gemini-cli) vs API mode (direct LLM calls)
- Supports 4 agent types: `coding`, `requirements`, `design`, `testing`
- Streaming events via `onEvent` callback
- Timeout handling: overall timeout (10min) + no-output watchdog (3min)

**Orchestrator** (`electron/engine/orchestrator.ts`):
- Multi-agent task orchestration
- Progress events via `orchestrator:progress` channel
- Cancellation support via `orchestrator:cancel`

**Channel Manager** (`electron/channels/manager.ts`):
- Unified abstraction for messaging channels (Feishu, QQ, Email, etc.)
- Lifecycle: `register()` → `start()` → `send()` → `stop()`
- Message dispatch to agent router via `onMessage` handlers

**Message Bus** (`electron/engine/message-bus.ts`):
- Agent-to-agent communication backbone
- Creates unique agent IDs and manages message routing
- Used by orchestrator and channel agent router

**Memory System** (`electron/memory/`):
- Dual-layer: raw chunks + summarized compaction
- FTS5 full-text search + embedding-based semantic search
- Auto-compaction when context exceeds token threshold

**IPC Security** (`electron/preload/index.ts`):
- Whitelisted channels for `invoke` and `on` operations
- Context isolation enabled, sandbox mode
- Never expose full ipcRenderer; use validated channel lists

**Database** (`electron/utils/db.ts`):
- All functions are synchronous (better-sqlite3 is sync)
- Tables: agents, chat_sessions, messages, tasks, scheduled_tasks, providers, models, board_states, board_issues, memory_chunks, etc.
- WAL mode + foreign keys enabled

## Key Conventions

- UI components use Radix UI primitives + Tailwind + lucide-react icons
- State management via Zustand stores (not React Context)
- ESLint (not Oxlint) for linting; Vite 7 + vite-plugin-electron for build
- Validation: `zod` v4; animations: `framer-motion`; notifications: `sonner`
- Path aliases: `@/*` → `src/*`, `@electron/*` → `electron/*`
- Feishu SDK: `@larksuiteoapi/node-sdk` for Lark/Feishu channel integration
- ESLint rule `@typescript-eslint/no-explicit-any: 'error'` — avoid `any`, use proper types

## Agent Types

1. **coding** — CLI or API mode, executes code generation
   - CLI backends: `claude-code`, `codex`, `opencode`, `gemini-cli`
   - API protocols: `anthropic-messages`, `openai-compatible`, `ollama`
2. **requirements** — API mode only, structured requirements gathering with clarifications
3. **design** — API mode only, generates UI code with preview server integration
4. **testing** — API mode only, test generation and execution

## IPC Channels Reference

Key invoke channels (see `electron/preload/index.ts` for full list):
- `chat:send`, `chat:abort`, `chat:clarification-response`, `chat:history`, `chat:switch-model` — Chat operations
- `sessions:list`, `sessions:create`, `sessions:delete`, `sessions:resume` — Session CRUD
- `providers:*`, `providers:cli-status` — LLM provider management + CLI tool status
- `agents:list`, `agents:get`, `agents:update`, `agents:config`, `agents:set-model` — Agent configuration
- `channels:start`, `channels:stop`, `channels:config`, `channels:test` — Channel lifecycle
- `board:issues:*` — Kanban board CRUD and workflow
- `memory:search`, `memory:stats`, `memory:reindex`, `memory:delete`, `memory:preferences:*` — Memory system
- `git:*`, `git:worktree-*`, `git:snapshot`, `git:undo`, `git:redo` — Git operations with undo/redo
- `orchestrator:execute`, `orchestrator:cancel`, `orchestrator:status` — Multi-agent orchestration
- `approval:response`, `approval:mode:get`, `approval:mode:set` — Approval flow control
- `skills:search`, `skills:install`, `skills:install-generated`, `skills:uninstall`, `skills:list` — Skill management
- `tasks:*`, `schedule:*` — Task and scheduled task management

Listen channels:
- `chat:stream` — Streaming text deltas from agent
- `chat:tool-event` — Tool execution events
- `approval:request` — Approval dialog trigger
- `channels:status` — Channel connection status changes
- `orchestrator:progress` — Multi-agent task progress
- `engine:event`, `engine:error` — Engine lifecycle events
- `agents:stats` — Agent statistics updates
- `navigate` — Navigation requests from main process
- `theme:changed` — Theme change notifications

## Development Notes

- Vite dev server runs on port 5174
- Main process entry: `electron/main/index.ts`
- Preload entry: `electron/preload/index.ts`
- Renderer entry: `src/main.tsx` → `src/App.tsx`
- Database file: `~/Library/Application Support/ClawDesktop2/clawdesktop2.db` (macOS)
- TypeScript strict mode enabled with `noUnusedLocals`, `noUnusedParameters`