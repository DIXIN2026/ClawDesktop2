/**
 * QQ Bot Channel — Media upload/download
 * Uses QQ Bot v2 file API for rich media messages.
 */

import type { QQBotConfig, QQMessageScene } from './types.js';
import { getAccessToken } from './auth.js';

const API_BASE_PROD = 'https://api.sgroup.qq.com';
const API_BASE_SANDBOX = 'https://sandbox.api.sgroup.qq.com';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported file types for QQ Bot rich media */
export type QQFileType = 1 | 2 | 3 | 4; // 1=image, 2=video, 3=audio, 4=file

export interface QQUploadResult {
  file_uuid: string;
  file_info: string;
  ttl: number;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Upload a file to QQ via URL (server-side fetch).
 * QQ Bot API will fetch the file from the given URL.
 */
export async function uploadFileByUrl(
  config: QQBotConfig,
  params: {
    scene: QQMessageScene;
    targetId: string;
    fileType: QQFileType;
    url: string;
    srvSendMsg?: boolean;
  },
): Promise<QQUploadResult> {
  const base = config.sandbox ? API_BASE_SANDBOX : API_BASE_PROD;
  const token = await getAccessToken(config);

  let endpoint: string;
  switch (params.scene) {
    case 'c2c':
      endpoint = `${base}/v2/users/${params.targetId}/files`;
      break;
    case 'group':
      endpoint = `${base}/v2/groups/${params.targetId}/files`;
      break;
    default:
      throw new Error(`File upload not supported for scene: ${params.scene}`);
  }

  const body = {
    file_type: params.fileType,
    url: params.url,
    srv_send_msg: params.srvSendMsg ?? false,
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
    throw new Error(`QQ file upload failed (${response.status}): ${text}`);
  }

  return (await response.json()) as QQUploadResult;
}

// ---------------------------------------------------------------------------
// Send rich media message
// ---------------------------------------------------------------------------

/**
 * Send a media message (image/video/audio/file) to a target.
 * Uses msg_type: 7 with the file_info from a previous upload.
 */
export async function sendMediaMessage(
  config: QQBotConfig,
  params: {
    scene: QQMessageScene;
    targetId: string;
    fileType: QQFileType;
    fileInfo: string;
    content?: string;
    msgId?: string;
    msgSeq?: number;
  },
): Promise<void> {
  const base = config.sandbox ? API_BASE_SANDBOX : API_BASE_PROD;
  const token = await getAccessToken(config);

  let endpoint: string;
  switch (params.scene) {
    case 'c2c':
      endpoint = `${base}/v2/users/${params.targetId}/messages`;
      break;
    case 'group':
      endpoint = `${base}/v2/groups/${params.targetId}/messages`;
      break;
    default:
      throw new Error(`Media message not supported for scene: ${params.scene}`);
  }

  const body: Record<string, unknown> = {
    msg_type: 7,
    media: {
      file_info: params.fileInfo,
    },
    content: params.content ?? '',
    msg_id: params.msgId,
    msg_seq: params.msgSeq,
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
    throw new Error(`QQ media send failed (${response.status}): ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Download a file from a QQ attachment URL.
 * QQ attachment URLs require bot authorization.
 */
export async function downloadFile(
  config: QQBotConfig,
  url: string,
  maxBytes = 50 * 1024 * 1024,
): Promise<{ buffer: Buffer; contentType: string }> {
  const token = await getAccessToken(config);

  const response = await fetch(url, {
    headers: {
      'Authorization': `QQBot ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`QQ file download failed (${response.status}): ${response.statusText}`);
  }

  const arrayBuf = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  if (buffer.length > maxBytes) {
    throw new Error(`File too large: ${buffer.length} bytes (max ${maxBytes})`);
  }

  return {
    buffer,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}
