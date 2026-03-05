export interface FeishuLiteConfig {
  appId: string;
  appSecret: string;
}

export interface FeishuLiteMessage {
  messageId: string;
  chatId: string;
  chatType: 'p2p' | 'group';
  content: string;
  senderId: string;
  senderName: string;
  timestamp: number;
}

export interface FeishuLiteCallbacks {
  onMessage: (msg: FeishuLiteMessage) => void;
  onStateChange: (state: 'connected' | 'connecting' | 'disconnected' | 'error') => void;
  onError: (err: Error) => void;
}

export interface SenderCacheEntry {
  name: string;
  cachedAt: number;
}
