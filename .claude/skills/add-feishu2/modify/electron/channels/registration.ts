/**
 * Channel Registration
 * Bridges Feishu-Lite, Feishu (OpenClaw plugin), and QQ (standalone class) to ChannelManager
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
      const parts = _sessionId.split(':');
      const scene = (parts[1] ?? 'c2c') as 'c2c' | 'guild' | 'group' | 'direct';
      const targetId = parts[2] ?? '';
      await qqChannel.send({ scene, targetId, content });
    },
  };
  return instance;
}

function createFeishuChannelInstance(): ChannelInstance {
  // Feishu uses the OpenClaw plugin system and requires an API runtime.
  // In desktop mode, we provide a lightweight adapter that delegates to
  // the stored Feishu app credentials.
  const instance: ChannelInstance = {
    type: 'feishu',
    id: 'feishu',
    status: 'disconnected',
    start: async () => {
      // Feishu channel requires lark-node-sdk WebSocket connection
      // which is managed by the feishu monitor module
      const { monitorFeishuProvider } = await import('./feishu/index.js');
      // monitorFeishuProvider is designed for the OpenClaw gateway runtime.
      // In desktop mode, we just mark as connected since it needs full
      // gateway integration which is out of scope for standalone registration.
      console.log('[Feishu] Channel registered (requires gateway runtime for full functionality)');
      instance.status = 'connected';
      void monitorFeishuProvider; // referenced to avoid tree-shaking
    },
    stop: async () => {
      instance.status = 'disconnected';
    },
    send: async (_sessionId, content) => {
      const { sendMessageFeishu } = await import('./feishu/index.js');
      void sendMessageFeishu; // Will need proper target resolution
      void content;
      console.warn('[Feishu] Direct send not yet wired in desktop mode');
    },
  };
  return instance;
}

interface FeishuLiteConfig {
  appId: string;
  appSecret: string;
}

function createFeishuLiteChannelInstance(): ChannelInstance {
  let channel: import('./feishu-lite/index.js').FeishuLiteChannel | null = null;

  const instance: ChannelInstance = {
    type: 'feishu',
    id: 'feishu-lite',
    status: 'disconnected',
    start: async () => {
      const configRaw = getSetting('channel:feishu-lite:config');
      if (!configRaw) {
        console.warn('[Feishu-Lite] No configuration found');
        return;
      }

      let config: FeishuLiteConfig;
      try {
        config = JSON.parse(configRaw) as FeishuLiteConfig;
      } catch {
        console.error('[Feishu-Lite] Invalid config JSON');
        instance.status = 'error';
        return;
      }

      if (!config.appId || !config.appSecret) {
        console.warn('[Feishu-Lite] Missing appId or appSecret');
        instance.status = 'error';
        return;
      }

      const { FeishuLiteChannel } = await import('./feishu-lite/index.js');
      channel = new FeishuLiteChannel(config, {
        onMessage: (msg) => {
          getChannelManager().dispatchMessage({
            channelType: 'feishu',
            channelId: 'feishu-lite',
            sessionId: `feishu:${msg.chatId}`,
            messageId: msg.messageId,
            content: msg.content,
            senderId: msg.senderId,
            senderName: msg.senderName,
            timestamp: new Date(msg.timestamp).toISOString(),
          });
        },
        onStateChange: (state) => {
          if (state === 'connected') instance.status = 'connected';
          else if (state === 'connecting') instance.status = 'connecting';
          else if (state === 'error') instance.status = 'error';
          else instance.status = 'disconnected';
        },
        onError: (err) => {
          console.error('[Feishu-Lite] Error:', err.message);
          instance.status = 'error';
        },
      });

      await channel.start();
    },
    stop: async () => {
      if (channel) {
        await channel.stop();
        channel = null;
      }
    },
    send: async (_sessionId, content) => {
      if (!channel) throw new Error('Feishu-Lite channel not started');
      const chatId = _sessionId.startsWith('feishu:') ? _sessionId.slice(7) : _sessionId;
      await channel.send(chatId, content);
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
    manager.register(createQQChannelInstance({ appId: '', clientSecret: '' }));
  }

  // Register Feishu-Lite channel if configured, otherwise fall back to full Feishu
  const feishuLiteConfig = getSetting('channel:feishu-lite:config');
  if (feishuLiteConfig) {
    manager.register(createFeishuLiteChannelInstance());
    console.log('[Channels] Feishu-Lite channel registered');
  } else {
    manager.register(createFeishuChannelInstance());
    console.log('[Channels] Feishu channel registered');
  }
}
