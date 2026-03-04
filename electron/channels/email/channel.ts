import net from 'node:net';
import tls from 'node:tls';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { EmailConfig, EmailConnectionState } from './types.js';

interface EmailChannelCallbacks {
  onStateChange: (state: EmailConnectionState) => void;
  onError: (error: Error) => void;
}

interface EmailSendParams {
  to?: string;
  subject?: string;
  content: string;
}

interface SmtpResponse {
  code: number;
  lines: string[];
}

interface LineWaiter {
  resolve: (line: string) => void;
  reject: (error: Error) => void;
}

const SMTP_TIMEOUT_MS = 20_000;

function parseRecipients(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function isLikelyEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function extractMailbox(value: string): string {
  const match = value.match(/<([^>]+)>/);
  const mailbox = (match?.[1] ?? value).trim();
  if (!isLikelyEmail(mailbox)) {
    throw new Error(`Invalid email address: ${value}`);
  }
  return mailbox;
}

function normalizeBody(content: string): string {
  const normalized = content.replace(/\r?\n/g, '\r\n');
  return normalized.replace(/^\./gm, '..');
}

function assertSmtpCode(response: SmtpResponse, expected: number[], stage: string): void {
  if (!expected.includes(response.code)) {
    const detail = response.lines.join(' | ');
    throw new Error(`SMTP ${stage} failed (${response.code}): ${detail}`);
  }
}

async function sendSmtpMail(config: EmailConfig, params: EmailSendParams): Promise<void> {
  const recipients = parseRecipients(params.to ?? config.to);
  if (recipients.length === 0) {
    throw new Error('SMTP recipient is required');
  }
  for (const recipient of recipients) {
    if (!isLikelyEmail(recipient)) {
      throw new Error(`Invalid SMTP recipient: ${recipient}`);
    }
  }

  const fromMailbox = extractMailbox(config.from);
  const subject = sanitizeHeader(params.subject ?? `${config.subjectPrefix ?? 'ClawDesktop'} Notification`);
  const socket = await createSmtpSocket(config);
  const decoder = new TextDecoder();
  let buffer = '';
  let fatalError: Error | null = null;
  const lineQueue: string[] = [];
  const waiters: LineWaiter[] = [];

  const failWaiters = (error: Error) => {
    fatalError = error;
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      if (waiter) waiter.reject(error);
    }
  };

  const pushLine = (line: string) => {
    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve(line);
      return;
    }
    lineQueue.push(line);
  };

  socket.on('data', (chunk: Buffer) => {
    buffer += decoder.decode(chunk, { stream: true });
    while (true) {
      const idx = buffer.indexOf('\n');
      if (idx < 0) break;
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line.length > 0) {
        pushLine(line);
      }
    }
  });

  socket.on('error', (error: Error) => {
    failWaiters(error);
  });

  socket.on('close', () => {
    if (!fatalError) {
      failWaiters(new Error('SMTP connection closed unexpectedly'));
    }
  });

  const nextLine = async (): Promise<string> => {
    if (lineQueue.length > 0) {
      const line = lineQueue.shift();
      if (line) return line;
    }
    if (fatalError) throw fatalError;
    return new Promise<string>((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
  };

  const readResponse = async (): Promise<SmtpResponse> => {
    const lines: string[] = [];
    while (true) {
      const line = await nextLine();
      lines.push(line);
      if (/^\d{3}\s/.test(line)) {
        const code = Number.parseInt(line.slice(0, 3), 10);
        if (Number.isNaN(code)) {
          throw new Error(`Invalid SMTP response: ${line}`);
        }
        return { code, lines };
      }
    }
  };

  const sendCommand = async (command: string): Promise<SmtpResponse> => {
    socket.write(`${command}\r\n`);
    return readResponse();
  };

  const sendRawData = async (data: string): Promise<SmtpResponse> => {
    socket.write(data);
    return readResponse();
  };

  try {
    assertSmtpCode(await readResponse(), [220], 'greeting');
    assertSmtpCode(await sendCommand(`EHLO ${hostname() || 'localhost'}`), [250], 'EHLO');

    if (config.username) {
      if (!config.password) {
        throw new Error('SMTP password is required when username is set');
      }
      assertSmtpCode(await sendCommand('AUTH LOGIN'), [334], 'AUTH LOGIN');
      assertSmtpCode(
        await sendCommand(Buffer.from(config.username, 'utf-8').toString('base64')),
        [334],
        'AUTH username',
      );
      assertSmtpCode(
        await sendCommand(Buffer.from(config.password, 'utf-8').toString('base64')),
        [235],
        'AUTH password',
      );
    }

    assertSmtpCode(await sendCommand(`MAIL FROM:<${fromMailbox}>`), [250], 'MAIL FROM');
    for (const recipient of recipients) {
      assertSmtpCode(await sendCommand(`RCPT TO:<${recipient}>`), [250, 251], `RCPT TO ${recipient}`);
    }
    assertSmtpCode(await sendCommand('DATA'), [354], 'DATA');

    const messageHeaders = [
      `From: ${sanitizeHeader(config.from)}`,
      `To: ${recipients.join(', ')}`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@clawdesktop.local>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
    ].join('\r\n');
    const payload = `${messageHeaders}\r\n\r\n${normalizeBody(params.content)}\r\n.\r\n`;
    assertSmtpCode(await sendRawData(payload), [250], 'message body');

    // Some SMTP servers may close immediately; ignore QUIT failure.
    await sendCommand('QUIT').catch(() => null);
  } finally {
    socket.destroy();
  }
}

async function createSmtpSocket(config: EmailConfig): Promise<net.Socket | tls.TLSSocket> {
  const socket = await new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
    const connection = config.secure
      ? tls.connect({
          host: config.host,
          port: config.port,
          servername: config.host,
        })
      : net.connect({
          host: config.host,
          port: config.port,
        });

    const timeout = setTimeout(() => {
      connection.destroy(new Error('SMTP connection timeout'));
      reject(new Error('SMTP connection timeout'));
    }, SMTP_TIMEOUT_MS);

    const onConnect = () => {
      clearTimeout(timeout);
      connection.removeListener('error', onError);
      resolve(connection);
    };

    const onError = (error: Error) => {
      clearTimeout(timeout);
      connection.removeListener('connect', onConnect);
      reject(error);
    };

    connection.once('connect', onConnect);
    connection.once('error', onError);
  });

  socket.setTimeout(SMTP_TIMEOUT_MS, () => {
    socket.destroy(new Error('SMTP socket timeout'));
  });
  return socket;
}

export class EmailChannel {
  private state: EmailConnectionState = 'disconnected';

  constructor(
    private config: EmailConfig,
    private callbacks: EmailChannelCallbacks,
  ) {}

  updateConfig(config: EmailConfig): void {
    this.config = config;
  }

  async start(): Promise<void> {
    this.setState('connecting');
    this.validateConfig();
    this.setState('connected');
  }

  async stop(): Promise<void> {
    this.setState('disconnected');
  }

  async send(params: EmailSendParams): Promise<void> {
    this.validateConfig();
    try {
      await sendSmtpMail(this.config, params);
    } catch (error) {
      this.callbacks.onError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  getState(): EmailConnectionState {
    return this.state;
  }

  private setState(state: EmailConnectionState): void {
    this.state = state;
    this.callbacks.onStateChange(state);
  }

  private validateConfig(): void {
    if (!this.config.host || this.config.host.trim().length === 0) {
      throw new Error('SMTP host is required');
    }
    if (!Number.isInteger(this.config.port) || this.config.port <= 0 || this.config.port > 65535) {
      throw new Error(`Invalid SMTP port: ${this.config.port}`);
    }
    if (!this.config.from || this.config.from.trim().length === 0) {
      throw new Error('SMTP from address is required');
    }
    if (!this.config.to || this.config.to.trim().length === 0) {
      throw new Error('SMTP recipient is required');
    }
    if (this.config.password && (!this.config.username || this.config.username.trim().length === 0)) {
      throw new Error('SMTP username is required when password is set');
    }
    const usesAuth = Boolean(
      (this.config.username && this.config.username.trim().length > 0)
      || (this.config.password && this.config.password.trim().length > 0),
    );
    if (usesAuth && !this.config.secure) {
      throw new Error('SMTP auth requires secure TLS connection (set secure=true)');
    }
  }
}
