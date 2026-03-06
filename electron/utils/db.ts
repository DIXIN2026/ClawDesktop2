/**
 * Database Module (better-sqlite3)
 * SQLite-based storage for ClawDesktop2.
 * All public functions are synchronous (better-sqlite3 is a sync driver).
 */
import Database from 'better-sqlite3';
import { app } from 'electron';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';

/** Result of an INSERT / UPDATE / DELETE operation. */
export type RunResult = Database.RunResult;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let db: Database.Database | null = null;
const DB_OPEN_RETRY_DELAYS_MS = [0, 120, 300, 700];
const DB_BUSY_TIMEOUT_MS = 5000;

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  const lock = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(lock, 0, 0, ms);
}

function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT,
    type TEXT CHECK(type IN ('coding','requirements','design','testing')),
    system_prompt TEXT,
    skills TEXT,
    container_config TEXT,
    status TEXT DEFAULT 'idle',
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    title TEXT,
    agent_id TEXT,
    task_id TEXT,
    work_directory TEXT,
    current_model TEXT,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES chat_sessions(id),
    role TEXT CHECK(role IN ('user','assistant','system')),
    content TEXT,
    model_used TEXT,
    attachments TEXT,
    tool_calls TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    status TEXT DEFAULT 'new',
    priority TEXT DEFAULT 'medium',
    agent_id TEXT,
    session_id TEXT,
    branch TEXT,
    worktree_path TEXT,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id TEXT PRIMARY KEY,
    name TEXT,
    schedule_type TEXT CHECK(schedule_type IN ('cron','interval','once')),
    schedule_expr TEXT,
    agent_type TEXT,
    prompt TEXT,
    work_directory TEXT,
    enabled INTEGER DEFAULT 1,
    last_run TEXT,
    next_run TEXT,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS task_run_logs (
    id TEXT PRIMARY KEY,
    task_id TEXT REFERENCES scheduled_tasks(id),
    status TEXT,
    result_summary TEXT,
    duration_ms INTEGER,
    started_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT,
    config TEXT,
    status TEXT,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    provider_id TEXT REFERENCES providers(id),
    name TEXT,
    capabilities TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS agent_model_mappings (
    id TEXT PRIMARY KEY,
    agent_type TEXT,
    provider_id TEXT,
    model_id TEXT,
    is_fallback INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS installed_skills (
    id TEXT PRIMARY KEY,
    name TEXT,
    version TEXT,
    source TEXT,
    manifest TEXT,
    installed_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS channel_state (
    id TEXT PRIMARY KEY,
    channel_type TEXT,
    config TEXT,
    status TEXT,
    last_connected TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    agent_type TEXT,
    mode TEXT,
    work_directory TEXT,
    git_snapshot_ref TEXT,
    status TEXT,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS router_state (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS board_states (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('backlog','unstarted','started','completed','cancelled')),
    sort_order REAL,
    allow_new_items INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS board_issues (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    state_id TEXT NOT NULL REFERENCES board_states(id),
    priority TEXT DEFAULT 'medium' CHECK(priority IN ('urgent','high','medium','low','none')),
    assignee TEXT,
    labels TEXT,
    parent_id TEXT REFERENCES board_issues(id),
    estimate_points INTEGER,
    start_date TEXT,
    target_date TEXT,
    issue_type TEXT DEFAULT 'task' CHECK(issue_type IN ('task','bug','story','epic')),
    sort_order REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS board_transitions (
    from_state_id TEXT NOT NULL,
    to_state_id TEXT NOT NULL,
    PRIMARY KEY (from_state_id, to_state_id)
  );

  -- Memory tables (CoPaw-style dual-layer memory)
  CREATE TABLE IF NOT EXISTS memory_chunks (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    source TEXT NOT NULL CHECK(source IN ('conversation','summary','user_note','compaction')),
    content TEXT NOT NULL,
    embedding BLOB,
    token_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memory_summaries (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    summary_type TEXT CHECK(summary_type IN ('compaction','daily','session_end')),
    content TEXT NOT NULL,
    source_message_ids TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memory_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memory_entities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK(entity_type IN ('user','project','preference','topic','artifact')),
    session_id TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memory_relations (
    id TEXT PRIMARY KEY,
    from_entity_id TEXT NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
    to_entity_id TEXT NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,
    confidence REAL DEFAULT 0.5,
    source_chunk_id TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memory_observations (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('preference','fact','constraint')),
    confidence REAL DEFAULT 0.5,
    source_chunk_id TEXT,
    session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run);
  CREATE INDEX IF NOT EXISTS idx_task_run_logs_task_id ON task_run_logs(task_id);
  CREATE INDEX IF NOT EXISTS idx_models_provider_id ON models(provider_id);
  CREATE INDEX IF NOT EXISTS idx_agent_model_mappings_agent_type ON agent_model_mappings(agent_type);
  CREATE INDEX IF NOT EXISTS idx_agent_sessions_session_id ON agent_sessions(session_id);
  CREATE INDEX IF NOT EXISTS idx_board_issues_state_id ON board_issues(state_id);
  CREATE INDEX IF NOT EXISTS idx_board_issues_priority ON board_issues(priority);
  CREATE INDEX IF NOT EXISTS idx_board_issues_issue_type ON board_issues(issue_type);
  CREATE INDEX IF NOT EXISTS idx_board_issues_parent_id ON board_issues(parent_id);
  CREATE INDEX IF NOT EXISTS idx_memory_chunks_session ON memory_chunks(session_id);
  CREATE INDEX IF NOT EXISTS idx_memory_chunks_source ON memory_chunks(source);
  CREATE INDEX IF NOT EXISTS idx_memory_chunks_created ON memory_chunks(created_at);
  CREATE INDEX IF NOT EXISTS idx_memory_entities_type ON memory_entities(entity_type);
  CREATE INDEX IF NOT EXISTS idx_memory_entities_session ON memory_entities(session_id);
  CREATE INDEX IF NOT EXISTS idx_memory_relations_from ON memory_relations(from_entity_id);
  CREATE INDEX IF NOT EXISTS idx_memory_relations_to ON memory_relations(to_entity_id);
  CREATE INDEX IF NOT EXISTS idx_memory_observations_entity ON memory_observations(entity_id);
  CREATE INDEX IF NOT EXISTS idx_memory_observations_category ON memory_observations(category);
  CREATE INDEX IF NOT EXISTS idx_memory_observations_session ON memory_observations(session_id);
  CREATE INDEX IF NOT EXISTS idx_memory_observations_updated ON memory_observations(updated_at);
`;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Initialize the database. Creates tables and enables WAL mode.
 * @param dbPath - Override database file path (for testing). Defaults to
 *                 `app.getPath('userData')/clawdesktop2.db`.
 */
export function initDatabase(dbPath?: string): void {
  if (db) return;

  const primaryPath = dbPath ?? process.env.CLAWDESKTOP2_DB_PATH ?? join(app.getPath('userData'), 'clawdesktop2.db');
  const fallbackPath = join(process.cwd(), '.clawdesktop2-data', 'clawdesktop2.db');
  const candidatePaths = primaryPath === fallbackPath ? [primaryPath] : [primaryPath, fallbackPath];
  let lastError: unknown = null;

  for (const candidatePath of candidatePaths) {
    for (let attempt = 0; attempt < DB_OPEN_RETRY_DELAYS_MS.length; attempt += 1) {
      const retryDelay = DB_OPEN_RETRY_DELAYS_MS[attempt] ?? 0;
      sleepSync(retryDelay);
      let openedDb: Database.Database | null = null;
      try {
        mkdirSync(dirname(candidatePath), { recursive: true });
        openedDb = new Database(candidatePath, { timeout: DB_BUSY_TIMEOUT_MS });
        openedDb.pragma('journal_mode = WAL');
        openedDb.pragma('synchronous = NORMAL');
        openedDb.pragma('foreign_keys = ON');
        openedDb.exec(SCHEMA_SQL);
        db = openedDb;
        runMigrations();
        return;
      } catch (err) {
        lastError = err;
        try {
          openedDb?.close();
        } catch {
          void 0;
        }
        db = null;
      }
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('Failed to initialize database');
}

/** Close the database connection. */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ---------------------------------------------------------------------------
// Migrations (try-catch pattern for backward compat)
// ---------------------------------------------------------------------------

function runMigrations(): void {
  const database = getDb();

  // Create FTS5 virtual table for memory search (idempotent via try-catch)
  try {
    database.exec(
      'CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(content, chunk_id UNINDEXED)',
    );
  } catch {
    // FTS5 table may already exist or FTS5 not available — non-fatal
  }

  // Seed default board states if empty
  const stateCount = database.prepare('SELECT COUNT(*) as cnt FROM board_states').get() as { cnt: number } | undefined;
  if (stateCount && stateCount.cnt === 0) {
    const defaultStates = [
      { id: 'state-backlog', name: 'Backlog', color: '#6b7280', category: 'backlog', sort_order: 0 },
      { id: 'state-todo', name: 'Todo', color: '#3b82f6', category: 'unstarted', sort_order: 1 },
      { id: 'state-in-progress', name: 'In Progress', color: '#f59e0b', category: 'started', sort_order: 2 },
      { id: 'state-review', name: 'In Review', color: '#8b5cf6', category: 'started', sort_order: 3 },
      { id: 'state-done', name: 'Done', color: '#22c55e', category: 'completed', sort_order: 4 },
      { id: 'state-cancelled', name: 'Cancelled', color: '#ef4444', category: 'cancelled', sort_order: 5 },
    ];
    const insertState = database.prepare(
      'INSERT INTO board_states (id, name, color, category, sort_order) VALUES (?, ?, ?, ?, ?)',
    );
    const seedTx = database.transaction(() => {
      for (const s of defaultStates) {
        insertState.run(s.id, s.name, s.color, s.category, s.sort_order);
      }
      // Seed transitions: each state can move to any other (fully connected)
      const insertTx = database.prepare('INSERT INTO board_transitions (from_state_id, to_state_id) VALUES (?, ?)');
      for (const from of defaultStates) {
        for (const to of defaultStates) {
          if (from.id !== to.id) {
            insertTx.run(from.id, to.id);
          }
        }
      }
    });
    seedTx();
  }
}

// ---------------------------------------------------------------------------
// Generic query helpers
// ---------------------------------------------------------------------------

/** Execute a SELECT that returns multiple rows. */
export function query<T>(sql: string, params?: unknown[]): T[] {
  const stmt = getDb().prepare(sql);
  return (params ? stmt.all(...params) : stmt.all()) as T[];
}

/** Execute a SELECT that returns a single row (or undefined). */
export function get<T>(sql: string, params?: unknown[]): T | undefined {
  const stmt = getDb().prepare(sql);
  return (params ? stmt.get(...params) : stmt.get()) as T | undefined;
}

/** Execute an INSERT / UPDATE / DELETE statement. */
export function run(sql: string, params?: unknown[]): RunResult {
  const stmt = getDb().prepare(sql);
  return params ? stmt.run(...params) : stmt.run();
}

/** Run a function inside a transaction. */
export function transaction<T>(fn: () => T): T {
  const trx = getDb().transaction(fn);
  return trx();
}

// ---------------------------------------------------------------------------
// Settings (router_state table)
// ---------------------------------------------------------------------------

export function getSetting(key: string): string | undefined {
  return getRouterState(key);
}

export function setSetting(key: string, value: string): void {
  setRouterState(key, value);
}

export function deleteSetting(key: string): void {
  run('DELETE FROM router_state WHERE key = ?', [key]);
}

// ---------------------------------------------------------------------------
// Router State
// ---------------------------------------------------------------------------

export function getRouterState(key: string): string | undefined {
  const row = get<{ value: string }>('SELECT value FROM router_state WHERE key = ?', [key]);
  return row?.value;
}

export function setRouterState(key: string, value: string): void {
  const now = new Date().toISOString();
  run(
    'INSERT INTO router_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    [key, value, now],
  );
}

// ---------------------------------------------------------------------------
// Chat Sessions
// ---------------------------------------------------------------------------

interface ChatSessionRow {
  id: string;
  title: string;
  agent_id: string | null;
  task_id: string | null;
  work_directory: string | null;
  current_model: string | null;
  created_at: string;
  updated_at: string;
}

export function createChatSession(session: {
  id: string;
  title: string;
  agentId?: string;
  taskId?: string;
  workDirectory?: string;
  currentModel?: string;
}): void {
  const now = new Date().toISOString();
  run(
    'INSERT INTO chat_sessions (id, title, agent_id, task_id, work_directory, current_model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [session.id, session.title, session.agentId ?? null, session.taskId ?? null, session.workDirectory ?? null, session.currentModel ?? null, now, now],
  );
}

export function getChatSession(id: string): ChatSessionRow | undefined {
  return get<ChatSessionRow>('SELECT * FROM chat_sessions WHERE id = ?', [id]);
}

export function listChatSessions(): ChatSessionRow[] {
  return query<ChatSessionRow>('SELECT * FROM chat_sessions ORDER BY updated_at DESC');
}

const CHAT_SESSION_FIELDS = new Set([
  'title', 'agent_id', 'task_id', 'work_directory', 'current_model',
]);

export function updateChatSession(id: string, updates: Record<string, unknown>): void {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    const col = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    if (!CHAT_SESSION_FIELDS.has(col)) {
      throw new Error(`Invalid field for chat_sessions update: ${col}`);
    }
    setClauses.push(`${col} = ?`);
    values.push(value);
  }

  if (setClauses.length === 0) return;

  setClauses.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  run(`UPDATE chat_sessions SET ${setClauses.join(', ')} WHERE id = ?`, values);
}

export function deleteChatSession(id: string): void {
  transaction(() => {
    run('DELETE FROM messages WHERE session_id = ?', [id]);
    run('DELETE FROM chat_sessions WHERE id = ?', [id]);
  });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

interface MessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model_used: string | null;
  attachments: string | null;
  tool_calls: string | null;
  created_at: string;
}

export function insertMessage(msg: {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  modelUsed?: string;
  attachments?: string;
  toolCalls?: string;
}): void {
  const now = new Date().toISOString();
  run(
    'INSERT INTO messages (id, session_id, role, content, model_used, attachments, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [msg.id, msg.sessionId, msg.role, msg.content, msg.modelUsed ?? null, msg.attachments ?? null, msg.toolCalls ?? null, now],
  );
}

export function getSessionMessages(sessionId: string): MessageRow[] {
  return query<MessageRow>(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC',
    [sessionId],
  );
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

interface AgentRow {
  id: string;
  name: string | null;
  type: 'coding' | 'requirements' | 'design' | 'testing' | null;
  system_prompt: string | null;
  skills: string | null;
  container_config: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export function getAgents(): AgentRow[] {
  return query<AgentRow>('SELECT * FROM agents ORDER BY created_at DESC');
}

export function getAgent(id: string): AgentRow | undefined {
  return get<AgentRow>('SELECT * FROM agents WHERE id = ?', [id]);
}

export function createAgent(agent: {
  id: string;
  name?: string;
  type?: 'coding' | 'requirements' | 'design' | 'testing';
  systemPrompt?: string;
  skills?: string;
  containerConfig?: string;
  status?: string;
}): void {
  const now = new Date().toISOString();
  run(
    'INSERT INTO agents (id, name, type, system_prompt, skills, container_config, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [agent.id, agent.name ?? null, agent.type ?? null, agent.systemPrompt ?? null, agent.skills ?? null, agent.containerConfig ?? null, agent.status ?? 'idle', now, now],
  );
}

const AGENT_FIELDS = new Set([
  'name', 'type', 'system_prompt', 'skills', 'container_config', 'status',
]);

export function updateAgent(id: string, updates: Partial<Pick<AgentRow, 'name' | 'type' | 'system_prompt' | 'skills' | 'container_config' | 'status'>>): void {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  const entries = Object.entries(updates) as Array<[string, unknown]>;
  for (const [col, value] of entries) {
    if (!AGENT_FIELDS.has(col)) {
      throw new Error(`Invalid field for agents update: ${col}`);
    }
    setClauses.push(`${col} = ?`);
    values.push(value);
  }

  if (setClauses.length === 0) return;

  setClauses.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  run(`UPDATE agents SET ${setClauses.join(', ')} WHERE id = ?`, values);
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

interface TaskRow {
  id: string;
  title: string | null;
  description: string | null;
  status: string;
  priority: string;
  agent_id: string | null;
  session_id: string | null;
  branch: string | null;
  worktree_path: string | null;
  created_at: string;
  updated_at: string;
}

export function getTasks(): TaskRow[] {
  return query<TaskRow>('SELECT * FROM tasks ORDER BY created_at DESC');
}

export function createTask(task: {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  agentId?: string;
  sessionId?: string;
  branch?: string;
  worktreePath?: string;
}): void {
  const now = new Date().toISOString();
  run(
    'INSERT INTO tasks (id, title, description, status, priority, agent_id, session_id, branch, worktree_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [task.id, task.title ?? null, task.description ?? null, task.status ?? 'new', task.priority ?? 'medium', task.agentId ?? null, task.sessionId ?? null, task.branch ?? null, task.worktreePath ?? null, now, now],
  );
}

const TASK_FIELDS = new Set([
  'title', 'description', 'status', 'priority', 'agent_id', 'session_id', 'branch', 'worktree_path',
]);

export function updateTask(id: string, updates: Partial<Pick<TaskRow, 'title' | 'description' | 'status' | 'priority' | 'agent_id' | 'session_id' | 'branch' | 'worktree_path'>>): void {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  const entries = Object.entries(updates) as Array<[string, unknown]>;
  for (const [col, value] of entries) {
    if (!TASK_FIELDS.has(col)) {
      throw new Error(`Invalid field for tasks update: ${col}`);
    }
    setClauses.push(`${col} = ?`);
    values.push(value);
  }

  if (setClauses.length === 0) return;

  setClauses.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  run(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`, values);
}

export function deleteTask(id: string): void {
  run('DELETE FROM tasks WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// Scheduled Tasks
// ---------------------------------------------------------------------------

interface ScheduledTaskRow {
  id: string;
  name: string | null;
  schedule_type: 'cron' | 'interval' | 'once' | null;
  schedule_expr: string | null;
  agent_type: string | null;
  prompt: string | null;
  work_directory: string | null;
  enabled: number;
  last_run: string | null;
  next_run: string | null;
  created_at: string;
  updated_at: string;
}

export function getScheduledTasks(): ScheduledTaskRow[] {
  return query<ScheduledTaskRow>('SELECT * FROM scheduled_tasks ORDER BY created_at DESC');
}

export function createScheduledTask(task: {
  id: string;
  name?: string;
  scheduleType?: 'cron' | 'interval' | 'once';
  scheduleExpr?: string;
  agentType?: string;
  prompt?: string;
  workDirectory?: string;
  enabled?: boolean;
  nextRun?: string;
}): void {
  const now = new Date().toISOString();
  run(
    'INSERT INTO scheduled_tasks (id, name, schedule_type, schedule_expr, agent_type, prompt, work_directory, enabled, next_run, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [task.id, task.name ?? null, task.scheduleType ?? null, task.scheduleExpr ?? null, task.agentType ?? null, task.prompt ?? null, task.workDirectory ?? null, task.enabled === false ? 0 : 1, task.nextRun ?? null, now, now],
  );
}

const SCHEDULED_TASK_FIELDS = new Set([
  'name', 'schedule_type', 'schedule_expr', 'agent_type', 'prompt', 'work_directory', 'enabled', 'last_run', 'next_run',
]);

export function updateScheduledTask(id: string, updates: Partial<Pick<ScheduledTaskRow, 'name' | 'schedule_type' | 'schedule_expr' | 'agent_type' | 'prompt' | 'work_directory' | 'enabled' | 'last_run' | 'next_run'>>): void {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  const entries = Object.entries(updates) as Array<[string, unknown]>;
  for (const [col, value] of entries) {
    if (!SCHEDULED_TASK_FIELDS.has(col)) {
      throw new Error(`Invalid field for scheduled_tasks update: ${col}`);
    }
    setClauses.push(`${col} = ?`);
    values.push(value);
  }

  if (setClauses.length === 0) return;

  setClauses.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  run(`UPDATE scheduled_tasks SET ${setClauses.join(', ')} WHERE id = ?`, values);
}

export function deleteScheduledTask(id: string): void {
  transaction(() => {
    run('DELETE FROM task_run_logs WHERE task_id = ?', [id]);
    run('DELETE FROM scheduled_tasks WHERE id = ?', [id]);
  });
}

// ---------------------------------------------------------------------------
// Task Run Logs
// ---------------------------------------------------------------------------

interface TaskRunLogRow {
  id: string;
  task_id: string;
  status: string | null;
  result_summary: string | null;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
}

export function getTaskRunLogs(taskId: string): TaskRunLogRow[] {
  return query<TaskRunLogRow>(
    'SELECT * FROM task_run_logs WHERE task_id = ? ORDER BY started_at DESC',
    [taskId],
  );
}

export function createTaskRunLog(log: {
  id: string;
  taskId: string;
  status?: string;
  resultSummary?: string;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
}): void {
  run(
    'INSERT INTO task_run_logs (id, task_id, status, result_summary, duration_ms, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [log.id, log.taskId, log.status ?? null, log.resultSummary ?? null, log.durationMs ?? null, log.startedAt ?? null, log.completedAt ?? null],
  );
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

interface ProviderRow {
  id: string;
  name: string | null;
  config: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
}

export function getProviders(): ProviderRow[] {
  return query<ProviderRow>('SELECT * FROM providers ORDER BY created_at DESC');
}

export function getProvider(id: string): ProviderRow | undefined {
  return get<ProviderRow>('SELECT * FROM providers WHERE id = ?', [id]);
}

export function createProvider(provider: {
  id: string;
  name?: string;
  config?: string;
  status?: string;
}): void {
  const now = new Date().toISOString();
  run(
    'INSERT INTO providers (id, name, config, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [provider.id, provider.name ?? null, provider.config ?? null, provider.status ?? null, now, now],
  );
}

// ---------------------------------------------------------------------------
// Agent Model Mappings
// ---------------------------------------------------------------------------

interface AgentModelMappingRow {
  id: string;
  agent_type: string | null;
  provider_id: string | null;
  model_id: string | null;
  is_fallback: number;
  created_at: string;
  updated_at: string;
}

export function getAgentModelMappings(agentType?: string): AgentModelMappingRow[] {
  if (agentType) {
    return query<AgentModelMappingRow>(
      'SELECT * FROM agent_model_mappings WHERE agent_type = ? ORDER BY is_fallback ASC, created_at DESC',
      [agentType],
    );
  }
  return query<AgentModelMappingRow>(
    'SELECT * FROM agent_model_mappings ORDER BY agent_type, is_fallback ASC, created_at DESC',
  );
}

export function setAgentModelMapping(mapping: {
  id: string;
  agentType: string;
  providerId: string;
  modelId: string;
  isFallback?: boolean;
}): void {
  const now = new Date().toISOString();
  run(
    'INSERT INTO agent_model_mappings (id, agent_type, provider_id, model_id, is_fallback, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET agent_type = excluded.agent_type, provider_id = excluded.provider_id, model_id = excluded.model_id, is_fallback = excluded.is_fallback, updated_at = excluded.updated_at',
    [mapping.id, mapping.agentType, mapping.providerId, mapping.modelId, mapping.isFallback ? 1 : 0, now, now],
  );
}

export function deleteAgentModelMapping(id: string): void {
  run('DELETE FROM agent_model_mappings WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// Installed Skills
// ---------------------------------------------------------------------------

interface InstalledSkillRow {
  id: string;
  name: string | null;
  version: string | null;
  source: string | null;
  manifest: string | null;
  installed_at: string;
  updated_at: string;
}

export function getInstalledSkills(): InstalledSkillRow[] {
  return query<InstalledSkillRow>('SELECT * FROM installed_skills ORDER BY installed_at DESC');
}

export function installSkill(skill: {
  id: string;
  name?: string;
  version?: string;
  source?: string;
  manifest?: string;
}): void {
  const now = new Date().toISOString();
  run(
    'INSERT INTO installed_skills (id, name, version, source, manifest, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, version = excluded.version, source = excluded.source, manifest = excluded.manifest, updated_at = excluded.updated_at',
    [skill.id, skill.name ?? null, skill.version ?? null, skill.source ?? null, skill.manifest ?? null, now, now],
  );
}

export function uninstallSkill(id: string): void {
  run('DELETE FROM installed_skills WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// Channel State
// ---------------------------------------------------------------------------

interface ChannelStateRow {
  id: string;
  channel_type: string | null;
  config: string | null;
  status: string | null;
  last_connected: string | null;
  updated_at: string;
}

export function getChannelState(id: string): ChannelStateRow | undefined;
export function getChannelState(): ChannelStateRow[];
export function getChannelState(id?: string): ChannelStateRow | ChannelStateRow[] | undefined {
  if (id) {
    return get<ChannelStateRow>('SELECT * FROM channel_state WHERE id = ?', [id]);
  }
  return query<ChannelStateRow>('SELECT * FROM channel_state ORDER BY updated_at DESC');
}

export function setChannelState(channel: {
  id: string;
  channelType?: string;
  config?: string;
  status?: string;
  lastConnected?: string;
}): void {
  const now = new Date().toISOString();
  run(
    'INSERT INTO channel_state (id, channel_type, config, status, last_connected, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET channel_type = COALESCE(excluded.channel_type, channel_type), config = COALESCE(excluded.config, config), status = COALESCE(excluded.status, status), last_connected = COALESCE(excluded.last_connected, last_connected), updated_at = excluded.updated_at',
    [channel.id, channel.channelType ?? null, channel.config ?? null, channel.status ?? null, channel.lastConnected ?? null, now],
  );
}

// ---------------------------------------------------------------------------
// Agent Sessions
// ---------------------------------------------------------------------------

interface AgentSessionRow {
  id: string;
  session_id: string | null;
  agent_type: string | null;
  mode: string | null;
  work_directory: string | null;
  git_snapshot_ref: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
}

export function getAgentSession(id: string): AgentSessionRow | undefined {
  return get<AgentSessionRow>('SELECT * FROM agent_sessions WHERE id = ?', [id]);
}

export function createAgentSession(session: {
  id: string;
  sessionId?: string;
  agentType?: string;
  mode?: string;
  workDirectory?: string;
  gitSnapshotRef?: string;
  status?: string;
}): void {
  const now = new Date().toISOString();
  run(
    'INSERT INTO agent_sessions (id, session_id, agent_type, mode, work_directory, git_snapshot_ref, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [session.id, session.sessionId ?? null, session.agentType ?? null, session.mode ?? null, session.workDirectory ?? null, session.gitSnapshotRef ?? null, session.status ?? null, now, now],
  );
}

const AGENT_SESSION_FIELDS = new Set([
  'session_id', 'agent_type', 'mode', 'work_directory', 'git_snapshot_ref', 'status',
]);

export function updateAgentSession(id: string, updates: Partial<Pick<AgentSessionRow, 'session_id' | 'agent_type' | 'mode' | 'work_directory' | 'git_snapshot_ref' | 'status'>>): void {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  const entries = Object.entries(updates) as Array<[string, unknown]>;
  for (const [col, value] of entries) {
    if (!AGENT_SESSION_FIELDS.has(col)) {
      throw new Error(`Invalid field for agent_sessions update: ${col}`);
    }
    setClauses.push(`${col} = ?`);
    values.push(value);
  }

  if (setClauses.length === 0) return;

  setClauses.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  run(`UPDATE agent_sessions SET ${setClauses.join(', ')} WHERE id = ?`, values);
}

// ---------------------------------------------------------------------------
// Board States
// ---------------------------------------------------------------------------

interface BoardStateRow {
  id: string;
  name: string;
  color: string;
  category: string;
  sort_order: number | null;
  allow_new_items: number;
}

export function getBoardStates(): BoardStateRow[] {
  return query<BoardStateRow>('SELECT * FROM board_states ORDER BY sort_order ASC');
}

export function createBoardState(state: {
  id: string;
  name: string;
  color: string;
  category: string;
  sortOrder?: number;
}): void {
  run(
    'INSERT INTO board_states (id, name, color, category, sort_order) VALUES (?, ?, ?, ?, ?)',
    [state.id, state.name, state.color, state.category, state.sortOrder ?? 0],
  );
}

// ---------------------------------------------------------------------------
// Board Issues
// ---------------------------------------------------------------------------

interface BoardIssueRow {
  id: string;
  title: string;
  description: string | null;
  state_id: string;
  priority: string;
  assignee: string | null;
  labels: string | null;
  parent_id: string | null;
  estimate_points: number | null;
  start_date: string | null;
  target_date: string | null;
  issue_type: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function getBoardIssues(filters?: {
  stateId?: string;
  priority?: string;
  issueType?: string;
  parentId?: string;
}): BoardIssueRow[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.stateId) {
    conditions.push('state_id = ?');
    params.push(filters.stateId);
  }
  if (filters?.priority) {
    conditions.push('priority = ?');
    params.push(filters.priority);
  }
  if (filters?.issueType) {
    conditions.push('issue_type = ?');
    params.push(filters.issueType);
  }
  if (filters?.parentId) {
    conditions.push('parent_id = ?');
    params.push(filters.parentId);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  return query<BoardIssueRow>(`SELECT * FROM board_issues${where} ORDER BY sort_order ASC, created_at DESC`, params);
}

export function getBoardIssue(id: string): BoardIssueRow | undefined {
  return get<BoardIssueRow>('SELECT * FROM board_issues WHERE id = ?', [id]);
}

export function createBoardIssue(issue: {
  id: string;
  title: string;
  description?: string;
  stateId: string;
  priority?: string;
  assignee?: string;
  labels?: string[];
  parentId?: string;
  estimatePoints?: number;
  startDate?: string;
  targetDate?: string;
  issueType?: string;
  sortOrder?: number;
}): void {
  const now = new Date().toISOString();
  run(
    `INSERT INTO board_issues (id, title, description, state_id, priority, assignee, labels, parent_id, estimate_points, start_date, target_date, issue_type, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      issue.id, issue.title, issue.description ?? null, issue.stateId,
      issue.priority ?? 'medium', issue.assignee ?? null,
      issue.labels ? JSON.stringify(issue.labels) : null, issue.parentId ?? null,
      issue.estimatePoints ?? null, issue.startDate ?? null, issue.targetDate ?? null,
      issue.issueType ?? 'task', issue.sortOrder ?? 0, now, now,
    ],
  );
}

const BOARD_ISSUE_FIELDS = new Set([
  'title', 'description', 'state_id', 'priority', 'assignee', 'labels',
  'parent_id', 'estimate_points', 'start_date', 'target_date', 'issue_type', 'sort_order',
]);

export function updateBoardIssue(id: string, updates: Record<string, unknown>): void {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (!BOARD_ISSUE_FIELDS.has(key)) {
      throw new Error(`Invalid field for board_issues update: ${key}`);
    }
    setClauses.push(`${key} = ?`);
    values.push(value);
  }

  if (setClauses.length === 0) return;

  setClauses.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  run(`UPDATE board_issues SET ${setClauses.join(', ')} WHERE id = ?`, values);
}

export function deleteBoardIssue(id: string): void {
  transaction(() => {
    // Detach sub-issues
    run('UPDATE board_issues SET parent_id = NULL WHERE parent_id = ?', [id]);
    run('DELETE FROM board_issues WHERE id = ?', [id]);
  });
}

export function moveBoardIssue(id: string, targetStateId: string, sortOrder: number): void {
  const now = new Date().toISOString();
  run(
    'UPDATE board_issues SET state_id = ?, sort_order = ?, updated_at = ? WHERE id = ?',
    [targetStateId, sortOrder, now, id],
  );
}

// ---------------------------------------------------------------------------
// Board Transitions
// ---------------------------------------------------------------------------

interface BoardTransitionRow {
  from_state_id: string;
  to_state_id: string;
}

export function getBoardTransitions(): BoardTransitionRow[] {
  return query<BoardTransitionRow>('SELECT * FROM board_transitions');
}

// ---------------------------------------------------------------------------
// Type exports for consumers
// ---------------------------------------------------------------------------

export type {
  ChatSessionRow,
  MessageRow,
  AgentRow,
  TaskRow,
  ScheduledTaskRow,
  TaskRunLogRow,
  ProviderRow,
  AgentModelMappingRow,
  InstalledSkillRow,
  ChannelStateRow,
  AgentSessionRow,
  BoardStateRow,
  BoardIssueRow,
  BoardTransitionRow,
};
