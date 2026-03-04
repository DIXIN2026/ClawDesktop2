/**
 * Channel Registration
 * Provides three production channels:
 * - feishu   (OpenClaw-style primary Feishu account)
 * - feishu2  (CoPaw-style secondary Feishu account)
 * - qq       (QQ Bot)
 * - email    (SMTP outbound notifications)
 */
import { getChannelManager } from './manager.js';
import type { ChannelInstance, ChannelStatus } from './manager.js';
import { QQChannel } from './qq/channel.js';
import type { QQBotConfig, QQConnectionState } from './qq/types.js';
import { QQThreadBinder } from './qq/thread-binding.js';
import { FeishuDesktopChannel } from './feishu-desktop/channel.js';
import type { FeishuDesktopConfig, FeishuConnectionState } from './feishu-desktop/types.js';
import { EmailChannel } from './email/channel.js';
import type { EmailConfig, EmailConnectionState } from './email/types.js';
import { getSetting, getChannelState, setSetting, setChannelState } from '../utils/db.js';
import {
  isConfigurableChannelId,
  sanitizeChannelConfigForStorage,
  hydrateChannelConfigSecrets,
  type ConfigurableChannelId,
} from './secure-config.js';

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

function emailStateToChannelStatus(state: EmailConnectionState): ChannelStatus {
  switch (state) {
    case 'connected': return 'connected';
    case 'connecting': return 'connecting';
    case 'reconnecting': return 'reconnecting';
    case 'disconnected': return 'disconnected';
    default: return 'disconnected';
  }
}

function resolveEmailTargetFromSessionId(sessionId: string): string | undefined {
  const parts = sessionId.split(':');
  const maybeTarget = (parts[parts.length - 1] ?? '').trim();
  if (maybeTarget.includes('@')) {
    return maybeTarget;
  }
  return undefined;
}

function createEmailChannelInstance(config: EmailConfig): ChannelInstance {
  let emailChannel: EmailChannel | null = null;

  const instance: ChannelInstance = {
    type: 'email',
    id: 'email',
    status: 'disconnected',
    start: async () => {
      emailChannel = new EmailChannel(config, {
        onStateChange: (state) => {
          instance.status = emailStateToChannelStatus(state);
        },
        onError: (err) => {
          console.error('[Email Channel] Error:', err.message);
          instance.status = 'error';
        },
      });
      await emailChannel.start();
    },
    stop: async () => {
      if (emailChannel) {
        await emailChannel.stop();
        emailChannel = null;
      }
    },
    send: async (sessionId, content) => {
      if (!emailChannel) throw new Error('Email channel not started');
      const to = resolveEmailTargetFromSessionId(sessionId);
      await emailChannel.send({
        to,
        content,
      });
    },
  };

  return instance;
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

function toEmailConfig(config: Record<string, unknown> | null): EmailConfig {
  const rawPort = config?.port;
  const parsedPort = typeof rawPort === 'number'
    ? rawPort
    : typeof rawPort === 'string'
      ? Number.parseInt(rawPort, 10)
      : Number.NaN;

  return {
    host: typeof config?.host === 'string' ? config.host : '',
    port: Number.isFinite(parsedPort) ? parsedPort : 465,
    secure: config?.secure !== false,
    username: typeof config?.username === 'string' ? config.username : undefined,
    password: typeof config?.password === 'string' ? config.password : undefined,
    from: typeof config?.from === 'string' ? config.from : '',
    to: typeof config?.to === 'string' ? config.to : '',
    subjectPrefix: typeof config?.subjectPrefix === 'string' ? config.subjectPrefix : undefined,
  };
}

function createInstance(channelId: ConfigurableChannelId, rawConfig: Record<string, unknown> | null): ChannelInstance {
  if (channelId === 'qq') {
    return createQQChannelInstance(toQQConfig(rawConfig));
  }
  if (channelId === 'email') {
    return createEmailChannelInstance(toEmailConfig(rawConfig));
  }
  return createFeishuChannelInstance(channelId, toFeishuConfig(rawConfig));
}

function persistSanitizedConfig(channelId: ConfigurableChannelId, config: Record<string, unknown>): void {
  const serialized = JSON.stringify(config);
  setChannelState({
    id: channelId,
    channelType: channelId,
    config: serialized,
    status: 'configured',
  });
  setSetting(`channel:${channelId}:config`, serialized);
}

export async function registerOrUpdateChannel(
  channelId: ConfigurableChannelId,
  rawConfig?: Record<string, unknown>,
): Promise<void> {
  const manager = getChannelManager();
  const channel = manager.getChannel(channelId);
  const wasConnected = channel?.status === 'connected';
  if (channel) {
    manager.unregister(channelId);
  }

  const resolvedConfig = rawConfig ?? loadStoredChannelConfig(channelId);
  let configForStorage: Record<string, unknown> | null = resolvedConfig ?? null;
  let removedSecretFields: string[] = [];

  if (resolvedConfig && isConfigurableChannelId(channelId)) {
    const result = await sanitizeChannelConfigForStorage(channelId, resolvedConfig);
    configForStorage = result.sanitizedConfig;
    removedSecretFields = result.removedSecretFields;
  }

  if (configForStorage && removedSecretFields.length > 0) {
    persistSanitizedConfig(channelId, configForStorage);
  }

  const runtimeConfig = isConfigurableChannelId(channelId)
    ? await hydrateChannelConfigSecrets(channelId, configForStorage)
    : (configForStorage ?? null);

  manager.register(createInstance(channelId, runtimeConfig));

  // Best-effort: keep previous running status after config update.
  if (wasConnected) {
    void manager.start(channelId).catch((err) => {
      console.warn(`[Channels] Failed to restart ${channelId} after config update:`, err instanceof Error ? err.message : String(err));
    });
  }
}

/**
 * Register all configured channels with the ChannelManager.
 * Called once during app initialization.
 */
export async function registerChannels(): Promise<void> {
  await registerOrUpdateChannel('feishu');
  await registerOrUpdateChannel('feishu2');
  await registerOrUpdateChannel('qq');
  await registerOrUpdateChannel('email');
}
