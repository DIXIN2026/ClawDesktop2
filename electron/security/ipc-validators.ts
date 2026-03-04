/**
 * IPC input validation schemas using Zod v4.
 * Validates untrusted renderer input before processing in main process.
 */
import { z } from 'zod';

// --- Reusable schemas ---

/** Settings key: alphanumeric + dot/underscore/hyphen, max 128 chars */
const settingsKeySchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9._:-]+$/, 'Settings key must be alphanumeric with . _ : -');

/** Safe path: non-empty, max 1024 chars, no null bytes */
const safePathSchema = z.string()
  .min(1)
  .max(1024)
  .refine((s) => !s.includes('\0'), 'Path must not contain null bytes');

/** Safe string factory */
function safeString(maxLen: number) {
  return z.string().min(1).max(maxLen).refine(
    (s) => !s.includes('\0'),
    'String must not contain null bytes',
  );
}

/** Safe text that may be empty */
function safeText(maxLen: number) {
  return z.string().max(maxLen).refine(
    (s) => !s.includes('\0'),
    'String must not contain null bytes',
  );
}

const imageAttachmentSchema = z.object({
  type: z.literal('image'),
  mimeType: z.string().max(128).regex(/^image\/[a-zA-Z0-9.+-]+$/, 'Invalid image mime type'),
  data: z.string().min(1).max(8_000_000).regex(/^[A-Za-z0-9+/=]+$/, 'Invalid base64 image payload'),
  name: safeText(256).optional(),
  size: z.number().int().min(1).max(10_000_000).optional(),
});

const chatSendOptionsSchema = z.object({
  mode: z.enum(['cli', 'api']).optional(),
  cliBackend: z.string().max(64).optional(),
  providerId: z.string().max(128).optional(),
  modelId: z.string().max(128).optional(),
  agentType: z.enum(['coding', 'requirements', 'design', 'testing']).optional(),
  workDirectory: safePathSchema.optional(),
  attachments: z.array(imageAttachmentSchema).max(4).optional(),
}).optional();

// --- Channel-specific schemas ---

const schemas: Record<string, z.ZodType<unknown>> = {
  'settings:get': z.tuple([z.unknown(), settingsKeySchema]),

  'settings:set': z.tuple([z.unknown(), settingsKeySchema, safeString(65536)]),

  'chat:send': z.tuple([
    z.unknown(),
    safeString(128),   // sessionId
    safeText(512000), // content (500KB limit)
    chatSendOptionsSchema,
  ]).refine((tuple) => {
    const content = tuple[2];
    const options = tuple[3];
    if (typeof content !== 'string') return false;
    if (content.trim().length > 0) return true;
    return (options?.attachments?.length ?? 0) > 0;
  }, {
    message: 'chat:send requires non-empty content or at least one attachment',
  }),

  'chat:abort': z.tuple([
    z.unknown(),
    safeString(128), // sessionId
  ]),

  'chat:clarification-response': z.tuple([
    z.unknown(),
    z.object({
      clarificationId: safeString(128),
      sessionId: safeString(128).optional(),
      answers: z.record(safeString(2000), safeText(10000)).optional(),
    }),
  ]),

  'chat:history': z.tuple([
    z.unknown(),
    safeString(128), // sessionId
  ]),

  'chat:switch-model': z.tuple([
    z.unknown(),
    safeString(128), // sessionId
    safeString(128), // providerId
    safeString(256), // modelId
  ]),

  'providers:configure': z.tuple([
    z.unknown(),
    safeString(128),  // id
    z.record(z.string(), z.unknown()), // config partial
  ]),

  'providers:models': z.tuple([
    z.unknown(),
    safeString(128), // providerId
  ]),

  'sessions:create': z.tuple([
    z.unknown(),
    z.object({
      title: safeString(256).optional(),
      agentId: z.enum(['coding', 'requirements', 'design', 'testing']).optional(),
      workDirectory: safePathSchema.optional(),
      currentModel: safeString(256).optional(),
      taskId: safeString(128).optional(),
    }).optional(),
  ]),

  'sessions:get': z.tuple([
    z.unknown(),
    safeString(128), // sessionId
  ]),

  'sessions:delete': z.tuple([
    z.unknown(),
    safeString(128), // sessionId
  ]),

  'sessions:resume': z.tuple([
    z.unknown(),
    safeString(128), // sessionId
  ]),

  'agents:update': z.tuple([
    z.unknown(),
    safeString(128), // id
    z.object({
      name: safeString(256).optional(),
      type: z.enum(['coding', 'requirements', 'design', 'testing']).optional(),
      system_prompt: safeString(65536).optional(),
      skills: safeString(65536).optional(),
      container_config: safeString(65536).optional(),
      status: safeString(64).optional(),
    }),
  ]),

  'tasks:create': z.tuple([
    z.unknown(),
    z.object({
      title: safeString(512).optional(),
      description: safeString(65536).optional(),
      priority: safeString(32).optional(),
      agentId: safeString(128).optional(),
    }).optional(),
  ]),

  'tasks:update': z.tuple([
    z.unknown(),
    safeString(128), // id
    z.record(z.string(), z.unknown()),
  ]),

  'board:issues:create': z.tuple([
    z.unknown(),
    z.object({
      title: safeString(512),
      description: safeString(65536).optional(),
      stateId: safeString(128),
      priority: safeString(32).optional(),
      assignee: safeString(128).optional(),
      labels: z.array(safeString(64)).max(20).optional(),
      parentId: safeString(128).optional(),
      estimatePoints: z.number().int().min(0).max(1000).optional(),
      startDate: safeString(32).optional(),
      targetDate: safeString(32).optional(),
      issueType: safeString(64).optional(),
    }),
  ]),

  'git:worktree-create': z.tuple([
    z.unknown(),
    safeString(256),   // branch
    safePathSchema,     // path
    safePathSchema.optional(), // work directory
  ]),

  'git:worktree-remove': z.tuple([
    z.unknown(),
    safePathSchema, // path
    safePathSchema.optional(), // work directory
  ]),

  'file:open': z.tuple([
    z.unknown(),
    safePathSchema,
  ]),

  'skills:install': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'skills:uninstall': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'skills:scan': z.tuple([
    z.unknown(),
    safePathSchema,
  ]),

  'skills:generate': z.tuple([
    z.unknown(),
    z.object({
      requirement: safeString(12000),
      providerId: safeString(128).optional(),
      modelId: safeString(256).optional(),
    }),
  ]),

  'skills:install-generated': z.tuple([
    z.unknown(),
    z.object({
      manifest: z.record(z.string(), z.unknown()),
      skillPrompt: safeString(200000),
    }),
  ]),

  'channels:config': z.tuple([
    z.unknown(),
    z.enum(['qq', 'feishu', 'feishu2', 'email']),
    z.record(z.string(), z.unknown()).optional(),
  ]),

  'channels:test': z.tuple([
    z.unknown(),
    z.enum(['qq', 'feishu', 'feishu2', 'email']),
  ]),

  'channels:start': z.tuple([
    z.unknown(),
    z.enum(['qq', 'feishu', 'feishu2', 'email']),
  ]),

  'channels:stop': z.tuple([
    z.unknown(),
    z.enum(['qq', 'feishu', 'feishu2', 'email']),
  ]),

  'approval:response': z.tuple([
    z.unknown(),
    safeString(128),
    z.boolean(),
    z.object({
      pattern: safeText(512),
    }).optional(),
  ]),

  'approval:mode:set': z.tuple([
    z.unknown(),
    z.enum(['suggest', 'auto-edit', 'full-auto']),
  ]),

  'board:issues:list': z.tuple([
    z.unknown(),
    z.object({
      stateId: safeString(128).optional(),
      priority: safeString(32).optional(),
      issueType: safeString(64).optional(),
      parentId: safeString(128).optional(),
    }).optional(),
  ]),

  'board:issues:get': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'board:issues:update': z.tuple([
    z.unknown(),
    safeString(128),
    z.record(z.string(), z.unknown()),
  ]),

  'board:issues:move': z.tuple([
    z.unknown(),
    safeString(128),
    safeString(128),
    z.number().optional(),
  ]),

  'board:issues:delete': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'board:issues:start': z.tuple([
    z.unknown(),
    z.object({
      id: safeString(128),
      title: safeString(512),
      agentType: z.enum(['coding', 'requirements', 'design', 'testing']).optional(),
    }),
  ]),

  'orchestrator:execute': z.tuple([
    z.unknown(),
    z.object({
      id: safeString(128),
      name: safeText(256),
      steps: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
      workDirectory: safePathSchema,
    }),
  ]),

  'orchestrator:cancel': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'orchestrator:status': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'engine:status': z.tuple([
    z.unknown(),
  ]),

  'mount:allowlist:list': z.tuple([
    z.unknown(),
  ]),

  'mount:allowlist:add': z.tuple([
    z.unknown(),
    safePathSchema,
  ]),

  'mount:allowlist:remove': z.tuple([
    z.unknown(),
    safePathSchema,
  ]),

  'window:minimize': z.tuple([
    z.unknown(),
  ]),

  'window:maximize': z.tuple([
    z.unknown(),
  ]),

  'window:close': z.tuple([
    z.unknown(),
  ]),

  'window:isMaximized': z.tuple([
    z.unknown(),
  ]),

  'providers:list': z.tuple([
    z.unknown(),
  ]),

  'providers:discover': z.tuple([
    z.unknown(),
  ]),

  'providers:get': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'providers:save': z.tuple([
    z.unknown(),
    z.object({
      id: safeString(128),
      name: safeText(256).optional(),
      accessType: z.enum(['local-cli', 'api-key', 'coding-plan']).optional(),
      apiProtocol: z.enum(['openai-compatible', 'anthropic-messages', 'ollama']).optional(),
      baseUrl: safeText(1024).optional(),
      envVar: safeText(128).optional(),
      models: z.array(z.record(z.string(), z.unknown())).max(512).optional(),
      status: z.enum(['available', 'unconfigured', 'error']).optional(),
      isBuiltin: z.boolean().optional(),
      icon: safeText(64).optional(),
      region: z.enum(['global', 'cn']).optional(),
    }),
  ]),

  'providers:delete': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'providers:setApiKey': z.tuple([
    z.unknown(),
    safeString(128),
    safeString(4096),
  ]),

  'providers:deleteApiKey': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'providers:hasApiKey': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'providers:getApiKeyMasked': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'providers:setDefault': z.tuple([
    z.unknown(),
    z.enum(['coding', 'requirements', 'design', 'testing']),
    safeString(128),
    safeString(256),
  ]),

  'providers:health': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'providers:cli-status': z.tuple([
    z.unknown(),
  ]),

  'sessions:list': z.tuple([
    z.unknown(),
  ]),

  'agents:list': z.tuple([
    z.unknown(),
  ]),

  'agents:get': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'agents:config': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'agents:set-model': z.tuple([
    z.unknown(),
    z.enum(['coding', 'requirements', 'design', 'testing']),
    safeString(128),
    safeString(256),
  ]),

  'git:status': z.tuple([
    z.unknown(),
    safePathSchema.optional(),
  ]),

  'git:diff': z.tuple([
    z.unknown(),
    z.union([safePathSchema, z.boolean()]).optional(),
    safePathSchema.optional(),
  ]),

  'git:commit': z.tuple([
    z.unknown(),
    safeString(512),
    safePathSchema.optional(),
  ]),

  'git:push': z.tuple([
    z.unknown(),
    safePathSchema.optional(),
  ]),

  'git:stage': z.tuple([
    z.unknown(),
    z.array(safePathSchema).min(1).max(500),
    safePathSchema.optional(),
  ]),

  'git:unstage': z.tuple([
    z.unknown(),
    z.array(safePathSchema).min(1).max(500),
    safePathSchema.optional(),
  ]),

  'git:revert': z.tuple([
    z.unknown(),
    z.array(safePathSchema).min(1).max(500),
    safePathSchema.optional(),
  ]),

  'git:snapshot': z.tuple([
    z.unknown(),
    safePathSchema.optional(),
  ]),

  'git:undo': z.tuple([
    z.unknown(),
    safeText(256).optional(),
    safePathSchema.optional(),
  ]),

  'git:redo': z.tuple([
    z.unknown(),
    safePathSchema.optional(),
  ]),

  'git:worktree-list': z.tuple([
    z.unknown(),
    safePathSchema.optional(),
  ]),

  'tasks:list': z.tuple([
    z.unknown(),
  ]),

  'tasks:delete': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'tasks:start': z.tuple([
    z.unknown(),
    z.object({
      id: safeString(128),
      title: safeString(512),
      agentType: z.enum(['coding', 'requirements', 'design', 'testing']).optional(),
    }),
  ]),

  'schedule:list': z.tuple([
    z.unknown(),
  ]),

  'schedule:create': z.tuple([
    z.unknown(),
    z.object({
      name: safeText(256).optional(),
      scheduleType: z.enum(['cron', 'interval', 'once']).optional(),
      scheduleExpr: safeText(256).optional(),
      agentType: safeText(64).optional(),
      prompt: safeText(65536).optional(),
      workDirectory: safePathSchema.optional(),
      enabled: z.boolean().optional(),
      nextRun: safeText(64).optional(),
    }).optional(),
  ]),

  'schedule:toggle': z.tuple([
    z.unknown(),
    safeString(128),
    z.boolean(),
  ]),

  'schedule:delete': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'schedule:logs': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'skills:search': z.tuple([
    z.unknown(),
    safeText(512),
  ]),

  'skills:list': z.tuple([
    z.unknown(),
  ]),

  'approval:mode:get': z.tuple([
    z.unknown(),
  ]),

  'directory:select': z.tuple([
    z.unknown(),
  ]),

  'board:states': z.tuple([
    z.unknown(),
  ]),

  'board:transitions': z.tuple([
    z.unknown(),
  ]),

  'channels:list': z.tuple([
    z.unknown(),
  ]),

  'memory:search': z.tuple([
    z.unknown(),
    z.object({
      query: safeString(4096),
      maxResults: z.number().int().min(1).max(100).optional(),
      minScore: z.number().min(0).max(1).optional(),
      sessionId: safeString(128).nullable().optional(),
    }),
  ]),

  'memory:stats': z.tuple([
    z.unknown(),
  ]),

  'memory:preferences:list': z.tuple([
    z.unknown(),
    z.object({
      sessionId: safeString(128).nullable().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional(),
  ]),

  'memory:config:get': z.tuple([
    z.unknown(),
  ]),

  'memory:config:set': z.tuple([
    z.unknown(),
    safeString(64),
    z.union([safeText(2048), z.number(), z.boolean()]),
  ]),

  'memory:delete': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'memory:delete-session': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'memory:preferences:delete': z.tuple([
    z.unknown(),
    safeString(128),
  ]),

  'memory:reindex': z.tuple([
    z.unknown(),
  ]),
};

/**
 * Validate IPC arguments for a given channel.
 * Throws ZodError if validation fails.
 * Returns typed args on success.
 */
export function validateIpcArgs(channel: string, args: unknown[]): void {
  const schema = schemas[channel];
  if (!schema) return; // No schema defined — pass through

  schema.parse(args);
}
