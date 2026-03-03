/**
 * Feishu Desktop Channel — Client wrapper
 * Wraps @larksuiteoapi/node-sdk Client and WSClient for desktop use
 */
import * as Lark from '@larksuiteoapi/node-sdk';
import type {
  FeishuDesktopConfig,
  FeishuIncomingMessage,
  FeishuAttachment,
  CachedUserInfo,
  FeishuMessageEventData,
  FeishuUserInfoResponse,
} from './types.js';

/** Max entries in the user name LRU cache */
const USER_CACHE_MAX = 100;
/** TTL for cached user names (10 minutes) */
const USER_CACHE_TTL_MS = 10 * 60 * 1000;

function resolveDomain(domain: 'feishu' | 'lark'): Lark.Domain {
  return domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu;
}

export type MessageHandler = (msg: FeishuIncomingMessage) => void;
export type ErrorHandler = (error: Error) => void;

export class FeishuClient {
  readonly larkClient: Lark.Client;
  private wsClient: Lark.WSClient | null = null;
  private config: FeishuDesktopConfig;
  private userCache = new Map<string, CachedUserInfo>();
  private onMessage: MessageHandler | null = null;
  private onError: ErrorHandler | null = null;

  constructor(config: FeishuDesktopConfig) {
    this.config = config;
    this.larkClient = new Lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      appType: Lark.AppType.SelfBuild,
      domain: resolveDomain(config.domain),
    });
  }

  setHandlers(onMessage: MessageHandler, onError: ErrorHandler): void {
    this.onMessage = onMessage;
    this.onError = onError;
  }

  async connect(): Promise<void> {
    const eventDispatcher = new Lark.EventDispatcher({
      encryptKey: this.config.encryptKey,
      verificationToken: this.config.verificationToken,
    });

    eventDispatcher.register({
      'im.message.receive_v1': async (data) => {
        try {
          const event = data as unknown as FeishuMessageEventData;
          const msg = await this.parseMessageEvent(event);
          if (msg) {
            this.onMessage?.(msg);
          }
        } catch (err) {
          this.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      },
    });

    this.wsClient = new Lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      domain: resolveDomain(this.config.domain),
      loggerLevel: Lark.LoggerLevel.warn,
    });

    this.wsClient.start({ eventDispatcher });
  }

  disconnect(): void {
    // WSClient has no public stop/close method.
    // Dropping the reference allows GC to clean up the WebSocket.
    // Setting autoReconnect-related state to prevent reconnection attempts.
    this.wsClient = null;
    this.userCache.clear();
  }

  private async parseMessageEvent(event: FeishuMessageEventData): Promise<FeishuIncomingMessage | null> {
    const { sender, message } = event;
    if (!message?.message_id || !message?.chat_id) return null;

    const senderId = sender.sender_id.open_id;
    const contentType = message.message_type;
    const rawContent = message.content;

    // Parse text content from JSON wrapper
    const { text, attachments } = this.extractContent(contentType, rawContent);

    // Resolve sender name (async, best-effort)
    const senderName = await this.resolveUserName(senderId);

    return {
      chatId: message.chat_id,
      messageId: message.message_id,
      content: text,
      contentType,
      senderId,
      senderName,
      chatType: message.chat_type === 'p2p' ? 'p2p' : 'group',
      rootId: message.root_id || undefined,
      parentId: message.parent_id || undefined,
      timestamp: message.create_time,
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  }

  private extractContent(
    contentType: string,
    rawContent: string,
  ): { text: string; attachments: FeishuAttachment[] } {
    const attachments: FeishuAttachment[] = [];

    try {
      const parsed = JSON.parse(rawContent) as Record<string, unknown>;

      switch (contentType) {
        case 'text':
          return { text: (parsed.text as string) ?? rawContent, attachments };

        case 'image': {
          const imageKey = parsed.image_key as string | undefined;
          if (imageKey) {
            attachments.push({ type: 'image', key: imageKey });
          }
          return { text: '[image]', attachments };
        }

        case 'file': {
          const fileKey = parsed.file_key as string | undefined;
          const fileName = parsed.file_name as string | undefined;
          if (fileKey) {
            attachments.push({ type: 'file', key: fileKey, name: fileName });
          }
          return { text: `[file: ${fileName ?? 'unknown'}]`, attachments };
        }

        case 'audio': {
          const audioKey = parsed.file_key as string | undefined;
          if (audioKey) {
            attachments.push({ type: 'audio', key: audioKey });
          }
          return { text: '[audio]', attachments };
        }

        case 'video': {
          const videoKey = parsed.file_key as string | undefined;
          if (videoKey) {
            attachments.push({ type: 'video', key: videoKey });
          }
          return { text: '[video]', attachments };
        }

        default:
          return { text: rawContent, attachments };
      }
    } catch {
      return { text: rawContent, attachments };
    }
  }

  async resolveUserName(openId: string): Promise<string | undefined> {
    // Check cache first
    const cached = this.userCache.get(openId);
    if (cached && Date.now() - cached.fetchedAt < USER_CACHE_TTL_MS) {
      return cached.name;
    }

    try {
      const response = (await this.larkClient.contact.user.get({
        path: { user_id: openId },
        params: { user_id_type: 'open_id' },
      })) as FeishuUserInfoResponse;

      if (response.code !== 0) return undefined;

      const name = response.data?.user?.name ?? response.data?.user?.en_name;
      if (name) {
        // Evict oldest entry if cache is full (simple LRU via insertion order)
        if (this.userCache.size >= USER_CACHE_MAX) {
          const oldestKey = this.userCache.keys().next().value;
          if (oldestKey !== undefined) {
            this.userCache.delete(oldestKey);
          }
        }
        this.userCache.set(openId, { name, fetchedAt: Date.now() });
        return name;
      }
    } catch {
      // Non-critical: return undefined if user info fetch fails
    }

    return undefined;
  }
}
