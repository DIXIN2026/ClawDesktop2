/**
 * QQ Bot Channel — WebSocket Gateway Protocol
 * Implements QQ Bot WebSocket gateway with heartbeat and reconnect
 */
import { WebSocket } from 'ws' ;
import { EventEmitter } from 'events';
import type { GatewayPayload, QQBotConfig, QQConnectionState, QQIncomingMessage } from './types.js';
import { GatewayOpCode, QQIntents } from './types.js';
import { getAccessToken, clearTokenCache } from './auth.js';
import { buildReconnectDelays } from './reconnect.js';

const GATEWAY_URL_PROD = 'wss://api.sgroup.qq.com/websocket';
const GATEWAY_URL_SANDBOX = 'wss://sandbox.api.sgroup.qq.com/websocket';
const MAX_RECONNECT_ATTEMPTS = 100;

export class QQGateway extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: QQBotConfig;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatAcked = true;
  private sequenceNumber: number | null = null;
  private sessionId: string | null = null;
  private reconnectAttempts = 0;
  private reconnectDelays = buildReconnectDelays();
  private state: QQConnectionState = 'disconnected';
  private destroyed = false;

  constructor(config: QQBotConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.destroyed) return;

    this.setState('connecting');
    const url = this.config.sandbox ? GATEWAY_URL_SANDBOX : GATEWAY_URL_PROD;

    try {
      this.ws = new WebSocket(url);
      this.ws.on('open', () => this.onOpen());
      this.ws.on('message', (data: Buffer) => this.onMessage(data));
      this.ws.on('close', (code: number) => this.onClose(code));
      this.ws.on('error', (err: Error) => this.onError(err));
    } catch (err) {
      this.emit('error', err);
      this.scheduleReconnect();
    }
  }

  async disconnect(): Promise<void> {
    this.destroyed = true;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.setState('disconnected');
  }

  getState(): QQConnectionState {
    return this.state;
  }

  // ── WebSocket event handlers ────────────────────────────────────────

  private onOpen(): void {
    this.reconnectAttempts = 0;
    console.log('[QQ Gateway] WebSocket connected');
  }

  private onMessage(data: Buffer): void {
    let payload: GatewayPayload;
    try {
      payload = JSON.parse(data.toString()) as GatewayPayload;
    } catch {
      console.warn('[QQ Gateway] Failed to parse message');
      return;
    }

    switch (payload.op) {
      case GatewayOpCode.HELLO:
        this.handleHello(payload);
        break;
      case GatewayOpCode.DISPATCH:
        this.handleDispatch(payload);
        break;
      case GatewayOpCode.HEARTBEAT_ACK:
        this.heartbeatAcked = true;
        break;
      case GatewayOpCode.RECONNECT:
        console.log('[QQ Gateway] Server requested reconnect');
        this.reconnect();
        break;
      case GatewayOpCode.INVALID_SESSION:
        console.warn('[QQ Gateway] Invalid session, re-identifying');
        this.sessionId = null;
        this.identify();
        break;
    }
  }

  private onClose(code: number): void {
    console.log(`[QQ Gateway] WebSocket closed: ${code}`);
    this.stopHeartbeat();

    if (!this.destroyed) {
      this.scheduleReconnect();
    }
  }

  private onError(err: Error): void {
    console.error('[QQ Gateway] WebSocket error:', err.message);
    this.emit('error', err);
  }

  // ── Protocol handlers ──────────────────────────────────────────────

  private handleHello(payload: GatewayPayload): void {
    const d = payload.d as { heartbeat_interval?: number } | undefined;
    const interval = d?.heartbeat_interval ?? 30000;
    this.startHeartbeat(interval);

    if (this.sessionId) {
      this.resume();
    } else {
      this.identify();
    }
  }

  private handleDispatch(payload: GatewayPayload): void {
    if (payload.s !== undefined && payload.s !== null) {
      this.sequenceNumber = payload.s;
    }

    const eventType = payload.t ?? '';
    const data = (payload.d ?? {}) as Record<string, unknown>;

    switch (eventType) {
      case 'READY': {
        this.sessionId = String(data.session_id ?? '');
        this.setState('connected');
        console.log('[QQ Gateway] Ready, session:', this.sessionId);
        break;
      }
      case 'RESUMED': {
        this.setState('connected');
        console.log('[QQ Gateway] Resumed successfully');
        break;
      }
      case 'C2C_MESSAGE_CREATE':
        this.emitMessage('c2c', data);
        break;
      case 'GROUP_AT_MESSAGE_CREATE':
      case 'GROUP_MESSAGE_CREATE':
        this.emitMessage('group', data);
        break;
      case 'AT_MESSAGE_CREATE':
      case 'MESSAGE_CREATE':
        this.emitMessage('guild', data);
        break;
      case 'DIRECT_MESSAGE_CREATE':
        this.emitMessage('direct', data);
        break;
      default:
        // Log unhandled event types for debugging
        if (eventType) {
          console.debug(`[QQ Gateway] Unhandled event: ${eventType}`);
        }
    }
  }

  private emitMessage(scene: QQIncomingMessage['scene'], data: Record<string, unknown>): void {
    // Extract message reference: guild uses `message_reference`, group/c2c uses `msg_ref`
    const ref = data.message_reference as Record<string, unknown> | undefined;
    const refId = ref ? String(ref.message_id ?? '') || undefined : undefined;
    const msgRef = refId ?? (data.msg_ref as string | undefined);

    const msg: QQIncomingMessage = {
      scene,
      messageId: String(data.id ?? data.msg_id ?? ''),
      content: String(data.content ?? ''),
      senderId: String((data.author as Record<string, unknown>)?.id ?? data.user_openid ?? ''),
      senderName: ((data.author as Record<string, unknown>)?.username as string) ?? undefined,
      groupId: data.group_openid as string | undefined,
      guildId: data.guild_id as string | undefined,
      channelId: data.channel_id as string | undefined,
      msgRef,
      timestamp: String(data.timestamp ?? new Date().toISOString()),
      attachments: data.attachments as QQIncomingMessage['attachments'],
    };
    this.emit('message', msg);
  }

  // ── Identify / Resume ──────────────────────────────────────────────

  private async identify(): Promise<void> {
    try {
      const token = await getAccessToken(this.config);
      this.send({
        op: GatewayOpCode.IDENTIFY,
        d: {
          token: `QQBot ${token}`,
          intents: QQIntents.PUBLIC_GUILD_MESSAGES | QQIntents.DIRECT_MESSAGE | QQIntents.GROUP_AND_C2C,
          shard: [0, 1],
        },
      });
    } catch (err) {
      console.error('[QQ Gateway] Identify failed:', err);
      this.emit('error', err);
    }
  }

  private resume(): void {
    this.send({
      op: GatewayOpCode.RESUME,
      d: {
        token: `QQBot`,
        session_id: this.sessionId,
        seq: this.sequenceNumber,
      },
    });
  }

  // ── Heartbeat ──────────────────────────────────────────────────────

  private startHeartbeat(interval: number): void {
    this.stopHeartbeat();
    this.heartbeatAcked = true;
    this.heartbeatInterval = setInterval(() => {
      if (!this.heartbeatAcked) {
        console.warn('[QQ Gateway] Heartbeat not acked, reconnecting');
        this.reconnect();
        return;
      }
      this.heartbeatAcked = false;
      this.send({ op: GatewayOpCode.HEARTBEAT, d: this.sequenceNumber });
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // ── Reconnect ──────────────────────────────────────────────────────

  private reconnect(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.setState('disconnected');
      this.emit('error', new Error('Max reconnect attempts exceeded'));
      return;
    }

    this.setState('reconnecting');
    const delay = this.reconnectDelays[Math.min(this.reconnectAttempts, this.reconnectDelays.length - 1)] ?? 60000;
    this.reconnectAttempts++;

    console.log(`[QQ Gateway] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => {
      if (!this.destroyed) {
        clearTokenCache(); // Force fresh token on reconnect
        this.connect();
      }
    }, delay);
  }

  // ── Send ──────────────────────────────────────────────────────────

  private send(payload: GatewayPayload): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private setState(state: QQConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.emit('stateChange', state);
    }
  }
}
