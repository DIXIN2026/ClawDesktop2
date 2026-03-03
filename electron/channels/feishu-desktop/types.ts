/**
 * Feishu Desktop Channel — Type definitions
 * Types for the standalone desktop Feishu/Lark channel integration
 */

/** Configuration for the Feishu Desktop channel */
export interface FeishuDesktopConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
  domain: 'feishu' | 'lark';
}

/** Connection state machine */
export type FeishuConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** Attachment extracted from an incoming Feishu message */
export interface FeishuAttachment {
  type: 'image' | 'file' | 'audio' | 'video';
  key: string;
  name?: string;
}

/** Parsed incoming message from Feishu WebSocket events */
export interface FeishuIncomingMessage {
  chatId: string;
  messageId: string;
  content: string;
  contentType: string;
  senderId: string;
  senderName?: string;
  chatType: 'p2p' | 'group';
  rootId?: string;
  parentId?: string;
  timestamp: string;
  attachments?: FeishuAttachment[];
}

/** Outgoing message to be sent to a Feishu chat */
export interface FeishuOutgoingMessage {
  chatId: string;
  content: string;
  replyToMessageId?: string;
}

/** Callbacks for the Feishu channel lifecycle events */
export interface FeishuChannelCallbacks {
  onMessage: (msg: FeishuIncomingMessage) => void;
  onStateChange: (state: FeishuConnectionState) => void;
  onError: (error: Error) => void;
}

/** Cached user info entry with TTL */
export interface CachedUserInfo {
  name: string;
  fetchedAt: number;
}

/** Feishu API message event payload shape */
export interface FeishuMessageEventData {
  sender: {
    sender_id: {
      open_id: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type?: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    create_time: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
  };
}

/** Shape of the Feishu user info API response */
export interface FeishuUserInfoResponse {
  code?: number;
  msg?: string;
  data?: {
    user?: {
      name?: string;
      en_name?: string;
    };
  };
}
