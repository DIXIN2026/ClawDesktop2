/**
 * Feishu Desktop Channel — Main channel class
 * Manages WebSocket connection, message routing, dedup, and typing indicators
 */
import type {
  FeishuDesktopConfig,
  FeishuConnectionState,
  FeishuIncomingMessage,
  FeishuChannelCallbacks,
} from './types.js';
import { FeishuClient } from './client.js';
import { sendTextMessage, sendMarkdownCard } from './send.js';

/** Dedup window: 5 minutes */
const DEDUP_TTL_MS = 5 * 60 * 1000;
/** Dedup cleanup interval: 60 seconds */
const DEDUP_CLEANUP_INTERVAL_MS = 60 * 1000;
/** Typing indicator debounce: 3 seconds */
const TYPING_DEBOUNCE_MS = 3 * 1000;

/** Response shape for typing indicator API */
interface FeishuTypingResponse {
  code?: number;
  msg?: string;
}

export class FeishuDesktopChannel {
  private client: FeishuClient;
  private config: FeishuDesktopConfig;
  private callbacks: FeishuChannelCallbacks;
  private state: FeishuConnectionState = 'disconnected';

  // Message deduplication (messageId -> timestamp)
  private messageDedup = new Map<string, number>();
  private dedupCleanupInterval: ReturnType<typeof setInterval> | null = null;

  // Typing indicator debounce (chatId -> last sent timestamp)
  private typingDebounce = new Map<string, number>();

  constructor(config: FeishuDesktopConfig, callbacks: FeishuChannelCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.client = new FeishuClient(config);
  }

  /**
   * Build a session ID from message context.
   * Strategy:
   * - p2p: feishu:{chatId}:main
   * - group without thread: feishu:{chatId}:main
   * - group with thread: feishu:{chatId}:{rootId}
   */
  static buildSessionId(chatId: string, rootId?: string): string {
    return `feishu:${chatId}:${rootId ?? 'main'}`;
  }

  /**
   * Parse a session ID into its components.
   * Returns { chatId, rootId } where rootId is undefined for 'main'.
   */
  static parseSessionId(sessionId: string): { chatId: string; rootId: string | undefined } {
    const parts = sessionId.split(':');
    const chatId = parts[1] ?? '';
    const rootIdRaw = parts[2] ?? 'main';
    return {
      chatId,
      rootId: rootIdRaw === 'main' ? undefined : rootIdRaw,
    };
  }

  async start(): Promise<void> {
    if (this.state !== 'disconnected') {
      await this.stop();
    }

    this.setState('connecting');

    this.client = new FeishuClient(this.config);
    this.client.setHandlers(
      (msg: FeishuIncomingMessage) => this.handleMessage(msg),
      (err: Error) => {
        console.error('[Feishu Desktop] Client error:', err.message);
        this.callbacks.onError(err);
      },
    );

    // Start dedup cleanup interval
    this.dedupCleanupInterval = setInterval(() => {
      const cutoff = Date.now() - DEDUP_TTL_MS;
      for (const [id, ts] of this.messageDedup) {
        if (ts < cutoff) this.messageDedup.delete(id);
      }
      // Also clean stale typing debounce entries
      for (const [chatId, ts] of this.typingDebounce) {
        if (ts < cutoff) this.typingDebounce.delete(chatId);
      }
    }, DEDUP_CLEANUP_INTERVAL_MS);

    try {
      await this.client.connect();
      this.setState('connected');
    } catch (err) {
      this.setState('disconnected');
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.dedupCleanupInterval) {
      clearInterval(this.dedupCleanupInterval);
      this.dedupCleanupInterval = null;
    }

    this.client.disconnect();
    this.messageDedup.clear();
    this.typingDebounce.clear();
    this.setState('disconnected');
  }

  /**
   * Send a message to a session.
   * If content contains markdown (code blocks, headers, bold, etc.), sends as a card.
   * Otherwise sends as plain text.
   */
  async send(sessionId: string, content: string): Promise<void> {
    const { chatId, rootId } = FeishuDesktopChannel.parseSessionId(sessionId);
    if (!chatId) {
      throw new Error(`Invalid session ID: ${sessionId}`);
    }

    const replyTo = rootId; // Reply to thread root if in a thread
    const useCard = this.shouldUseCard(content);

    if (useCard) {
      await sendMarkdownCard(this.client.larkClient, chatId, content, replyTo);
    } else {
      await sendTextMessage(this.client.larkClient, chatId, content, replyTo);
    }
  }

  getState(): FeishuConnectionState {
    return this.state;
  }

  updateConfig(config: FeishuDesktopConfig): void {
    this.config = config;
  }

  /**
   * Send a typing indicator to a chat.
   * Debounced to avoid excessive API calls (max once per 3 seconds per chat).
   */
  /**
   * Send typing indicator to the chat.
   * Note: Feishu/Lark does NOT provide a public API for typing indicators.
   * This method is a no-op placeholder for interface compatibility.
   * The typing indicator UI is handled automatically by Feishu clients.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async sendTypingIndicator(_chatId: string): Promise<void> {
    // Feishu does not expose a typing indicator API.
    // This method exists only to satisfy the ChannelInstance interface.
    // Typing indicators are handled natively by Feishu clients.
    return;
  }

  private handleMessage(msg: FeishuIncomingMessage): void {
    // Deduplicate messages
    if (this.messageDedup.has(msg.messageId)) return;
    this.messageDedup.set(msg.messageId, Date.now());

    this.callbacks.onMessage(msg);
  }

  private setState(state: FeishuConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.callbacks.onStateChange(state);
  }

  /**
   * Detect whether content should be sent as a markdown card.
   * Heuristic: if the content contains markdown syntax like code blocks,
   * headers, bold/italic, or tables, use a card for proper rendering.
   */
  private shouldUseCard(content: string): boolean {
    return /```|^#{1,6}\s|^\|.+\||(\*\*|__).+(\*\*|__)|^\s*[-*]\s/m.test(content);
  }
}
