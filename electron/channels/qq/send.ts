/**
 * QQ Bot Channel — Message sending API
 * Supports plain text (msg_type: 0), Markdown (msg_type: 2),
 * Embed (msg_type: 4, guild only), and rich media (msg_type: 7).
 */
import type { QQBotConfig, QQOutgoingMessage } from './types.js';
import { getAccessToken } from './auth.js';
import { buildMarkdownBody, buildEmbedBody, type QQEmbed, type QQKeyboard } from './rich-text.js';

const API_BASE_PROD = 'https://api.sgroup.qq.com';
const API_BASE_SANDBOX = 'https://sandbox.api.sgroup.qq.com';

/** Track per-target message sequence numbers */
const seqCounters = new Map<string, number>();

function getNextSeq(targetKey: string): number {
  const current = seqCounters.get(targetKey) ?? 0;
  const next = current + 1;
  seqCounters.set(targetKey, next);
  return next;
}

export async function sendMessage(config: QQBotConfig, msg: QQOutgoingMessage): Promise<string | undefined> {
  const base = config.sandbox ? API_BASE_SANDBOX : API_BASE_PROD;
  const token = await getAccessToken(config);

  let url: string;
  let body: Record<string, unknown>;

  switch (msg.scene) {
    case 'c2c':
      url = `${base}/v2/users/${msg.targetId}/messages`;
      body = {
        content: msg.content,
        msg_type: 0,
        msg_id: msg.msgId,
        msg_seq: msg.msgSeq ?? getNextSeq(`c2c:${msg.targetId}`),
      };
      break;

    case 'group':
      url = `${base}/v2/groups/${msg.targetId}/messages`;
      body = {
        content: msg.content,
        msg_type: 0,
        msg_id: msg.msgId,
        msg_seq: msg.msgSeq ?? getNextSeq(`group:${msg.targetId}`),
      };
      break;

    case 'guild':
      url = `${base}/channels/${msg.targetId}/messages`;
      body = {
        content: msg.content,
        msg_id: msg.msgId,
      };
      break;

    case 'direct':
      url = `${base}/dms/${msg.targetId}/messages`;
      body = {
        content: msg.content,
        msg_id: msg.msgId,
      };
      break;

    default:
      throw new Error(`Unknown message scene: ${msg.scene}`);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `QQBot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`QQ send failed (${response.status}): ${text}`);
  }

  // Extract sent message ID from response for thread binding
  try {
    const data = await response.json() as Record<string, unknown>;
    return typeof data.id === 'string' ? data.id : typeof data.msg_id === 'string' ? data.msg_id : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Markdown message (msg_type: 2, c2c/group only)
// ---------------------------------------------------------------------------

/**
 * Send a Markdown-formatted message.
 * Only supported for c2c and group scenes (not guild).
 */
export async function sendMarkdownMessage(
  config: QQBotConfig,
  params: {
    scene: 'c2c' | 'group';
    targetId: string;
    markdown: string;
    msgId?: string;
    msgSeq?: number;
    keyboard?: QQKeyboard;
  },
): Promise<void> {
  const base = config.sandbox ? API_BASE_SANDBOX : API_BASE_PROD;
  const token = await getAccessToken(config);

  const endpoint =
    params.scene === 'c2c'
      ? `${base}/v2/users/${params.targetId}/messages`
      : `${base}/v2/groups/${params.targetId}/messages`;

  const body = {
    ...buildMarkdownBody(params.markdown, params.keyboard),
    msg_id: params.msgId,
    msg_seq: params.msgSeq ?? getNextSeq(`${params.scene}:${params.targetId}`),
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `QQBot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`QQ markdown send failed (${response.status}): ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Embed message (msg_type: 4, guild only)
// ---------------------------------------------------------------------------

/**
 * Send an Embed message to a guild channel.
 */
export async function sendEmbedMessage(
  config: QQBotConfig,
  params: {
    channelId: string;
    embed: QQEmbed;
    msgId?: string;
  },
): Promise<void> {
  const base = config.sandbox ? API_BASE_SANDBOX : API_BASE_PROD;
  const token = await getAccessToken(config);

  const endpoint = `${base}/channels/${params.channelId}/messages`;
  const body = {
    ...buildEmbedBody(params.embed),
    msg_id: params.msgId,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `QQBot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`QQ embed send failed (${response.status}): ${text}`);
  }
}
