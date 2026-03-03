/**
 * Session Manager
 * Manages CodingSessions for agent execution lifecycle
 */
import { randomUUID } from 'crypto';

export interface CodingSession {
  sessionId: string;
  resumeAt?: string;
  mode: 'cli' | 'api';
  gitSnapshotRef?: string;
  agentType: 'coding' | 'requirements' | 'design' | 'testing';
  workDirectory: string;
  createdAt: number;
  lastActivityAt: number;
  status: 'active' | 'paused' | 'completed' | 'error';
}

const sessions = new Map<string, CodingSession>();

export function createSession(params: {
  mode: 'cli' | 'api';
  agentType: CodingSession['agentType'];
  workDirectory: string;
}): CodingSession {
  const session: CodingSession = {
    sessionId: randomUUID(),
    mode: params.mode,
    agentType: params.agentType,
    workDirectory: params.workDirectory,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    status: 'active',
  };
  sessions.set(session.sessionId, session);
  return session;
}

export function getSession(sessionId: string): CodingSession | undefined {
  return sessions.get(sessionId);
}

export function updateSession(sessionId: string, updates: Partial<CodingSession>): CodingSession | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;

  Object.assign(session, updates, { lastActivityAt: Date.now() });
  return session;
}

export function destroySession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

export function listSessions(): CodingSession[] {
  return Array.from(sessions.values());
}

export function getActiveSessions(): CodingSession[] {
  return listSessions().filter(s => s.status === 'active');
}
