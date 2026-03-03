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

// --- Channel-specific schemas ---

const schemas: Record<string, z.ZodType<unknown>> = {
  'settings:get': z.tuple([z.unknown(), settingsKeySchema]),

  'settings:set': z.tuple([z.unknown(), settingsKeySchema, safeString(65536)]),

  'chat:send': z.tuple([
    z.unknown(),
    safeString(128),   // sessionId
    safeString(512000), // content (500KB limit)
    z.object({
      mode: z.enum(['cli', 'api']).optional(),
      cliBackend: z.string().max(64).optional(),
      providerId: z.string().max(128).optional(),
      modelId: z.string().max(128).optional(),
      agentType: z.enum(['coding', 'requirements', 'design', 'testing']).optional(),
      workDirectory: safePathSchema.optional(),
    }).optional(),
  ]),

  'providers:configure': z.tuple([
    z.unknown(),
    safeString(128),  // id
    z.record(z.string(), z.unknown()), // config partial
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
  ]),

  'file:open': z.tuple([
    z.unknown(),
    safePathSchema,
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
