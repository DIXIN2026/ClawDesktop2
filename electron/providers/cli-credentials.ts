/**
 * CLI Credential Reader
 *
 * Reads OAuth credentials from coding CLI tools (Claude Code, Codex, Qwen, MiniMax)
 * and exposes them for provider discovery. All readers are fail-safe (never throw).
 *
 * Credential sources (tried in order per tool):
 *   Claude CLI : macOS Keychain("Claude Code-credentials") -> ~/.claude/.credentials.json
 *   Codex CLI  : macOS Keychain(sha256 hash of codex home) -> ~/.codex/auth.json
 *   Qwen CLI   : ~/.qwen/oauth_creds.json
 *   MiniMax CLI: ~/.minimax/oauth_creds.json
 */

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync, realpathSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import type { DiscoveredProvider } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CliCredentialResult {
  providerId: string;
  source: string;
  accessToken: string;
  expiresAt: number;
}

interface CachedCredential<T> {
  value: T | null;
  readAt: number;
  cacheKey: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 60_000;
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const KEYCHAIN_TIMEOUT_MS = 600;

const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials';
const CLAUDE_CRED_PATH = '.claude/.credentials.json';
const CODEX_AUTH_FILENAME = 'auth.json';
const QWEN_CRED_PATH = '.qwen/oauth_creds.json';
const MINIMAX_CRED_PATH = '.minimax/oauth_creds.json';

// ---------------------------------------------------------------------------
// Module-level caches
// ---------------------------------------------------------------------------

let claudeCache: CachedCredential<CliCredentialResult> | null = null;
let codexCache: CachedCredential<CliCredentialResult> | null = null;
let qwenCache: CachedCredential<CliCredentialResult> | null = null;
let minimaxCache: CachedCredential<CliCredentialResult> | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function home(): string {
  return homedir();
}

function isStale(expiresAt: number): boolean {
  return expiresAt - Date.now() < STALE_THRESHOLD_MS;
}

function loadJsonFileSafe(filePath: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read a generic password from macOS Keychain using `execFileSync` (safe from injection).
 * Returns the trimmed secret string, or null on any failure.
 */
function readKeychainSecret(service: string, account?: string): string | null {
  if (process.platform !== 'darwin') {
    return null;
  }
  try {
    const args = ['find-generic-password', '-s', service];
    if (account) {
      args.push('-a', account);
    }
    args.push('-w');

    const result = execFileSync('security', args, {
      encoding: 'utf8',
      timeout: KEYCHAIN_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch {
    return null;
  }
}

function resolveCodexHomePath(): string {
  const configured = process.env['CODEX_HOME'];
  const base = configured ? configured : join(home(), '.codex');
  try {
    return realpathSync(base);
  } catch {
    return base;
  }
}

function computeCodexKeychainAccount(codexHome: string): string {
  const hash = createHash('sha256').update(codexHome).digest('hex');
  return `cli|${hash.slice(0, 16)}`;
}

function isCacheValid<T>(
  cache: CachedCredential<T> | null,
  cacheKey: string,
  ttlMs: number,
): cache is CachedCredential<T> {
  if (!cache) return false;
  if (cache.cacheKey !== cacheKey) return false;
  return Date.now() - cache.readAt < ttlMs;
}

// ---------------------------------------------------------------------------
// Claude CLI reader
// ---------------------------------------------------------------------------

function readClaudeCliCredential(options?: { includeKeychain?: boolean }): CliCredentialResult | null {
  if (options?.includeKeychain !== false) {
    const keychainSecret = readKeychainSecret(CLAUDE_KEYCHAIN_SERVICE);
    if (keychainSecret) {
      const cred = parseClaudeKeychainData(keychainSecret);
      if (cred) return cred;
    }
  }

  // 2. Fall back to credentials file
  const filePath = join(home(), CLAUDE_CRED_PATH);
  const data = loadJsonFileSafe(filePath);
  if (!data) return null;

  return parseClaudeOauth(data['claudeAiOauth']);
}

function parseClaudeKeychainData(raw: string): CliCredentialResult | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    return parseClaudeOauth(data['claudeAiOauth']);
  } catch {
    return null;
  }
}

function parseClaudeOauth(oauth: unknown): CliCredentialResult | null {
  if (!oauth || typeof oauth !== 'object') return null;

  const record = oauth as Record<string, unknown>;
  const accessToken = record['accessToken'];
  const expiresAt = record['expiresAt'];

  if (typeof accessToken !== 'string' || !accessToken) return null;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= 0) return null;
  if (isStale(expiresAt)) return null;

  return {
    providerId: 'anthropic',
    source: 'claude-cli',
    accessToken,
    expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Codex CLI reader
// ---------------------------------------------------------------------------

function readCodexCliCredential(options?: { includeKeychain?: boolean }): CliCredentialResult | null {
  if (options?.includeKeychain !== false && process.platform === 'darwin') {
    const codexHome = resolveCodexHomePath();
    const account = computeCodexKeychainAccount(codexHome);
    const keychainSecret = readKeychainSecret('Codex Auth', account);
    if (keychainSecret) {
      const cred = parseCodexKeychainData(keychainSecret);
      if (cred) return cred;
    }
  }

  // 2. Fall back to auth file
  const authPath = join(resolveCodexHomePath(), CODEX_AUTH_FILENAME);
  const data = loadJsonFileSafe(authPath);
  if (!data) return null;

  return parseCodexTokens(data['tokens'], authPath);
}

function parseCodexKeychainData(raw: string): CliCredentialResult | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const tokens = parsed['tokens'] as Record<string, unknown> | undefined;
    if (!tokens || typeof tokens !== 'object') return null;

    const accessToken = tokens['access_token'];
    if (typeof accessToken !== 'string' || !accessToken) return null;

    // Codex keychain stores last_refresh rather than explicit expiry
    const lastRefreshRaw = parsed['last_refresh'];
    const lastRefresh =
      typeof lastRefreshRaw === 'string' || typeof lastRefreshRaw === 'number'
        ? new Date(lastRefreshRaw).getTime()
        : Date.now();
    const expiresAt = Number.isFinite(lastRefresh)
      ? lastRefresh + 60 * 60 * 1000
      : Date.now() + 60 * 60 * 1000;

    if (isStale(expiresAt)) return null;

    return {
      providerId: 'openai',
      source: 'codex-cli',
      accessToken,
      expiresAt,
    };
  } catch {
    return null;
  }
}

function parseCodexTokens(
  tokens: unknown,
  authPath: string,
): CliCredentialResult | null {
  if (!tokens || typeof tokens !== 'object') return null;
  const record = tokens as Record<string, unknown>;

  const accessToken = record['access_token'];
  if (typeof accessToken !== 'string' || !accessToken) return null;

  // Derive expiry from file mtime + 1 hour
  let expiresAt: number;
  try {
    const stat = statSync(authPath);
    expiresAt = stat.mtimeMs + 60 * 60 * 1000;
  } catch {
    expiresAt = Date.now() + 60 * 60 * 1000;
  }

  if (isStale(expiresAt)) return null;

  return {
    providerId: 'openai',
    source: 'codex-cli',
    accessToken,
    expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Qwen CLI reader
// ---------------------------------------------------------------------------

function readQwenCliCredential(): CliCredentialResult | null {
  const filePath = join(home(), QWEN_CRED_PATH);
  return readPortalCredential(filePath, 'dashscope-coding', 'qwen-cli');
}

// ---------------------------------------------------------------------------
// MiniMax CLI reader
// ---------------------------------------------------------------------------

function readMiniMaxCliCredential(): CliCredentialResult | null {
  const filePath = join(home(), MINIMAX_CRED_PATH);
  return readPortalCredential(filePath, 'minimax-coding', 'minimax-cli');
}

// ---------------------------------------------------------------------------
// Shared portal reader (Qwen + MiniMax use the same JSON shape)
// ---------------------------------------------------------------------------

function readPortalCredential(
  filePath: string,
  providerId: string,
  source: string,
): CliCredentialResult | null {
  const data = loadJsonFileSafe(filePath);
  if (!data) return null;

  const accessToken = data['access_token'];
  const expiresAt = data['expiry_date'];

  if (typeof accessToken !== 'string' || !accessToken) return null;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
  if (isStale(expiresAt)) return null;

  return {
    providerId,
    source,
    accessToken,
    expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Cached readers
// ---------------------------------------------------------------------------

function readCached(
  cache: CachedCredential<CliCredentialResult> | null,
  cacheKey: string,
  ttlMs: number,
  reader: () => CliCredentialResult | null,
): { result: CliCredentialResult | null; cache: CachedCredential<CliCredentialResult> } {
  if (isCacheValid(cache, cacheKey, ttlMs)) {
    return { result: cache.value, cache };
  }
  const value = reader();
  const newCache: CachedCredential<CliCredentialResult> = {
    value,
    readAt: Date.now(),
    cacheKey,
  };
  return { result: value, cache: newCache };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read credentials from all known CLI tools.
 * Returns only valid, non-stale credentials. Never throws.
 */
export function readAllCliCredentials(opts?: { ttlMs?: number; includeKeychain?: boolean }): CliCredentialResult[] {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const includeKeychain = opts?.includeKeychain ?? true;
  const results: CliCredentialResult[] = [];

  try {
    // Claude
    const claudeKey = join(home(), CLAUDE_CRED_PATH);
    const claudeResult = readCached(claudeCache, claudeKey, ttlMs, () =>
      readClaudeCliCredential({ includeKeychain }),
    );
    claudeCache = claudeResult.cache;
    if (claudeResult.result) results.push(claudeResult.result);

    // Codex
    const codexKey = join(resolveCodexHomePath(), CODEX_AUTH_FILENAME);
    const codexResult = readCached(codexCache, codexKey, ttlMs, () =>
      readCodexCliCredential({ includeKeychain }),
    );
    codexCache = codexResult.cache;
    if (codexResult.result) results.push(codexResult.result);

    // Qwen
    const qwenKey = join(home(), QWEN_CRED_PATH);
    const qwenResult = readCached(qwenCache, qwenKey, ttlMs, readQwenCliCredential);
    qwenCache = qwenResult.cache;
    if (qwenResult.result) results.push(qwenResult.result);

    // MiniMax
    const minimaxKey = join(home(), MINIMAX_CRED_PATH);
    const minimaxResult = readCached(minimaxCache, minimaxKey, ttlMs, readMiniMaxCliCredential);
    minimaxCache = minimaxResult.cache;
    if (minimaxResult.result) results.push(minimaxResult.result);
  } catch {
    // Top-level safety net: never propagate errors
  }

  return results;
}

/**
 * Scan all CLI credential sources and return discovered providers.
 * Suitable for provider discovery/registration flows.
 */
export function scanCliCredentials(opts?: { includeKeychain?: boolean }): DiscoveredProvider[] {
  const credentials = readAllCliCredentials({ includeKeychain: opts?.includeKeychain ?? true });
  return credentials.map((cred) => ({
    providerId: cred.providerId,
    source: 'cli-credential' as DiscoveredProvider['source'],
    details: `Authenticated via ${cred.source} (expires ${new Date(cred.expiresAt).toISOString()})`,
  }));
}

/**
 * Reset all module-level caches. Intended for testing only.
 */
export function resetCliCredentialCaches(): void {
  claudeCache = null;
  codexCache = null;
  qwenCache = null;
  minimaxCache = null;
}
