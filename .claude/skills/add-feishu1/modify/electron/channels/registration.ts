/**
 * Channel Registration
 * Bridges Feishu (OpenClaw plugin) and QQ (standalone class) to ChannelManager
 */
import { getChannelManager } from './manager.js';
import type { ChannelInstance, ChannelStatus } from './manager.js';
import { QQChannel } from './qq/channel.js';
import type { QQBotConfig, QQConnectionState } from './qq/types.js';
import { getSetting } from '../utils/db.js';

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
  const instance: ChannelInstance = {
    type: 'qq',
    id: 'qq',
    status: 'disconnected',
    start: async () => {
      qqChannel = new QQChannel(config, {
        onMessage: (msg) => {
          getChannelManager().dispatchMessage({
            channelType: 'qq',
            channelId: 'qq',
            sessionId: `qq:${msg.scene}:${msg.groupId ?? msg.guildId ?? msg.senderId}`,
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
      if (qqChannel) {
        await qqChannel.stop();
        qqChannel = null;
      }
    },
    send: async (_sessionId, content) => {
      if (!qqChannel) throw new Error('QQ channel not started');
      // Default send to the session target; parsing session ID for scene/target
      const parts = _sessionId.split(':');
      const scene = (parts[1] ?? 'c2c') as 'c2c' | 'guild' | 'group' | 'direct';
      const targetId = parts[2] ?? '';
      await qqChannel.send({ scene, targetId, content });
    },
  };
  return instance;
}

interface FeishuChannelConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
  connectionMode?: 'websocket' | 'webhook';
  dmPolicy?: 'respond' | 'ignore';
  groupPolicy?: 'all' | 'mention-only' | 'ignore';
  requireMention?: boolean;
}

function createFeishuChannelInstance(): ChannelInstance {
  const instance: ChannelInstance = {
    type: 'feishu',
    id: 'feishu',
    status: 'disconnected',
    start: async () => {
      const configRaw = getSetting('channel:feishu:config');
      if (!configRaw) {
        console.warn('[Feishu] No configuration found. Set channel:feishu:config to activate.');
        instance.status = 'disconnected';
        return;
      }

      let config: FeishuChannelConfig;
      try {
        config = JSON.parse(configRaw) as FeishuChannelConfig;
      } catch {
        console.error('[Feishu] Invalid config JSON');
        instance.status = 'error';
        return;
      }

      if (!config.appId || !config.appSecret) {
        console.warn('[Feishu] Missing appId or appSecret in config');
        instance.status = 'error';
        return;
      }

      try {
        const { monitorFeishuProvider } = await import('./feishu/index.js');

        // Start the Feishu provider monitor which establishes WebSocket/webhook connection
        await monitorFeishuProvider({
          appId: config.appId,
          appSecret: config.appSecret,
          encryptKey: config.encryptKey,
          verificationToken: config.verificationToken,
          onMessage: (msg: { chatId: string; messageId: string; content: string; senderId: string; senderName?: string; timestamp: number }) => {
            const manager = getChannelManager();
            manager.dispatchMessage({
              channelType: 'feishu',
              channelId: 'feishu',
              sessionId: `feishu:${msg.chatId}`,
              messageId: msg.messageId,
              content: msg.content,
              senderId: msg.senderId,
              senderName: msg.senderName ?? msg.senderId,
              timestamp: new Date(msg.timestamp).toISOString(),
            });
          },
          onStateChange: (state: string) => {
            if (state === 'connected') instance.status = 'connected';
            else if (state === 'connecting') instance.status = 'connecting';
            else if (state === 'reconnecting') instance.status = 'reconnecting';
            else instance.status = 'disconnected';
          },
          onError: (err: Error) => {
            console.error('[Feishu Channel] Error:', err.message);
            instance.status = 'error';
          },
        });

        instance.status = 'connected';
        console.log('[Feishu] Channel started successfully');
      } catch (err) {
        console.error('[Feishu] Failed to start:', err instanceof Error ? err.message : String(err));
        instance.status = 'error';
      }
    },
    stop: async () => {
      instance.status = 'disconnected';
    },
    send: async (_sessionId, content) => {
      const configRaw = getSetting('channel:feishu:config');
      if (!configRaw) throw new Error('Feishu not configured');

      try {
        const { sendMessageFeishu } = await import('./feishu/index.js');
        // Extract chatId from session ID (format: feishu:<chatId>)
        const chatId = _sessionId.startsWith('feishu:') ? _sessionId.slice(7) : _sessionId;
        await sendMessageFeishu(chatId, content);
      } catch (err) {
        console.error('[Feishu] Send failed:', err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
  };
  return instance;
}

/**
 * Register all configured channels with the ChannelManager.
 * Called once during app initialization.
 */
export function registerChannels(): void {
  const manager = getChannelManager();

  // Register QQ channel if configured
  const qqConfigRaw = getSetting('channel:qq:config');
  if (qqConfigRaw) {
    try {
      const qqConfig = JSON.parse(qqConfigRaw) as QQBotConfig;
      if (qqConfig.appId && qqConfig.clientSecret) {
        manager.register(createQQChannelInstance(qqConfig));
        console.log('[Channels] QQ channel registered');
      }
    } catch {
      console.warn('[Channels] Failed to parse QQ config, skipping');
    }
  } else {
    // Register placeholder so channels:list shows QQ as available
    manager.register(createQQChannelInstance({ appId: '', clientSecret: '' }));
  }

  // Register Feishu channel
  manager.register(createFeishuChannelInstance());
  console.log('[Channels] Feishu channel registered');
}
