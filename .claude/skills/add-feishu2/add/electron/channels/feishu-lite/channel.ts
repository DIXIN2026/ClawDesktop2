/**
 * Feishu Lite Channel — CoPaw-style simplified Feishu integration.
 * Single account, WebSocket only, message dedup, sender name cache.
 */
import * as lark from '@larksuiteoapi/node-sdk';
import type {
  FeishuLiteConfig,
  FeishuLiteCallbacks,
  SenderCacheEntry,
} from './types.js';

const MAX_DEDUP_SIZE = 1000;
const SENDER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class FeishuLiteChannel {
  private client: lark.Client;
  private wsClient: lark.WSClient | null = null;
  private config: FeishuLiteConfig;
  private callbacks: FeishuLiteCallbacks;
  private seenMessages = new Map<string, boolean>();
  private senderCache = new Map<string, SenderCacheEntry>();

  constructor(config: FeishuLiteConfig, callbacks: FeishuLiteCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.client = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      appType: lark.AppType.SelfBuild,
    });
  }

  async start(): Promise<void> {
    this.callbacks.onStateChange('connecting');

    try {
      const eventDispatcher = new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data) => {
          await this.handleMessage(data);
        },
      });

      this.wsClient = new lark.WSClient({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
        loggerLevel: lark.LoggerLevel.WARN,
      });

      await this.wsClient.start({ eventDispatcher });
      this.callbacks.onStateChange('connected');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.callbacks.onError(error);
      this.callbacks.onStateChange('error');
    }
  }

  async stop(): Promise<void> {
    if (this.wsClient) {
      this.wsClient.close({ force: true });
      this.wsClient = null;
    }
    this.seenMessages.clear();
    this.senderCache.clear();
    this.callbacks.onStateChange('disconnected');
  }

  async send(chatId: string, content: string): Promise<void> {
    await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      },
    });
  }

  get isConnected(): boolean {
    return this.wsClient !== null;
  }

  private async handleMessage(data: Record<string, unknown>): Promise<void> {
    try {
      const message = data.message as Record<string, unknown> | undefined;
      if (!message) return;

      const messageId = typeof message.message_id === 'string' ? message.message_id : undefined;
      if (!messageId) return;

      // Dedup check
      if (this.seenMessages.has(messageId)) return;
      this.addToDedup(messageId);

      // Extract text content
      const msgType = typeof message.message_type === 'string' ? message.message_type : undefined;
      if (msgType !== 'text') return; // Only handle text for now

      const contentStr = typeof message.content === 'string' ? message.content : '';
      let text: string;
      try {
        const parsed = JSON.parse(contentStr) as { text?: string };
        text = parsed.text ?? '';
      } catch {
        text = contentStr;
      }

      if (!text.trim()) return;

      const sender = data.sender as Record<string, unknown> | undefined;
      const senderIdObj = sender?.sender_id as Record<string, string> | undefined;
      const senderId = senderIdObj?.open_id ?? 'unknown';
      const chatId = typeof message.chat_id === 'string' ? message.chat_id : '';
      const chatType = message.chat_type === 'group' ? 'group' as const : 'p2p' as const;

      // Resolve sender name
      const senderName = await this.resolveSenderName(senderId);

      this.callbacks.onMessage({
        messageId,
        chatId,
        chatType,
        content: text,
        senderId,
        senderName,
        timestamp: Date.now(),
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.callbacks.onError(error);
    }
  }

  private addToDedup(messageId: string): void {
    this.seenMessages.set(messageId, true);
    // Evict oldest entries when over limit
    if (this.seenMessages.size > MAX_DEDUP_SIZE) {
      const firstKey = this.seenMessages.keys().next().value;
      if (firstKey !== undefined) {
        this.seenMessages.delete(firstKey);
      }
    }
  }

  private async resolveSenderName(openId: string): Promise<string> {
    // Check cache
    const cached = this.senderCache.get(openId);
    if (cached && Date.now() - cached.cachedAt < SENDER_CACHE_TTL_MS) {
      return cached.name;
    }

    try {
      const resp = await this.client.contact.user.get({
        params: { user_id_type: 'open_id' },
        path: { user_id: openId },
      });
      const name = (resp.data?.user as Record<string, string> | undefined)?.name ?? openId;
      this.senderCache.set(openId, { name, cachedAt: Date.now() });
      return name;
    } catch {
      return openId;
    }
  }
}
