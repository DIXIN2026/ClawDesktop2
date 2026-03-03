# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

| Task | Command |
|------|---------|
| Install deps | `pnpm install` |
| Dev server (Vite + Electron) | `pnpm dev` |
| Lint (ESLint, auto-fix) | `pnpm run lint` |
| Type check | `pnpm run typecheck` |
| Unit tests | `pnpm test` |
| Build | `pnpm run build` |
| Package for macOS | `pnpm run package:mac` |
| Package for Windows | `pnpm run package:win` |
| Package for Linux | `pnpm run package:linux` |

## Architecture Overview

```
Renderer (React 19) --IPC--> Main Process (Electron 40) --WebSocket/SQLite--> AI Agents
```

**Core Stack**: Electron 40 + React 19 + Vite 7 + Tailwind CSS 4 + TypeScript (strict)

### Directory Structure

- **`electron/main/`** — App lifecycle, window management, system tray, menu
- **`electron/preload/`** — Context bridge with whitelisted IPC channels (security boundary)
- **`electron/engine/`** — Agent executor, container runtime, task scheduler, git operations
- **`electron/providers/`** — LLM provider integrations (Anthropic, OpenAI-compatible, Ollama)
- **`electron/channels/`** — Messaging channel adapters (Feishu, QQ) with unified ChannelManager
- **`electron/agents/`** — Specialized agents: RequirementsAgent, DesignAgent, TestingAgent
- **`electron/memory/`** — Dual-layer memory: chunk storage, embeddings, compaction, FTS5 search
- **`electron/security/`** — Approval system for sensitive operations (shell commands, file writes)
- **`electron/utils/db.ts`** — SQLite database layer (better-sqlite3, WAL mode)

- **`src/`** — React renderer
  - `src/pages/` — Route pages (React Router v7 with HashRouter)
  - `src/components/` — UI components (Radix UI + Tailwind + lucide-react)
  - `src/stores/` — Zustand stores (chat, providers, agents, board, memory, git, settings)
  - `src/services/` — Service layer for IPC communication

- **`skills-engine/`** — Skill execution runtime (apply, customize, validate skills)

### Key Architectural Patterns

**Agent Executor** (`electron/engine/agent-executor.ts`):
- Dual-mode dispatch: CLI mode (spawns claude-code/codex/gemini-cli) vs API mode (direct LLM calls)
- Supports 4 agent types: `coding`, `requirements`, `design`, `testing`
- Streaming events via `onEvent` callback
- Timeout handling: overall timeout (10min) + no-output watchdog (3min)

**Channel Manager** (`electron/channels/manager.ts`):
- Unified abstraction for messaging channels (Feishu, QQ, etc.)
- Lifecycle: `register()` → `start()` → `send()` → `stop()`
- Message dispatch to agent router via `onMessage` handlers

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

## Agent Types

1. **coding** — CLI or API mode, executes code generation via claude-code/codex/gemini-cli
2. **requirements** — API mode only, structured requirements gathering with clarifications
3. **design** — API mode only, generates UI code with preview server integration
4. **testing** — API mode only, test generation and execution

## IPC Channels Reference

Key invoke channels (see `electron/preload/index.ts` for full list):
- `chat:send`, `chat:abort` — Send message to agent, abort session
- `sessions:list`, `sessions:create`, `sessions:delete` — Chat session CRUD
- `providers:list`, `providers:save`, `providers:setApiKey` — LLM provider management
- `channels:start`, `channels:stop` — Messaging channel lifecycle
- `board:issues:*` — Kanban board operations
- `memory:search`, `memory:stats` — Memory system queries
- `git:*` — Git operations (status, diff, commit, snapshot, undo/redo)

Listen channels:
- `chat:stream` — Streaming text deltas from agent
- `chat:tool-event` — Tool execution events
- `approval:request` — Approval dialog trigger
- `channels:status` — Channel connection status changes

## Development Notes

- Vite dev server runs on port 5174
- Main process entry: `electron/main/index.ts`
- Preload entry: `electron/preload/index.ts`
- Renderer entry: `src/main.tsx` → `src/App.tsx`
- Database file: `~/Library/Application Support/ClawDesktop2/clawdesktop2.db` (macOS)