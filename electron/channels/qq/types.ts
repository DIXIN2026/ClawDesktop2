/**
 * QQ Bot Channel — Type definitions
 * Based on QQ Bot Official API specification
 */

/** WebSocket Gateway OpCodes */
export enum GatewayOpCode {
  DISPATCH = 0,
  HEARTBEAT = 1,
  IDENTIFY = 2,
  RESUME = 6,
  RECONNECT = 7,
  INVALID_SESSION = 9,
  HELLO = 10,
  HEARTBEAT_ACK = 11,
}

/** Gateway payload structure */
export interface GatewayPayload {
  op: GatewayOpCode;
  d?: Record<string, unknown> | number | null;
  s?: number;
  t?: string;
}

/** Intent flags for event subscription */
export const QQIntents = {
  PUBLIC_GUILD_MESSAGES: 1 << 30,
  DIRECT_MESSAGE: 1 << 12,
  GROUP_AND_C2C: 1 << 25,
  GUILD_MESSAGES: 1 << 9,
  GUILD_MESSAGE_REACTIONS: 1 << 10,
} as const;

/** QQ Bot configuration */
export interface QQBotConfig {
  appId: string;
  clientSecret: string;
  sandbox?: boolean;
}

/** Access token from QQ API */
export interface QQAccessToken {
  access_token: string;
  expires_in: number;
  obtained_at: number;
}

/** Message types */
export type QQMessageScene = 'c2c' | 'guild' | 'group' | 'direct';

/** Incoming message from QQ */
export interface QQIncomingMessage {
  scene: QQMessageScene;
  messageId: string;
  content: string;
  senderId: string;
  senderName?: string;
  groupId?: string;
  guildId?: string;
  channelId?: string;
  /** Referenced/replied-to message ID (for reply-chain session binding) */
  msgRef?: string;
  timestamp: string;
  attachments?: QQAttachment[];
}

/** Outgoing message to QQ */
export interface QQOutgoingMessage {
  scene: QQMessageScene;
  targetId: string;
  content: string;
  msgId?: string;
  msgSeq?: number;
}

/** File attachment */
export interface QQAttachment {
  content_type: string;
  filename: string;
  url: string;
}

/** Connection state */
export type QQConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** Channel events */
export interface QQChannelEvents {
  onMessage: (msg: QQIncomingMessage) => void;
  onStateChange: (state: QQConnectionState) => void;
  onError: (error: Error) => void;
}
