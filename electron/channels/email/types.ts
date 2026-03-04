export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  username?: string;
  password?: string;
  from: string;
  to: string;
  subjectPrefix?: string;
}

export type EmailConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';
