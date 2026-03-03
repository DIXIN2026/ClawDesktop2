/**
 * QQ Bot Channel — Main channel class
 * Manages WebSocket gateway connection and message routing
 */
import type { QQBotConfig, QQConnectionState, QQIncomingMessage, QQOutgoingMessage } from './types.js';
import { QQGateway } from './gateway.js';
import { sendMessage } from './send.js';
import { clearTokenCache } from './auth.js';

export interface QQChannelCallbacks {
  onMessage: (msg: QQIncomingMessage) => void;
  onStateChange: (state: QQConnectionState) => void;
  onError: (error: Error) => void;
}

export class QQChannel {
  private gateway: QQGateway | null = null;
  private config: QQBotConfig;
  private callbacks: QQChannelCallbacks;
  private messageDedup = new Map<string, number>(); // messageId -> timestamp
  private dedupCleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: QQBotConfig, callbacks: QQChannelCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    if (this.gateway) {
      await this.stop();
    }

    this.gateway = new QQGateway(this.config);

    this.gateway.on('message', (msg: QQIncomingMessage) => {
      // Deduplicate messages
      if (this.messageDedup.has(msg.messageId)) return;
      this.messageDedup.set(msg.messageId, Date.now());
      this.callbacks.onMessage(msg);
    });

    this.gateway.on('stateChange', (state: QQConnectionState) => {
      this.callbacks.onStateChange(state);
    });

    this.gateway.on('error', (err: Error) => {
      this.callbacks.onError(err);
    });

    // Periodically clean old dedup entries
    this.dedupCleanupInterval = setInterval(() => {
      const cutoff = Date.now() - 300_000; // 5 minutes
      for (const [id, ts] of this.messageDedup) {
        if (ts < cutoff) this.messageDedup.delete(id);
      }
    }, 60_000);

    await this.gateway.connect();
  }

  async stop(): Promise<void> {
    if (this.dedupCleanupInterval) {
      clearInterval(this.dedupCleanupInterval);
      this.dedupCleanupInterval = null;
    }
    if (this.gateway) {
      await this.gateway.disconnect();
      this.gateway = null;
    }
    clearTokenCache();
    this.messageDedup.clear();
  }

  async send(msg: QQOutgoingMessage): Promise<string | undefined> {
    return sendMessage(this.config, msg);
  }

  getState(): QQConnectionState {
    return this.gateway?.getState() ?? 'disconnected';
  }

  updateConfig(config: QQBotConfig): void {
    this.config = config;
  }
}
