/**
 * Approval System
 * Manages approval requests for sensitive operations
 * Supports three modes: suggest (default), auto-edit, full-auto
 */
import type { BrowserWindow } from 'electron';
import Store from 'electron-store';

export type ApprovalAction = 'shell-command' | 'file-write-outside' | 'network-access' | 'git-push';
export type ApprovalMode = 'suggest' | 'auto-edit' | 'full-auto';

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  action: ApprovalAction;
  details: string;
  command?: string;
  timestamp: number;
  status: 'pending' | 'approved' | 'denied';
}

export interface RememberedRule {
  action: ApprovalAction;
  pattern: string;
  approved: boolean;
  createdAt: number;
}

interface ApprovalStoreData {
  approvalMode: ApprovalMode;
  rememberedRules: RememberedRule[];
}

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

const pendingApprovals = new Map<string, ApprovalRequest>();
const approvalCallbacks = new Map<string, (approved: boolean) => void>();
const approvalTimers = new Map<string, ReturnType<typeof setTimeout>>();
const rememberedRules: RememberedRule[] = [];

let approvalMode: ApprovalMode = 'suggest';
let mainWindow: BrowserWindow | null = null;
let approvalStore: Store<ApprovalStoreData> | null = null;

function getApprovalStore(): Store<ApprovalStoreData> | null {
  if (approvalStore) return approvalStore;
  try {
    approvalStore = new Store<ApprovalStoreData>({ name: 'approval' });
    return approvalStore;
  } catch {
    return null;
  }
}

function sanitizeRememberedRule(raw: unknown): RememberedRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const action = record.action;
  const pattern = record.pattern;
  const approved = record.approved;
  const createdAt = record.createdAt;
  if (
    action !== 'shell-command'
    && action !== 'file-write-outside'
    && action !== 'network-access'
    && action !== 'git-push'
  ) {
    return null;
  }
  if (typeof pattern !== 'string' || pattern.trim().length === 0) return null;
  if (typeof approved !== 'boolean') return null;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  return {
    action,
    pattern: pattern.trim(),
    approved,
    createdAt,
  };
}

function persistRememberedRules(): void {
  const store = getApprovalStore();
  store?.set('rememberedRules', rememberedRules);
}

function persistApprovalMode(): void {
  const store = getApprovalStore();
  store?.set('approvalMode', approvalMode);
}

function restoreApprovalState(): void {
  const store = getApprovalStore();
  if (!store) return;
  const storedMode = store.get('approvalMode');
  if (storedMode === 'suggest' || storedMode === 'auto-edit' || storedMode === 'full-auto') {
    approvalMode = storedMode;
  }
  const storedRules = store.get('rememberedRules');
  if (Array.isArray(storedRules)) {
    rememberedRules.length = 0;
    for (const rawRule of storedRules) {
      const parsed = sanitizeRememberedRule(rawRule);
      if (parsed) {
        rememberedRules.push(parsed);
      }
    }
  }
}

restoreApprovalState();

export function setApprovalWindow(win: BrowserWindow): void {
  mainWindow = win;
}

export function setApprovalMode(mode: ApprovalMode): void {
  approvalMode = mode;
  persistApprovalMode();
}

export function getApprovalMode(): ApprovalMode {
  return approvalMode;
}

function findRememberedRule(action: ApprovalAction, details: string): RememberedRule | undefined {
  return rememberedRules.find(rule => {
    if (rule.action !== action) return false;
    // Use word-boundary matching instead of naive substring to prevent
    // "rm" matching "format", "firmware", etc.
    // Pattern must match as a complete word/command in the details string.
    const escaped = rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|[\\s/\\\\])${escaped}($|[\\s/\\\\])`, 'i');
    return regex.test(details);
  });
}

export function addRememberedRule(action: ApprovalAction, pattern: string, approved: boolean): void {
  const normalizedPattern = pattern.trim();
  if (!normalizedPattern) return;
  const existing = rememberedRules.findIndex(r => r.action === action && r.pattern === normalizedPattern);
  if (existing !== -1) {
    rememberedRules[existing] = { action, pattern: normalizedPattern, approved, createdAt: Date.now() };
  } else {
    rememberedRules.push({ action, pattern: normalizedPattern, approved, createdAt: Date.now() });
  }
  persistRememberedRules();
}

export function getRememberedRules(): RememberedRule[] {
  return [...rememberedRules];
}

export function clearRememberedRules(): void {
  rememberedRules.length = 0;
  persistRememberedRules();
}

export function removeRememberedRule(action: ApprovalAction, pattern: string): boolean {
  const normalizedPattern = pattern.trim();
  const before = rememberedRules.length;
  for (let i = rememberedRules.length - 1; i >= 0; i -= 1) {
    if (rememberedRules[i]?.action === action && rememberedRules[i]?.pattern === normalizedPattern) {
      rememberedRules.splice(i, 1);
    }
  }
  const changed = rememberedRules.length !== before;
  if (changed) {
    persistRememberedRules();
  }
  return changed;
}

function shouldAutoApprove(action: ApprovalAction, details: string): boolean | null {
  // Full-auto mode: approve workspace operations, but still require approval for
  // outside-workspace writes and git push (these affect external systems)
  if (approvalMode === 'full-auto') {
    if (action === 'file-write-outside' || action === 'git-push') {
      return null; // still need approval for out-of-workspace and pushes
    }
    return true;
  }

  // Auto-edit mode: require approval for shell commands, network access, and git push
  // File write outside workspace also needs approval
  if (approvalMode === 'auto-edit') {
    if (action === 'shell-command' || action === 'network-access' || action === 'git-push' || action === 'file-write-outside') {
      return null; // needs user approval
    }
    return true; // auto-approve other actions
  }

  // Suggest mode: check remembered rules
  const rule = findRememberedRule(action, details);
  if (rule) return rule.approved;

  return null; // need user approval
}

export function createApprovalRequest(
  sessionId: string,
  action: ApprovalAction,
  details: string,
  command?: string,
): { request: ApprovalRequest; waitForApproval: Promise<boolean> } {
  // Check auto-approve first
  const autoResult = shouldAutoApprove(action, details);
  if (autoResult !== null) {
    const id = `approval-auto-${Date.now()}`;
    const request: ApprovalRequest = {
      id,
      sessionId,
      action,
      details,
      command,
      timestamp: Date.now(),
      status: autoResult ? 'approved' : 'denied',
    };
    return { request, waitForApproval: Promise.resolve(autoResult) };
  }

  const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const request: ApprovalRequest = {
    id,
    sessionId,
    action,
    details,
    command,
    timestamp: Date.now(),
    status: 'pending',
  };

  pendingApprovals.set(id, request);

  // Send to renderer for UI display
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('approval:request', request);
  }

  const waitForApproval = new Promise<boolean>((resolve) => {
    approvalCallbacks.set(id, resolve);
    const timer = setTimeout(() => {
      if (pendingApprovals.has(id)) {
        console.warn(`[WARN] Approval request ${id} timed out after ${APPROVAL_TIMEOUT_MS}ms`);
        resolveApproval(id, false);
      }
    }, APPROVAL_TIMEOUT_MS);
    approvalTimers.set(id, timer);
  });

  return { request, waitForApproval };
}

export function resolveApproval(id: string, approved: boolean, remember?: { pattern: string }): void {
  const request = pendingApprovals.get(id);
  if (request) {
    request.status = approved ? 'approved' : 'denied';

    // Remember this decision if requested
    if (remember) {
      addRememberedRule(request.action, remember.pattern, approved);
    }

    // Clear the timeout timer to prevent leaks
    const timer = approvalTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      approvalTimers.delete(id);
    }

    const callback = approvalCallbacks.get(id);
    callback?.(approved);
    approvalCallbacks.delete(id);
    pendingApprovals.delete(id);
  }
}

export function getPendingApprovals(sessionId?: string): ApprovalRequest[] {
  const all = Array.from(pendingApprovals.values());
  return sessionId ? all.filter(a => a.sessionId === sessionId) : all;
}
