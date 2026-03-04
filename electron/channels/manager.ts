/**
 * Unified Channel Manager
 * Manages lifecycle of all messaging channels (Feishu, QQ, etc.)
 */

export type ChannelType = 'feishu' | 'feishu2' | 'qq' | 'email' | 'web' | 'slack' | 'discord';
export type ChannelStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface IncomingMessage {
  channelType: ChannelType;
  channelId: string;
  sessionId: string;
  messageId: string;
  content: string;
  senderId: string;
  senderName?: string;
  timestamp: string;
  attachments?: Array<{ type: string; url: string; name: string }>;
}

export interface ChannelInstance {
  type: ChannelType;
  id: string;
  status: ChannelStatus;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  send: (sessionId: string, content: string) => Promise<void>;
}

type MessageHandler = (msg: IncomingMessage) => void;
type StatusHandler = (channelId: string, status: ChannelStatus) => void;

export class ChannelManager {
  private channels = new Map<string, ChannelInstance>();
  private messageHandlers: MessageHandler[] = [];
  private statusHandlers: StatusHandler[] = [];

  register(channel: ChannelInstance): void {
    if (this.channels.has(channel.id)) {
      console.warn(`[ChannelManager] Channel ${channel.id} already registered, replacing`);
    }
    this.channels.set(channel.id, channel);
  }

  unregister(channelId: string): void {
    const channel = this.channels.get(channelId);
    if (channel && channel.status !== 'disconnected') {
      channel.stop().catch((err) => {
        console.error(`[ChannelManager] Error stopping channel ${channelId}:`, err);
      });
    }
    this.channels.delete(channelId);
  }

  async start(channelId: string): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error(`Channel ${channelId} not found`);

    this.notifyStatus(channelId, 'connecting');
    try {
      await channel.start();
      this.notifyStatus(channelId, 'connected');
    } catch (err) {
      this.notifyStatus(channelId, 'error');
      throw err;
    }
  }

  async stop(channelId: string): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) return;

    await channel.stop();
    this.notifyStatus(channelId, 'disconnected');
  }

  async stopAll(): Promise<void> {
    const promises = Array.from(this.channels.keys()).map((id) => this.stop(id));
    await Promise.allSettled(promises);
  }

  async sendMessage(channelId: string, sessionId: string, content: string): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error(`Channel ${channelId} not found`);
    if (channel.status !== 'connected') {
      throw new Error(`Channel ${channelId} is not connected (status: ${channel.status})`);
    }
    await channel.send(sessionId, content);
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.push(handler);
    return () => {
      const idx = this.messageHandlers.indexOf(handler);
      if (idx >= 0) this.messageHandlers.splice(idx, 1);
    };
  }

  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.push(handler);
    return () => {
      const idx = this.statusHandlers.indexOf(handler);
      if (idx >= 0) this.statusHandlers.splice(idx, 1);
    };
  }

  /** Called by channel adapters to dispatch incoming messages */
  dispatchMessage(msg: IncomingMessage): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(msg);
      } catch (err) {
        console.error('[ChannelManager] Message handler error:', err);
      }
    }
  }

  getChannel(channelId: string): ChannelInstance | undefined {
    return this.channels.get(channelId);
  }

  getAllChannels(): ChannelInstance[] {
    return Array.from(this.channels.values());
  }

  getStatus(channelId: string): ChannelStatus {
    return this.channels.get(channelId)?.status ?? 'disconnected';
  }

  private notifyStatus(channelId: string, status: ChannelStatus): void {
    const channel = this.channels.get(channelId);
    if (channel) {
      channel.status = status;
    }
    for (const handler of this.statusHandlers) {
      try {
        handler(channelId, status);
      } catch (err) {
        console.error('[ChannelManager] Status handler error:', err);
      }
    }
  }
}

/** Singleton channel manager for the app */
let instance: ChannelManager | null = null;

export function getChannelManager(): ChannelManager {
  if (!instance) {
    instance = new ChannelManager();
  }
  return instance;
}
