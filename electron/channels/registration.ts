/**
 * Channel Registration
 * Provides three production channels:
 * - feishu   (OpenClaw-style primary Feishu account)
 * - feishu2  (CoPaw-style secondary Feishu account)
 * - qq       (QQ Bot)
 */
import { getChannelManager } from './manager.js';
import type { ChannelInstance, ChannelStatus } from './manager.js';
import { QQChannel } from './qq/channel.js';
import type { QQBotConfig, QQConnectionState } from './qq/types.js';
import { QQThreadBinder } from './qq/thread-binding.js';
import { FeishuDesktopChannel } from './feishu-desktop/channel.js';
import type { FeishuDesktopConfig, FeishuConnectionState } from './feishu-desktop/types.js';
import { getSetting, getChannelState } from '../utils/db.js';

type ConfigurableChannelId = 'qq' | 'feishu' | 'feishu2';

function qqStateToChannelStatus(state: QQConnectionState): ChannelStatus {
  switch (state) {
    case 'connected': return 'connected';
    case 'connecting': return 'connecting';
    case 'reconnecting': return 'reconnecting';
    case 'disconnected': return 'disconnected';
    default: return 'disconnected';
  }
}

function createQQChannelInstance(config: QQBotConfig): ChannelInstance {
  let qqChannel: QQChannel | null = null;
  const threadBinder = new QQThreadBinder();

  const instance: ChannelInstance = {
    type: 'qq',
    id: 'qq',
    status: 'disconnected',
    start: async () => {
      threadBinder.start();
      qqChannel = new QQChannel(config, {
        onMessage: (msg) => {
          // Use thread binder to resolve session (reply-chain aware)
          const sessionId = threadBinder.resolveSession(msg);
          getChannelManager().dispatchMessage({
            channelType: 'qq',
            channelId: 'qq',
            sessionId,
            messageId: msg.messageId,
            content: msg.content,
            senderId: msg.senderId,
            senderName: msg.senderName,
            timestamp: msg.timestamp,
            attachments: msg.attachments?.map((a) => ({
              type: a.content_type,
              url: a.url,
              name: a.filename,
            })),
          });
        },
        onStateChange: (state) => {
          instance.status = qqStateToChannelStatus(state);
        },
        onError: (err) => {
          console.error('[QQ Channel] Error:', err.message);
          instance.status = 'error';
        },
      });
      await qqChannel.start();
    },
    stop: async () => {
      threadBinder.stop();
      if (qqChannel) {
        await qqChannel.stop();
        qqChannel = null;
      }
    },
    send: async (sessionId, content) => {
      if (!qqChannel) throw new Error('QQ channel not started');
      // Parse session ID for scene/target
      const parts = sessionId.split(':');
      const scene = (parts[1] ?? 'c2c') as 'c2c' | 'guild' | 'group' | 'direct';
      const targetId = parts[2] ?? '';
      const sentMsgId = await qqChannel.send({ scene, targetId, content });
      // Bind outgoing message to session for reply-chain tracking
      if (sentMsgId) {
        threadBinder.bindOutgoing(sentMsgId, sessionId);
      }
    },
  };
  return instance;
}

function feishuStateToChannelStatus(state: FeishuConnectionState): ChannelStatus {
  switch (state) {
    case 'connected': return 'connected';
    case 'connecting': return 'connecting';
    case 'reconnecting': return 'reconnecting';
    case 'disconnected': return 'disconnected';
    default: return 'disconnected';
  }
}

function createFeishuChannelInstance(
  channelId: 'feishu' | 'feishu2',
  config: FeishuDesktopConfig,
): ChannelInstance {
  let feishuChannel: FeishuDesktopChannel | null = null;
  const instance: ChannelInstance = {
    type: channelId,
    id: channelId,
    status: 'disconnected',
    start: async () => {
      feishuChannel = new FeishuDesktopChannel(config, {
        onMessage: (msg) => {
          const sessionId = `${channelId}:${msg.chatId}:${msg.rootId ?? 'main'}`;
          getChannelManager().dispatchMessage({
            channelType: channelId,
            channelId,
            sessionId,
            messageId: msg.messageId,
            content: msg.content,
            senderId: msg.senderId,
            senderName: msg.senderName,
            timestamp: msg.timestamp,
            attachments: msg.attachments?.map((a) => ({
              type: a.type,
              url: a.key,
              name: a.name ?? a.key,
            })),
          });
        },
        onStateChange: (state) => {
          instance.status = feishuStateToChannelStatus(state);
        },
        onError: (err) => {
          console.error('[Feishu Desktop] Error:', err.message);
          instance.status = 'error';
        },
      });
      await feishuChannel.start();
    },
    stop: async () => {
      if (feishuChannel) {
        await feishuChannel.stop();
        feishuChannel = null;
      }
    },
    send: async (sessionId, content) => {
      if (!feishuChannel) throw new Error('Feishu channel not started');
      await feishuChannel.send(sessionId, content);
    },
  };
  return instance;
}

function parseConfig<T>(raw: string | undefined | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function loadStoredChannelConfig(channelId: ConfigurableChannelId): Record<string, unknown> | null {
  const state = getChannelState(channelId) as { config?: string | null } | undefined;
  const fromState = parseConfig<Record<string, unknown>>(state?.config);
  if (fromState) return fromState;

  if (channelId === 'feishu2') {
    return (
      parseConfig<Record<string, unknown>>(getSetting('channel:feishu2:config')) ??
      parseConfig<Record<string, unknown>>(getSetting('channel:feishu-desktop:config'))
    );
  }

  return parseConfig<Record<string, unknown>>(getSetting(`channel:${channelId}:config`));
}

function toQQConfig(config: Record<string, unknown> | null): QQBotConfig {
  return {
    appId: typeof config?.appId === 'string' ? config.appId : '',
    clientSecret: typeof config?.clientSecret === 'string' ? config.clientSecret : '',
    sandbox: config?.sandbox === true,
  };
}

function toFeishuConfig(config: Record<string, unknown> | null): FeishuDesktopConfig {
  const domain = config?.domain === 'lark' ? 'lark' : 'feishu';
  return {
    appId: typeof config?.appId === 'string' ? config.appId : '',
    appSecret: typeof config?.appSecret === 'string' ? config.appSecret : '',
    encryptKey: typeof config?.encryptKey === 'string' ? config.encryptKey : undefined,
    verificationToken: typeof config?.verificationToken === 'string' ? config.verificationToken : undefined,
    domain,
  };
}

function createInstance(channelId: ConfigurableChannelId, rawConfig: Record<string, unknown> | null): ChannelInstance {
  if (channelId === 'qq') {
    return createQQChannelInstance(toQQConfig(rawConfig));
  }
  return createFeishuChannelInstance(channelId, toFeishuConfig(rawConfig));
}

export function registerOrUpdateChannel(
  channelId: ConfigurableChannelId,
  rawConfig?: Record<string, unknown>,
): void {
  const manager = getChannelManager();
  const channel = manager.getChannel(channelId);
  const wasConnected = channel?.status === 'connected';
  if (channel) {
    manager.unregister(channelId);
  }

  const resolvedConfig = rawConfig ?? loadStoredChannelConfig(channelId);
  manager.register(createInstance(channelId, resolvedConfig));

  // Best-effort: keep previous running status after config update.
  if (wasConnected) {
    manager.start(channelId).catch((err) => {
      console.warn(`[Channels] Failed to restart ${channelId} after config update:`, err instanceof Error ? err.message : String(err));
    });
  }
}

/**
 * Register all configured channels with the ChannelManager.
 * Called once during app initialization.
 */
export function registerChannels(): void {
  registerOrUpdateChannel('feishu');
  registerOrUpdateChannel('feishu2');
  registerOrUpdateChannel('qq');
}
