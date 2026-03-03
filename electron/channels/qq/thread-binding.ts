/**
 * QQ Thread Binder — Reply-chain based session binding
 * Tracks outgoing bot message IDs to session IDs, so user replies
 * to bot messages stay in the same coding session.
 *
 * QQ doesn't have native thread APIs, so we simulate thread continuity
 * by mapping each bot-sent messageId to the sessionId it belongs to.
 * When a user replies to a bot message (msgRef), we look up the binding
 * to route them back into the same session.
 */

interface Binding {
  sessionId: string;
  createdAt: number;
}

export class QQThreadBinder {
  private bindings = new Map<string, Binding>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly ttlMs: number;

  constructor(ttlMs = 3_600_000) {
    // Default TTL: 1 hour
    this.ttlMs = ttlMs;
  }

  /** Start periodic cleanup of expired bindings (every 5 min) */
  start(): void {
    this.stop();
    this.cleanupTimer = setInterval(() => this.cleanup(), 300_000);
  }

  /** Stop cleanup timer and clear all bindings */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.bindings.clear();
  }

  /** Record a bot-sent message → session mapping */
  bindOutgoing(messageId: string, sessionId: string): void {
    this.bindings.set(messageId, { sessionId, createdAt: Date.now() });
  }

  /**
   * Resolve session ID for an incoming message.
   * If the message has a msgRef that matches a known binding, reuse that session.
   * Otherwise return a default session ID based on scene and target.
   */
  resolveSession(msg: {
    scene: string;
    groupId?: string;
    guildId?: string;
    senderId: string;
    msgRef?: string;
  }): string {
    // Check reply-chain binding first
    if (msg.msgRef) {
      const binding = this.bindings.get(msg.msgRef);
      if (binding && Date.now() - binding.createdAt < this.ttlMs) {
        return binding.sessionId;
      }
    }

    // Fallback: default session based on scene + target
    const targetId = msg.groupId ?? msg.guildId ?? msg.senderId;
    return `qq:${msg.scene}:${targetId}`;
  }

  /** Get the number of active bindings (useful for diagnostics) */
  get size(): number {
    return this.bindings.size;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, entry] of this.bindings) {
      if (entry.createdAt < cutoff) {
        this.bindings.delete(id);
      }
    }
  }
}
