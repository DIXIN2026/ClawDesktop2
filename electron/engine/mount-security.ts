/**
 * Mount Security - Three Layer Defense
 * 1. External allowlist (~/.config/clawdesktop/mount-allowlist.json)
 * 2. Hardcoded blocked patterns
 * 3. Cascade validation
 */
import { existsSync, readFileSync, realpathSync, statSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve, normalize } from 'path';
import { homedir } from 'os';
import type { VolumeMount } from './container-runner.js';

const CONFIG_DIR = join(homedir(), '.config', 'clawdesktop');
const ALLOWLIST_PATH = join(CONFIG_DIR, 'mount-allowlist.json');

const DEFAULT_BLOCKED_PATTERNS = [
  '**/.ssh/**',
  '**/.gnupg/**',
  '**/.aws/**',
  '**/.azure/**',
  '**/.gcloud/**',
  '**/.config/gcloud/**',
  '**/Keychain/**',
  '**/.docker/config.json',
  '**/.npmrc',
  '**/.pypirc',
  '**/.env',
  '**/.env.*',
  '**/.env.local',
  '**/.netrc',
  '**/.kube/**',
  '**/.kube/config',
  '**/credentials',
  '**/credentials.json',
  '**/secrets/**',
  '**/tokens/**',
  '**/id_rsa',
  '**/id_rsa.*',
  '**/id_ed25519',
  '**/id_ed25519.*',
  '**/private_key*',
  '**/*.pem',
  '**/.secret*',
];

interface MountAllowlist {
  allowed: string[];
  version?: number;
}

function loadAllowlist(): MountAllowlist {
  try {
    if (existsSync(ALLOWLIST_PATH)) {
      const data = readFileSync(ALLOWLIST_PATH, 'utf-8');
      return JSON.parse(data) as MountAllowlist;
    }
  } catch (err) {
    console.error(
      `[ERROR] Failed to load mount allowlist from ${ALLOWLIST_PATH}: ` +
      `${err instanceof Error ? err.message : String(err)}. ` +
      `All additional mounts will be denied. Fix the file and retry.`,
    );
  }
  return { allowed: [] };
}

function matchGlobPattern(path: string, pattern: string): boolean {
  const normalizedPath = normalize(resolve(path)).replace(/\\/g, '/');
  const normalizedPattern = normalize(pattern).replace(/\\/g, '/');
  const pathSegments = normalizedPath.split('/').filter((segment) => segment.length > 0);
  const patternSegments = normalizedPattern.split('/').filter((segment) => segment.length > 0);
  const memo = new Map<string, boolean>();

  function getSegmentRegex(segment: string): RegExp {
    let regex = '^';
    for (let i = 0; i < segment.length; i += 1) {
      const ch = segment[i];
      if (ch === '*') {
        regex += '[^/]*';
        continue;
      }
      if (ch === '?') {
        regex += '[^/]';
        continue;
      }
      if (ch === '[') {
        const end = segment.indexOf(']', i + 1);
        if (end > i + 1) {
          const rawClass = segment.slice(i + 1, end);
          const negated = rawClass.startsWith('!');
          const classBody = (negated ? rawClass.slice(1) : rawClass).replace(/\\/g, '\\\\');
          regex += `[${negated ? '^' : ''}${classBody}]`;
          i = end;
          continue;
        }
      }
      regex += ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
    regex += '$';
    return new RegExp(regex);
  }

  function matches(patternIndex: number, pathIndex: number): boolean {
    const cacheKey = `${patternIndex}:${pathIndex}`;
    const cached = memo.get(cacheKey);
    if (cached !== undefined) return cached;

    if (patternIndex === patternSegments.length) {
      const matched = pathIndex === pathSegments.length;
      memo.set(cacheKey, matched);
      return matched;
    }

    const currentPattern = patternSegments[patternIndex];
    if (currentPattern === '**') {
      for (let i = pathIndex; i <= pathSegments.length; i += 1) {
        if (matches(patternIndex + 1, i)) {
          memo.set(cacheKey, true);
          return true;
        }
      }
      memo.set(cacheKey, false);
      return false;
    }

    if (pathIndex >= pathSegments.length) {
      memo.set(cacheKey, false);
      return false;
    }

    const segmentRegex = getSegmentRegex(currentPattern);
    const matched = segmentRegex.test(pathSegments[pathIndex]) && matches(patternIndex + 1, pathIndex + 1);
    memo.set(cacheKey, matched);
    return matched;
  }

  return matches(0, 0);
}

function isPathBlocked(hostPath: string): boolean {
  const normalized = normalize(resolve(hostPath));
  const home = homedir();

  for (const pattern of DEFAULT_BLOCKED_PATTERNS) {
    if (matchGlobPattern(normalized, pattern)) {
      return true;
    }
  }

  // Block paths outside home and outside /tmp
  const allowed = [home, '/tmp', '/var/tmp'];
  const allowedResolved = new Set<string>();
  for (const prefix of allowed) {
    allowedResolved.add(normalize(resolve(prefix)));
    try {
      allowedResolved.add(normalize(realpathSync(prefix)));
    } catch {
      void 0;
    }
  }
  if (![...allowedResolved].some(prefix =>
    normalized === prefix || normalized.startsWith(prefix + '/')
  )) {
    return true;
  }

  return false;
}

function isInAllowlist(hostPath: string, allowlist: MountAllowlist): boolean {
  const normalized = normalize(resolve(hostPath));
  return allowlist.allowed.some(allowed => {
    const normalizedAllowed = normalize(resolve(allowed));
    // Ensure path boundary match: normalized must be exactly the allowed path
    // or start with allowed path followed by a separator
    return normalized === normalizedAllowed ||
      normalized.startsWith(normalizedAllowed + '/');
  });
}

export interface MountValidationResult {
  valid: boolean;
  path: string;
  reason?: string;
}

/**
 * Resolve symlinks and expand ~ to home directory
 */
function resolveRealPath(hostPath: string): string {
  let expanded = hostPath;
  if (expanded.startsWith('~')) {
    expanded = join(homedir(), expanded.slice(1));
  }
  const normalized = normalize(resolve(expanded));

  // Resolve symlinks if path exists
  try {
    return realpathSync(normalized);
  } catch {
    return normalized;
  }
}

/**
 * Save allowlist to disk
 */
export function saveAllowlist(allowlist: MountAllowlist): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(ALLOWLIST_PATH, JSON.stringify(allowlist, null, 2), 'utf-8');
  } catch (err) {
    console.error(
      `[ERROR] Failed to save mount allowlist to ${ALLOWLIST_PATH}: ` +
      `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Add a path to the allowlist
 */
export function addToAllowlist(path: string): void {
  const allowlist = loadAllowlist();
  const resolved = resolveRealPath(path);
  if (!allowlist.allowed.includes(resolved)) {
    allowlist.allowed.push(resolved);
    saveAllowlist(allowlist);
  }
}

/**
 * Remove a path from the allowlist
 */
export function removeFromAllowlist(path: string): void {
  const allowlist = loadAllowlist();
  const resolved = resolveRealPath(path);
  allowlist.allowed = allowlist.allowed.filter(p => normalize(resolve(p)) !== resolved);
  saveAllowlist(allowlist);
}

/**
 * Get current allowlist entries
 */
export function getAllowlist(): string[] {
  return loadAllowlist().allowed;
}

const DANGEROUS_CONTAINER_PATHS = new Set([
  '/', '/proc', '/sys', '/dev', '/etc', '/root', '/bin', '/sbin',
]);

/**
 * Validate a container-side mount target path to prevent path traversal
 * or mounting over critical container directories.
 */
export function validateContainerPath(containerPath: string): MountValidationResult {
  if (!containerPath || !containerPath.trim()) {
    return { valid: false, path: containerPath, reason: 'Container path must not be empty' };
  }

  if (containerPath.includes('\0')) {
    return { valid: false, path: containerPath, reason: 'Container path must not contain null bytes' };
  }

  if (!containerPath.startsWith('/')) {
    return { valid: false, path: containerPath, reason: 'Container path must be absolute (start with /)' };
  }

  if (containerPath.split('/').includes('..')) {
    return { valid: false, path: containerPath, reason: 'Container path must not contain ".." traversal' };
  }

  // Normalize for comparison (remove trailing slashes, collapse multiple slashes)
  const normalized = containerPath.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  if (DANGEROUS_CONTAINER_PATHS.has(normalized)) {
    return { valid: false, path: containerPath, reason: `Container path "${normalized}" is a reserved system path` };
  }

  return { valid: true, path: containerPath };
}

export function validateMount(hostPath: string): MountValidationResult {
  const normalized = resolveRealPath(hostPath);

  // Layer 1: Check blocked patterns
  if (isPathBlocked(normalized)) {
    // Layer 2: Check allowlist override
    const allowlist = loadAllowlist();
    if (!isInAllowlist(normalized, allowlist)) {
      return {
        valid: false,
        path: normalized,
        reason: `Path is blocked by security policy. Add to ${ALLOWLIST_PATH} to override.`,
      };
    }
  }

  // Layer 3: Verify path exists and is a directory
  try {
    const stat = statSync(normalized);
    if (!stat.isDirectory()) {
      return {
        valid: false,
        path: normalized,
        reason: 'Mount path must be a directory',
      };
    }
  } catch {
    return {
      valid: false,
      path: normalized,
      reason: 'Mount path does not exist',
    };
  }

  return { valid: true, path: normalized };
}

export function validateAdditionalMounts(
  mounts: Array<{ hostPath: string; containerPath: string; readonly?: boolean }>,
): { valid: VolumeMount[]; rejected: MountValidationResult[] } {
  const valid: VolumeMount[] = [];
  const rejected: MountValidationResult[] = [];

  for (const mount of mounts) {
    const result = validateMount(mount.hostPath);
    if (result.valid) {
      valid.push({
        hostPath: result.path,
        containerPath: mount.containerPath,
        readonly: mount.readonly ?? true,
      });
    } else {
      rejected.push(result);
      console.warn(`[MOUNT REJECTED] ${result.path}: ${result.reason}`);
    }
  }

  return { valid, rejected };
}
