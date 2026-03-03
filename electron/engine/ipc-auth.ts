/**
 * IPC Authorization
 * Directory identity verification and per-session namespace isolation.
 * Uses path.resolve to prevent path traversal attacks.
 */
import { resolve, normalize, sep } from 'path';
import { randomUUID } from 'crypto';

interface SessionNamespace {
  sessionId: string;
  workDirectory: string;
  isMain: boolean;
  createdAt: number;
  /** Per-window session token for IPC request validation */
  sessionToken: string;
}

const activeNamespaces = new Map<string, SessionNamespace>();
/** Reverse lookup: sessionToken → sessionId */
const tokenToSession = new Map<string, string>();

export function createNamespace(sessionId: string, workDirectory: string, isMain: boolean): SessionNamespace {
  const sessionToken = randomUUID();
  const namespace: SessionNamespace = {
    sessionId,
    workDirectory: resolve(normalize(workDirectory)),
    isMain,
    createdAt: Date.now(),
    sessionToken,
  };
  activeNamespaces.set(sessionId, namespace);
  tokenToSession.set(sessionToken, sessionId);
  return namespace;
}

/**
 * Validate a session token matches an active session.
 * Returns the session ID if valid, null otherwise.
 */
export function validateSessionToken(token: string): string | null {
  return tokenToSession.get(token) ?? null;
}

export function getNamespace(sessionId: string): SessionNamespace | undefined {
  return activeNamespaces.get(sessionId);
}

export function removeNamespace(sessionId: string): void {
  const ns = activeNamespaces.get(sessionId);
  if (ns) {
    tokenToSession.delete(ns.sessionToken);
  }
  activeNamespaces.delete(sessionId);
}

/**
 * Validate that a session has access to the target path.
 * Resolves all symlinks and `..` segments before comparison to prevent traversal attacks.
 */
export function validateIpcAccess(
  sessionId: string,
  targetPath: string,
  operation: 'read' | 'write' = 'read',
): { allowed: boolean; reason?: string } {
  const namespace = activeNamespaces.get(sessionId);
  if (!namespace) {
    return { allowed: false, reason: 'Session not found' };
  }

  // Main session has full access
  if (namespace.isMain) {
    return { allowed: true };
  }

  // Resolve the target path to its absolute canonical form
  // This handles ../../../.ssh type attacks
  const resolvedTarget = resolve(normalize(targetPath));
  const resolvedWork = namespace.workDirectory;

  // Ensure resolvedTarget is exactly the work directory or a child of it
  // We append sep to prevent prefix attacks (e.g. /home/user/work-evil matching /home/user/work)
  const isInside = resolvedTarget === resolvedWork ||
    resolvedTarget.startsWith(resolvedWork + sep);

  if (!isInside) {
    return {
      allowed: false,
      reason: `Access denied: "${resolvedTarget}" is outside work directory "${resolvedWork}"`,
    };
  }

  // Non-main sessions are read-only
  if (operation === 'write') {
    return { allowed: false, reason: 'Non-main sessions have read-only access' };
  }

  return { allowed: true };
}

/**
 * Validate IPC args contain a valid string for the given index.
 * Throws if validation fails.
 */
export function validateStringArg(args: unknown[], index: number, argName: string): string {
  const val = args[index];
  if (typeof val !== 'string' || val.length === 0) {
    throw new Error(`${argName} must be a non-empty string`);
  }
  return val;
}

/**
 * Validate that an IPC arg is a boolean.
 */
export function validateBooleanArg(args: unknown[], index: number, argName: string, defaultValue?: boolean): boolean {
  const val = args[index];
  if (val === undefined && defaultValue !== undefined) return defaultValue;
  if (typeof val !== 'boolean') {
    throw new Error(`${argName} must be a boolean`);
  }
  return val;
}

export function listNamespaces(): SessionNamespace[] {
  return Array.from(activeNamespaces.values());
}
